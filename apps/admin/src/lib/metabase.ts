/**
 * FILE: apps/admin/src/lib/metabase.ts
 * PART: console (apps/admin) — Data intelligence
 * WHAT IT DOES: Connects the console to FundHub Data Intelligence (Metabase on the Azure VM, https://<vm>/bi):
 *   - `listDashboards()`: the dashboards with embedding switched on (the repo's system reports, plus any team
 *     report someone switched on), with their collection, read through Metabase's API with METABASE_API_KEY;
 *   - `embedUrl()`: a short-lived signed address (JWT, HS256, METABASE_EMBED_SECRET) that shows one dashboard
 *     inside the console. Metabase checks the signature; a viewer cannot change which dashboard or filters.
 *   Configuration (Vercel, project fund-hub-admin): METABASE_SITE_URL (default: the VM's /bi), METABASE_EMBED_SECRET
 *   (~/.fundhub-secrets/metabase-embed-secret on the VM), METABASE_API_KEY. See docs/data-intelligence.md.
 * WHERE IT RUNS: only on the server (the secret and the API key never reach the browser).
 */

import "server-only";
import { createHmac } from "node:crypto";

/** Kind: constant. Collection names created by infra/bi/provision.ts (keep both files in step). */
export const COLLECTIONS = {
  system: "FundHub system reports",
  restricted: "FundHub restricted reports",
  team: "Team reports",
} as const;

/** Kind: constant. Metabase on the VM when METABASE_SITE_URL is not set. */
const DEFAULT_SITE_URL = "https://alejandro-code.centralindia.cloudapp.azure.com/bi";
/** Kind: constant. How long a signed embed address stays valid (seconds). The page asks for a new one each visit. */
export const EMBED_TTL_SECONDS = 10 * 60;

/** Kind: function. Metabase's public address, without a trailing slash. */
export function metabaseUrl(): string {
  return (process.env.METABASE_SITE_URL?.trim() || DEFAULT_SITE_URL).replace(/\/+$/, "");
}

/** Kind: function. Which settings are missing (empty list = ready). */
export function missingConfig(): string[] {
  return ["METABASE_EMBED_SECRET", "METABASE_API_KEY"].filter((k) => !process.env[k]?.trim());
}

export type BiDashboard = {
  id: number;
  name: string;
  description: string | null;
  collection: string;
  /** "system" (repo-maintained), "restricted" (repo-maintained, owners only) or "team" (made by staff). */
  kind: "system" | "restricted" | "team";
  updatedAt: string | null;
};

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/**
 * Kind: function. Signs a Metabase static-embedding token.
 * @param payload  `{ resource, params }`; `exp` is added.
 * @param secret   the embedding secret.
 * @param now      seconds since 1970 (for tests).
 */
export function signEmbedToken(
  payload: { resource: { dashboard: number } | { question: number }; params: Record<string, unknown> },
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, exp: now + EMBED_TTL_SECONDS }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/**
 * Kind: function. The address to put in the console's iframe for one dashboard.
 * `#bordered=false&titled=false`: the console draws its own title; theme follows the console (light).
 */
export function embedUrl(dashboardId: number, params: Record<string, unknown> = {}): string {
  const secret = process.env.METABASE_EMBED_SECRET?.trim();
  if (!secret) throw new Error("METABASE_EMBED_SECRET is not set");
  const token = signEmbedToken({ resource: { dashboard: dashboardId }, params }, secret);
  return `${metabaseUrl()}/embed/dashboard/${token}#bordered=false&titled=false`;
}

/** Kind: function. The dashboard in the full Metabase app (to change it; needs the VM login + Metabase login). */
export function editUrl(dashboardId: number): string {
  return `${metabaseUrl()}/dashboard/${dashboardId}`;
}

/** Kind: function. Collection name → kind. Anything outside the two repo collections counts as a team report. */
export function kindOf(collection: string): BiDashboard["kind"] {
  if (collection === COLLECTIONS.restricted) return "restricted";
  if (collection === COLLECTIONS.system) return "system";
  return "team";
}

async function api<T>(path: string): Promise<T> {
  const key = process.env.METABASE_API_KEY?.trim();
  if (!key) throw new Error("METABASE_API_KEY is not set");
  const res = await fetch(`${metabaseUrl()}/api${path}`, {
    headers: { "X-Api-Key": key },
    // Lists change rarely: reuse the answer for 5 minutes (a newly switched-on team dashboard shows up within that).
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Metabase answered ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/**
 * Kind: async function. Every dashboard with embedding switched on, system reports first.
 * Two calls: /dashboard/embeddable (which ones are embeddable) and /search (their collection and description).
 */
export async function listDashboards(): Promise<BiDashboard[]> {
  const [embeddable, search] = await Promise.all([
    api<{ id: number; name: string }[]>("/dashboard/embeddable"),
    api<{ data: { id: number; name: string; description: string | null; collection?: { name?: string } | null; archived?: boolean; updated_at?: string }[] }>(
      "/search?models=dashboard",
    ),
  ]);
  const info = new Map(search.data.map((d) => [d.id, d]));
  const order = { system: 0, restricted: 1, team: 2 } as const;
  return embeddable
    .map((e) => {
      const d = info.get(e.id);
      const collection = d?.collection?.name ?? COLLECTIONS.team;
      return { id: e.id, name: e.name, description: d?.description ?? null, collection, kind: kindOf(collection), updatedAt: d?.updated_at ?? null, archived: d?.archived };
    })
    .filter((d) => !d.archived)
    .map(({ archived: _archived, ...d }) => d)
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}
