/**
 * FILE: infra/bi/provision.ts
 * PART: Data Intelligence (Metabase) — the system reports, kept in the repo
 * WHAT IT DOES: Makes Metabase match infra/bi/reports/. Safe to run again and again (everything is matched by name):
 *   1. data sources "Intelligence DB" (read-only role fundhub_bi_ro, localhost) and "Website DB" (read-only role
 *      fundhub_analyst_ro on Neon, from ANALYST_DATABASE_URL);
 *   2. collections "FundHub system reports", "FundHub restricted reports" (owners only in the admin) and
 *      "Team reports" (where staff save their own questions and dashboards);
 *   3. one native-SQL question per reports/<dashboard>/*.sql, and one dashboard per folder, with embedding on;
 *   4. static embedding switched on, with the signing secret kept in ~/.fundhub-secrets/metabase-embed-secret
 *      (the admin console's METABASE_EMBED_SECRET), never printed.
 *   Metabase's own export ("serialization") is a paid feature; this script is how the system reports stay versioned.
 * USAGE (on the VM, after infra/vm/bin/metabase-install.sh and the first-run admin account):
 *   METABASE_API_KEY=… ANALYST_DATABASE_URL=… npm run bi:provision
 *   Optional: METABASE_URL (default http://127.0.0.1:3010), BI_ENGINE_DATABASE_URL (default: the file written by
 *   metabase-install.sh), METABASE_USER + METABASE_PASSWORD instead of the API key, --dry-run (only parse files).
 * REPORT FILE FORMAT: SQL with header comments — name, display (scalar|bar|line|row|pie|table), size WxH on the
 *   24-column grid, optional x / y (column names, comma-separated), stacked: true, format: percent, description.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Kind: constant. Collection names; the admin console (apps/admin/src/lib/metabase.ts) uses the same ones. */
export const COLLECTIONS = {
  system: "FundHub system reports",
  restricted: "FundHub restricted reports",
  team: "Team reports",
} as const;
const DB_NAMES = { intelligence: "Intelligence DB", website: "Website DB" } as const;
const GRID = 24;

type DbKey = keyof typeof DB_NAMES;
type Report = {
  file: string;
  name: string;
  description?: string;
  display: string;
  w: number;
  h: number;
  x: string[];
  y: string[];
  stacked: boolean;
  percent: boolean;
  sql: string;
};
type Dashboard = { dir: string; name: string; description: string; database: DbKey; collection: "system" | "restricted"; reports: Report[] };

const REPORTS_DIR = join(import.meta.dirname, "reports");
const SECRETS = join(homedir(), ".fundhub-secrets");

/** Kind: function. Reads one .sql file: header comments ("-- key: value") + the query. */
export function parseReport(file: string, text: string): Report {
  const meta: Record<string, string> = {};
  const sql: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^--\s*([a-z]+):\s*(.*)$/.exec(line);
    if (m && !sql.length) meta[m[1]] = m[2].trim();
    else if (line.trim() || sql.length) sql.push(line);
  }
  if (!meta.name) throw new Error(`${file}: missing "-- name:"`);
  const [w, h] = (meta.size ?? "12x6").split("x").map(Number);
  const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  return {
    file,
    name: meta.name,
    description: meta.description,
    display: meta.display ?? "table",
    w: Math.min(GRID, w || 12),
    h: h || 6,
    x: list(meta.x),
    y: list(meta.y),
    stacked: meta.stacked === "true",
    percent: meta.format === "percent",
    sql: sql.join("\n").trim(),
  };
}

/** Kind: function. All dashboards under reports/, in folder order. */
export function loadDashboards(dir = REPORTS_DIR): Dashboard[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const path = join(dir, name);
      const meta = JSON.parse(readFileSync(join(path, "dashboard.json"), "utf8"));
      const reports = readdirSync(path)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => parseReport(`${name}/${f}`, readFileSync(join(path, f), "utf8")));
      return { dir: name, ...meta, reports } as Dashboard;
    });
}

/** Kind: function. Left-to-right, top-to-bottom placement on Metabase's 24-column grid. */
export function layout(reports: Report[]): { row: number; col: number; size_x: number; size_y: number }[] {
  let row = 0;
  let col = 0;
  let rowHeight = 0;
  return reports.map((r) => {
    if (col + r.w > GRID) {
      row += rowHeight;
      col = 0;
      rowHeight = 0;
    }
    const pos = { row, col, size_x: r.w, size_y: r.h };
    col += r.w;
    rowHeight = Math.max(rowHeight, r.h);
    return pos;
  });
}

/** Kind: function. Metabase chart settings from the header comments. */
function vizSettings(r: Report): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (r.x.length) v["graph.dimensions"] = r.x;
  if (r.y.length) v["graph.metrics"] = r.y;
  if (r.display === "pie" && r.x.length) {
    v["pie.dimension"] = r.x[0];
    if (r.y.length) v["pie.metric"] = r.y[0];
  }
  if (r.stacked) v["stackable.stack_type"] = "stacked";
  if (r.percent) v["column_settings"] = { '["name","share"]': { number_style: "percent", decimals: 1 } };
  return v;
}

// ---------- Metabase API ----------

const BASE = (process.env.METABASE_URL ?? "http://127.0.0.1:3010").replace(/\/+$/, "");
let auth: Record<string, string> = {};

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function login() {
  if (process.env.METABASE_API_KEY) {
    auth = { "x-api-key": process.env.METABASE_API_KEY };
  } else if (process.env.METABASE_USER && process.env.METABASE_PASSWORD) {
    const s = await api<{ id: string }>("POST", "/session", { username: process.env.METABASE_USER, password: process.env.METABASE_PASSWORD });
    auth = { "X-Metabase-Session": s.id };
  } else {
    throw new Error("Set METABASE_API_KEY (Metabase → Admin → Settings → Authentication → API keys).");
  }
}

/** Kind: function. Postgres URL → Metabase connection details. */
export function pgDetails(url: string) {
  const u = new URL(url);
  const local = ["127.0.0.1", "localhost", "::1"].includes(u.hostname);
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    dbname: decodeURIComponent(u.pathname.slice(1)),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ssl: !local,
    ...(local ? {} : { "ssl-mode": "require" }),
    "tunnel-enabled": false,
    "advanced-options": false,
  };
}

async function upsertDatabase(key: DbKey, url: string): Promise<number> {
  const list = await api<{ data: { id: number; name: string }[] }>("GET", "/database");
  const found = list.data.find((d) => d.name === DB_NAMES[key]);
  const body = { name: DB_NAMES[key], engine: "postgres", details: pgDetails(url), is_full_sync: true, auto_run_queries: true };
  if (found) {
    await api("PUT", `/database/${found.id}`, body);
    return found.id;
  }
  const db = await api<{ id: number }>("POST", "/database", body);
  return db.id;
}

async function upsertCollection(name: string, description: string): Promise<number> {
  const list = await api<{ id: number | string; name: string; archived?: boolean; personal_owner_id?: number | null; location?: string }[]>("GET", "/collection");
  const found = list.find((c) => c.name === name && !c.archived && !c.personal_owner_id && c.location === "/");
  if (found) return Number(found.id);
  const c = await api<{ id: number }>("POST", "/collection", { name, description, parent_id: null });
  return c.id;
}

async function items(collectionId: number, model: "card" | "dashboard"): Promise<{ id: number; name: string }[]> {
  const r = await api<{ data: { id: number; name: string; model: string }[] }>("GET", `/collection/${collectionId}/items?models=${model}`);
  return r.data.filter((i) => i.model === model);
}

/** Kind: function. Read the embedding secret from the secrets file, or create one there (mode 600). */
function embedSecret(): string {
  const file = join(SECRETS, "metabase-embed-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, secret + "\n", { mode: 0o600 });
  console.log(`  embedding secret created in ${file} (set it as METABASE_EMBED_SECRET on Vercel)`);
  return secret;
}

/** Kind: function. "All Users" may read the system collection, see nothing restricted, and write Team reports. */
async function setCollectionPermissions(ids: { system: number; restricted: number; team: number }) {
  const groups = await api<{ id: number; name: string }[]>("GET", "/permissions/group");
  const all = groups.find((g) => g.name === "All Users");
  if (!all) return console.warn("  (group All Users not found: set collection permissions by hand)");
  const graph = await api<{ revision: number; groups: Record<string, Record<string, string>> }>("GET", "/collection/graph");
  graph.groups[all.id] = { ...(graph.groups[all.id] ?? {}), [ids.system]: "read", [ids.restricted]: "none", [ids.team]: "write" };
  await api("PUT", "/collection/graph", { revision: graph.revision, groups: { [all.id]: graph.groups[all.id] } });
}

async function main() {
  const dashboards = loadDashboards();
  const names = dashboards.flatMap((d) => d.reports.map((r) => `${d.collection}:${r.name}`));
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`Two reports share the name "${dup}" in one collection: names must be unique.`);
  console.log(`${dashboards.length} dashboards, ${names.length} reports in ${REPORTS_DIR}`);
  if (process.argv.includes("--dry-run")) return;

  await login();
  const roFile = join(SECRETS, "bi-ro-db-url");
  const engineUrl = process.env.BI_ENGINE_DATABASE_URL ?? (existsSync(roFile) ? readFileSync(roFile, "utf8").trim() : "");
  const websiteUrl = process.env.ANALYST_DATABASE_URL ?? "";
  const dbIds: Partial<Record<DbKey, number>> = {};
  if (engineUrl) dbIds.intelligence = await upsertDatabase("intelligence", engineUrl);
  else console.warn("  Intelligence DB skipped: run infra/vm/bin/metabase-install.sh or set BI_ENGINE_DATABASE_URL");
  if (websiteUrl) dbIds.website = await upsertDatabase("website", websiteUrl);
  else console.warn("  Website DB skipped: set ANALYST_DATABASE_URL (role fundhub_analyst_ro)");
  console.log(`data sources: ${Object.entries(dbIds).map(([k, v]) => `${DB_NAMES[k as DbKey]} #${v}`).join(", ") || "none"}`);

  const cols = {
    system: await upsertCollection(COLLECTIONS.system, "Reports maintained in the repo (infra/bi/reports). Edits here are overwritten by the next provisioning: copy a question to Team reports to change it."),
    restricted: await upsertCollection(COLLECTIONS.restricted, "Repo-maintained reports for owners only (finance)."),
    team: await upsertCollection(COLLECTIONS.team, "Questions and dashboards made by the team. Switch on embedding to show a dashboard in the admin console."),
  };
  await setCollectionPermissions(cols);
  // Metabase ships a sample "Examples" collection: archive it so staff only see FundHub's reports.
  const examples = (await api<{ id: number | string; name: string; archived?: boolean; location?: string }[]>("GET", "/collection")).find(
    (c) => c.name === "Examples" && !c.archived && c.location === "/",
  );
  if (examples) await api("PUT", `/collection/${examples.id}`, { archived: true });

  await api("PUT", "/setting/enable-embedding-static", { value: true });
  await api("PUT", "/setting/embedding-secret-key", { value: embedSecret() });

  for (const d of dashboards) {
    const db = dbIds[d.database];
    if (!db) {
      console.warn(`- ${d.name}: skipped (no ${DB_NAMES[d.database]})`);
      continue;
    }
    const collectionId = cols[d.collection];
    const existingCards = await items(collectionId, "card");
    const cardIds: number[] = [];
    for (const r of d.reports) {
      const body = {
        name: r.name,
        description: r.description ?? `Maintained in infra/bi/reports/${r.file}`,
        display: r.display,
        collection_id: collectionId,
        visualization_settings: vizSettings(r),
        dataset_query: { type: "native", database: db, native: { query: r.sql, "template-tags": {} } },
      };
      const found = existingCards.find((c) => c.name === r.name);
      const card = found ? await api<{ id: number }>("PUT", `/card/${found.id}`, body) : await api<{ id: number }>("POST", "/card", body);
      cardIds.push(card.id);
    }

    const found = (await items(collectionId, "dashboard")).find((x) => x.name === d.name);
    const dash = found ?? (await api<{ id: number }>("POST", "/dashboard", { name: d.name, description: d.description, collection_id: collectionId }));
    const current = await api<{ dashcards?: { id: number; card_id: number | null }[] }>("GET", `/dashboard/${dash.id}`);
    const pos = layout(d.reports);
    const dashcards = cardIds.map((cardId, i) => ({
      id: current.dashcards?.find((c) => c.card_id === cardId)?.id ?? -(i + 1),
      card_id: cardId,
      ...pos[i],
      parameter_mappings: [],
      visualization_settings: {},
    }));
    await api("PUT", `/dashboard/${dash.id}`, { description: d.description, dashcards, enable_embedding: true, embedding_params: {} });
    console.log(`- ${d.name}: dashboard #${dash.id}, ${cardIds.length} questions (${d.collection})`);
  }
  console.log("Done. Admin console: /admin/intelligence lists every dashboard with embedding switched on.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
