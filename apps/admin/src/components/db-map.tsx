"use client";
/**
 * FILE: apps/admin/src/components/db-map.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The interactive map at the top of the Database page. Three layers, top to bottom:
 *   1. where data comes from (visitors, staff, provider websites, CSSF / GLEIF / LBR…);
 *   2. the parts of FundHub that read and write it (website, admin, Intelligence pipeline + its publish role, SQL console);
 *   3. the two databases (Website DB, Intelligence DB) — the Intelligence DB's tables grouped by pipeline layer
 *      (Postgres schemas raw / staging / clean / match / core / ops) — and the flows between them.
 *   Click a table: its foreign keys (what it points to / what points to it) and which parts can read or write
 *   it. Click a part: which tables it writes and reads. Everything shown comes from Postgres itself (foreign
 *   keys from pg_constraint, access from has_table_privilege), so it stays true when the schema changes.
 * WHERE IT RUNS: in the browser ("use client"); data comes from app/(console)/db/page.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: discriminated unions (`Sel`), `useMemo`, plain SVG drawn from computed
 *   coordinates (no diagram library).
 */

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { Button, Card, Empty, Select, Space, Switch, Tag, Typography, theme } from "antd";
import type { TableRow } from "./db-views";

/** Kind: type alias (exported). One foreign-key column pair: `from.fromCol` points at `to.toCol`. */
export type DbRelation = { from: string; fromCol: string; to: string; toCol: string };
/** Kind: type alias (exported). What one database role may do on one table (`live` = read from Postgres). */
export type DbAccess = { role: string; table: string; read: boolean; write: boolean; live: boolean };

type DbId = "main" | "engine";
type SystemId = "engine" | "admin" | "scraper" | "web" | "sql";
type Sel = { kind: "table"; id: string } | { kind: "system"; id: SystemId } | null;
type Level = "write" | "read" | null;

/** Kind: constant. The parts of FundHub that touch the databases, and what feeds each of them. */
const SYSTEMS: { id: SystemId; name: string; where: string; source: string; role: string | null; cx: number }[] = [
  { id: "engine", name: "Intelligence pipeline", where: "Azure VM · worker, scheduler, capture receiver", source: "LBR · GLEIF · CSSF · FundHub accounts · websites · news", role: null, cx: 204 },
  { id: "admin", name: "Admin console", where: "Vercel · fundhub.lu/admin", source: "Staff · Stripe · Resend", role: "fundhub_admin", cx: 432 },
  { id: "scraper", name: "Pipeline publish", where: "Azure VM · engine worker", source: "Golden records → proposals", role: "fundhub_scraper", cx: 696 },
  { id: "web", name: "Website", where: "Vercel · fundhub.lu", source: "Visitors · providers", role: "fundhub_web", cx: 904 },
  { id: "sql", name: "SQL console", where: "Admin → Database → SQL", source: "Analysts", role: "fundhub_analyst_ro", cx: 1112 },
];

/** Kind: constant. Table areas (docs/architecture.md §3), in placement order. Unlisted tables go to "Other". */
const AREAS: { db: DbId; name: string; tables: string[] }[] = [
  { db: "engine", name: "1 · Raw (landing)", tables: ["raw.fetches", "raw.documents"] },
  { db: "engine", name: "2 · Staging + approval gate", tables: ["staging.source_records", "staging.parsed_records"] },
  { db: "engine", name: "3 · Clean", tables: ["clean.claims", "clean.rejects", "clean.licences", "clean.filings", "clean.web_pages", "clean.articles"] },
  { db: "engine", name: "4 · Match & cross-check", tables: ["match.candidates", "match.conflicts"] },
  { db: "engine", name: "5 · Golden records (core)", tables: ["core.companies", "core.company_identifiers", "core.company_names", "core.company_relations", "core.company_groups", "core.company_group_members", "core.mandates", "core.mandate_evidence", "core.fund_events", "core.people", "core.positions", "core.web_presence", "core.news_mentions", "core.review_summaries", "core.field_lineage", "core.changes", "core.row_history", "core.activity_categories", "core.classification_rules"] },
  { db: "engine", name: "Ops (pipeline control)", tables: ["ops.sources", "ops.mandate_roles", "ops.attribute_precedence", "ops.review_policies", "ops.runs", "ops.cursors", "ops.settings", "ops.session_health", "ops.quality_checks", "ops.quality_results", "ops.census_snapshots", "ops.news_feeds", "ops.lbr_number_space", "ops.lbr_capture_rounds", "ops.lbr_capture_round_items", "ops.lbr_search_words"] },
  { db: "main", name: "Data pipeline staging", tables: ["ingest_runs", "ingest_jobs", "ingest_records"] },
  { db: "main", name: "Public catalogue", tables: ["providers", "reviews", "posts", "reports", "report_downloads"] },
  { db: "main", name: "Visitor accounts", tables: ["users", "sessions", "password_resets", "saved_providers", "provider_claims", "profile_edits", "rfi_requests", "rate_limits"] },
  { db: "main", name: "Money", tables: ["billing_customers", "subscriptions", "invoices", "expenses", "budgets"] },
  { db: "main", name: "Staff & audit", tables: ["staff_users", "staff_sessions", "staff_password_resets", "audit_log"] },
  { db: "main", name: "Communication", tables: ["email_messages", "social_posts"] },
  { db: "main", name: "Compliance", tables: ["gdpr_requests"] },
];
const AREA_COLORS = ["#2f6fdb", "#0f8a6a", "#c27c0e", "#7a4fd1", "#c2410c", "#be185d", "#0e7490", "#64748b", "#4d7c0f", "#9333ea"];

/** Kind: constant. Flows between areas (drawn as labelled arrows). */
const FLOWS: { from: string; to: string; label: string; planned?: boolean }[] = [
  { from: "Data pipeline staging", to: "Public catalogue", label: "staff review → publish" },
  { from: "Registry", to: "Data pipeline staging", label: "planned: register proposals", planned: true },
];

// ---- geometry (SVG units; the drawing scales to the card width)
const CW = 168; // chip width
const CH = 20; // chip height
const CG = 4; // gap between chips
const AP = 8; // area padding
const AH = 22; // area header
const COLW = CW + 2 * AP;
const COLG = 12;
const ZP = 14; // zone padding
const ZH = 56; // zone header (title, subtitle, room for the flow labels)
const SRC_Y = 8;
const SRC_H = 26;
const SYS_Y = 66;
const SYS_H = 56;
const SYS_W = 176;
const ZONE_Y = 196;
const ZONE_GAP = 48;
const ZONES: { db: DbId; title: string; sub: string; cols: number }[] = [
  { db: "engine", title: "Intelligence database", sub: "PostgreSQL 18 on the Azure VM · one schema per pipeline layer", cols: 2 },
  { db: "main", title: "Website database", sub: "Neon Postgres · what the business serves and runs on", cols: 4 },
];

const short = (t: string) => t.replace(/^engine\./, "");
const dbOf = (t: string): DbId => (t.startsWith("engine.") ? "engine" : "main");
const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));

type Box = { x: number; y: number; w: number; h: number };
type Layout = {
  W: number;
  H: number;
  zones: (Box & { db: DbId; title: string; sub: string; empty: boolean })[];
  areas: (Box & { name: string; db: DbId; color: string })[];
  chips: Map<string, Box & { area: string; color: string }>;
};

/** Kind: function. Places zones, areas (masonry: each area goes to the shortest column) and table chips. */
function layout(tables: TableRow[]): Layout {
  const byDb: Record<DbId, string[]> = { main: [], engine: [] };
  for (const t of tables) byDb[dbOf(t.table)].push(t.table);
  const zones: Layout["zones"] = [];
  const areas: Layout["areas"] = [];
  const chips: Layout["chips"] = new Map();
  let x = 0;
  let H = 0;
  let colorIx = 0;
  for (const z of ZONES) {
    const w = z.cols * COLW + (z.cols - 1) * COLG + 2 * ZP;
    const present = new Set(byDb[z.db].map(short));
    const known = new Set<string>();
    const groups = AREAS.filter((a) => a.db === z.db).map((a) => {
      a.tables.forEach((t) => known.add(t));
      return { name: a.name, tables: a.tables.filter((t) => present.has(t)) };
    });
    groups.push({ name: "Other", tables: [...present].filter((t) => !known.has(t)).sort() });
    const colH = new Array(z.cols).fill(0);
    for (const g of groups) {
      if (!g.tables.length) continue;
      const color = AREA_COLORS[colorIx++ % AREA_COLORS.length];
      const c = colH.indexOf(Math.min(...colH));
      const ax = x + ZP + c * (COLW + COLG);
      const ay = ZONE_Y + ZH + colH[c];
      const h = AH + AP + g.tables.length * (CH + CG) - CG + AP;
      areas.push({ name: g.name, db: z.db, color, x: ax, y: ay, w: COLW, h });
      g.tables.forEach((t, i) => chips.set(z.db === "engine" ? `engine.${t}` : t, { x: ax + AP, y: ay + AH + AP + i * (CH + CG), w: CW, h: CH, area: g.name, color }));
      colH[c] += h + 12;
    }
    const inner = Math.max(...colH, 60);
    zones.push({ db: z.db, title: z.title, sub: z.sub, x, y: ZONE_Y, w, h: ZH + inner - 12 + ZP + 12, empty: present.size === 0 });
    H = Math.max(H, ZONE_Y + ZH + inner + ZP + 12);
    x += w + ZONE_GAP;
  }
  return { W: x - ZONE_GAP, H, zones, areas, chips };
}

/** Kind: function. SVG path for a foreign key between two chips (same column: a bulge on the right). */
function fkPath(a: Box, b: Box): string {
  const ay = a.y + CH / 2;
  const by = b.y + CH / 2;
  if (Math.abs(a.x - b.x) < 1) {
    const x1 = a.x + CW;
    const bulge = 18 + Math.min(42, Math.abs(a.y - b.y) / 5);
    return `M${x1},${ay} C${x1 + bulge},${ay} ${x1 + bulge},${by} ${x1 + 2},${by}`;
  }
  const right = b.x > a.x;
  const x1 = right ? a.x + CW : a.x;
  const x2 = right ? b.x - 2 : b.x + CW + 2;
  const dx = Math.max(30, Math.abs(x2 - x1) / 2);
  return `M${x1},${ay} C${x1 + (right ? dx : -dx)},${ay} ${x2 + (right ? -dx : dx)},${by} ${x2},${by}`;
}

/**
 * Kind: React component (exported; used by TablesOverview on /db).
 * @param tables     every table of both databases (engine ones prefixed "engine.").
 * @param relations  foreign keys of both databases.
 * @param access     which website-database role may read / write which table.
 */
export function DbMap({ tables, relations, access }: { tables: TableRow[]; relations: DbRelation[]; access: DbAccess[] }) {
  const { token } = theme.useToken();
  const [sel, setSel] = useState<Sel>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const L = useMemo(() => layout(tables), [tables]);
  const byName = useMemo(() => new Map(tables.map((t) => [t.table, t])), [tables]);
  const rels = useMemo(() => relations.filter((r) => r.from !== r.to && L.chips.has(r.from) && L.chips.has(r.to)), [relations, L]);
  const roleAccess = useMemo(() => new Map(access.map((a) => [`${a.role}|${a.table}`, a])), [access]);
  const grantsLive = access.some((a) => a.live);

  /** What a part of FundHub may do on a table. */
  const levelOf = (sys: SystemId, table: string): Level => {
    if (dbOf(table) === "engine") return sys === "engine" || sys === "admin" ? "write" : null;
    const role = SYSTEMS.find((s) => s.id === sys)!.role;
    const a = role ? roleAccess.get(`${role}|${table}`) : undefined;
    return a?.write ? "write" : a?.read ? "read" : null;
  };

  // What is highlighted: the selected (or hovered) table and its foreign-key neighbours, or a part's tables.
  const focusTable = sel?.kind === "table" ? sel.id : hover;
  const neighbours = useMemo(() => {
    const n = new Set<string>();
    if (focusTable) for (const r of rels) {
      if (r.from === focusTable) n.add(r.to);
      if (r.to === focusTable) n.add(r.from);
    }
    return n;
  }, [focusTable, rels]);
  const visibleRels = showAll ? rels : focusTable ? rels.filter((r) => r.from === focusTable || r.to === focusTable) : [];

  const chipStyle = (t: string) => {
    const base = { fill: token.colorBgContainer, stroke: token.colorBorder, text: token.colorText, opacity: 1, width: 1 };
    if (sel?.kind === "system") {
      const lv = levelOf(sel.id, t);
      if (lv === "write") return { ...base, fill: token.colorSuccessBg, stroke: token.colorSuccess };
      if (lv === "read") return { ...base, fill: token.colorInfoBg, stroke: token.colorInfo };
      return { ...base, opacity: 0.3 };
    }
    if (focusTable) {
      if (t === focusTable) return { ...base, fill: token.colorPrimary, stroke: token.colorPrimary, text: "#fff", width: 1.5 };
      if (neighbours.has(t)) return { ...base, fill: token.colorPrimaryBg, stroke: token.colorPrimary, width: 1.5 };
      return { ...base, opacity: 0.3 };
    }
    return base;
  };

  const sysActive = (id: SystemId) => {
    if (sel?.kind === "system") return sel.id === id ? "on" : "dim";
    if (focusTable) return levelOf(id, focusTable) ? "on" : "dim";
    return "normal";
  };

  const zoneOf = (db: DbId) => L.zones.find((z) => z.db === db)!;
  const areaBox = (name: string) => L.areas.find((a) => a.name === name);

  // Part → database links (one per database the part uses), labelled with its role.
  const links = SYSTEMS.flatMap((s) => {
    const out: { sys: SystemId; db: DbId; x1: number; x2: number; label: string }[] = [];
    const eng = zoneOf("engine");
    const main = zoneOf("main");
    if (s.id === "engine") out.push({ sys: s.id, db: "engine", x1: s.cx, x2: s.cx, label: "reads + writes" });
    if (s.id === "admin") {
      out.push({ sys: s.id, db: "engine", x1: s.cx - 40, x2: eng.x + eng.w - 70, label: "engine pages" });
      out.push({ sys: s.id, db: "main", x1: s.cx + 40, x2: main.x + 70, label: s.role! });
    }
    if (s.id === "scraper" || s.id === "web" || s.id === "sql") out.push({ sys: s.id, db: "main", x1: s.cx, x2: s.cx, label: s.role! });
    return out;
  });

  const pick = (t: string) => setSel(sel?.kind === "table" && sel.id === t ? null : { kind: "table", id: t });
  const font = "ui-monospace, SFMono-Regular, Consolas, monospace";
  const muted = token.colorTextSecondary;

  return (
    <Card
      size="small"
      style={{ marginBottom: 16 }}
      title="How the data fits together"
      extra={
        <Space wrap>
          <Select
            showSearch
            allowClear
            placeholder="Find a table…"
            style={{ width: 220 }}
            value={sel?.kind === "table" ? sel.id : undefined}
            onChange={(v) => setSel(v ? { kind: "table", id: v } : null)}
            options={[...L.chips.keys()].sort().map((t) => ({ value: t, label: t }))}
          />
          <Space size={6}>
            <Switch size="small" checked={showAll} onChange={setShowAll} />
            <Typography.Text type="secondary">All relationships</Typography.Text>
          </Space>
        </Space>
      }
    >
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`-4 0 ${L.W + 8} ${L.H}`} style={{ width: "100%", minWidth: 980, height: "auto", display: "block" }} onClick={() => setSel(null)} role="img" aria-label="Map of FundHub's databases, tables and the systems that use them">
          <defs>
            <marker id="fh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={token.colorPrimary} />
            </marker>
            <marker id="fh-arrow-flow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={token.colorWarning} />
            </marker>
            <marker id="fh-arrow-muted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={muted} />
            </marker>
          </defs>

          {/* 1. sources → 2. parts */}
          {SYSTEMS.map((s) => {
            const st = sysActive(s.id);
            const on = st === "on" || (sel?.kind === "system" && sel.id === s.id);
            const lv = focusTable ? levelOf(s.id, focusTable) : null;
            return (
              <g key={s.id} opacity={st === "dim" ? 0.35 : 1} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setSel(sel?.kind === "system" && sel.id === s.id ? null : { kind: "system", id: s.id }); }}>
                <rect x={s.cx - SYS_W / 2} y={SRC_Y} width={SYS_W} height={SRC_H} rx={13} fill={token.colorFillQuaternary} stroke={token.colorBorderSecondary} />
                <text x={s.cx} y={SRC_Y + 17} textAnchor="middle" fontSize={11} fill={muted}>{s.source}</text>
                <line x1={s.cx} y1={SRC_Y + SRC_H} x2={s.cx} y2={SYS_Y - 2} stroke={muted} markerEnd="url(#fh-arrow-muted)" />
                <rect x={s.cx - SYS_W / 2} y={SYS_Y} width={SYS_W} height={SYS_H} rx={8} fill={on ? token.colorPrimary : token.colorBgContainer} stroke={on ? token.colorPrimary : token.colorBorder} strokeWidth={1.5} />
                <text x={s.cx} y={SYS_Y + 22} textAnchor="middle" fontSize={13} fontWeight={650} fill={on ? "#fff" : token.colorText}>{s.name}</text>
                <text x={s.cx} y={SYS_Y + 39} textAnchor="middle" fontSize={10} fill={on ? "rgba(255,255,255,.8)" : muted}>{s.where}</text>
                {lv && <text x={s.cx} y={SYS_Y + SYS_H + 14} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={lv === "write" ? token.colorSuccess : token.colorInfo}>{lv === "write" ? "reads + writes" : "reads only"}</text>}
              </g>
            );
          })}

          {/* 2. parts → 3. databases */}
          {links.map((l, i) => {
            const st = sysActive(l.sys);
            const z = zoneOf(l.db);
            const relevant = focusTable ? dbOf(focusTable) === l.db && st === "on" : st !== "dim";
            const y1 = SYS_Y + SYS_H + (focusTable ? 18 : 0);
            const my = (y1 + z.y) / 2;
            return (
              <g key={i} opacity={relevant ? 1 : 0.2}>
                <path d={`M${l.x1},${y1} C${l.x1},${my} ${l.x2},${my} ${l.x2},${z.y - 2}`} fill="none" stroke={st === "on" ? token.colorPrimary : muted} strokeWidth={st === "on" ? 2 : 1.2} markerEnd={st === "on" ? "url(#fh-arrow)" : "url(#fh-arrow-muted)"} />
                {!focusTable && <text x={(l.x1 + l.x2) / 2 + 6} y={my + 4} fontSize={10} fontFamily={font} fill={muted}>{l.label}</text>}
              </g>
            );
          })}

          {/* 3. databases, areas, tables */}
          {L.zones.map((z) => (
            <g key={z.db}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={12} fill={token.colorFillQuaternary} stroke={token.colorBorder} strokeDasharray={z.db === "engine" ? "5 4" : undefined} />
              <text x={z.x + ZP} y={z.y + 18} fontSize={13} fontWeight={700} fill={token.colorText}>{z.title}</text>
              <text x={z.x + ZP} y={z.y + 31} fontSize={10.5} fill={muted}>{z.sub}</text>
              {z.empty && <text x={z.x + z.w / 2} y={z.y + 80} textAnchor="middle" fontSize={12} fill={muted}>Not reachable from this console right now</text>}
            </g>
          ))}
          {L.areas.map((a) => (
            <g key={a.db + a.name}>
              <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={8} fill={token.colorBgContainer} stroke={token.colorBorderSecondary} />
              <rect x={a.x} y={a.y + 6} width={3} height={12} rx={1.5} fill={a.color} />
              <text x={a.x + AP + 2} y={a.y + 16} fontSize={11} fontWeight={650} fill={a.color}>{a.name}</text>
            </g>
          ))}

          {/* flows between areas */}
          {FLOWS.map((f) => {
            const a = areaBox(f.from);
            const b = areaBox(f.to);
            if (!a || !b) return null;
            const x1 = a.x + a.w;
            const x2 = b.x;
            const peak = Math.min(a.y, b.y) - 16;
            return (
              <g key={f.label} opacity={focusTable || sel ? 0.25 : 1}>
                <path d={`M${x1 - 30},${a.y} C${x1 - 10},${peak} ${x2 + 10},${peak} ${x2 + 30},${b.y - 2}`} fill="none" stroke={token.colorWarning} strokeWidth={1.6} strokeDasharray={f.planned ? "4 4" : undefined} markerEnd="url(#fh-arrow-flow)" />
                <text x={(x1 + x2) / 2} y={peak + 4} textAnchor="middle" fontSize={10} fontWeight={600} fill={token.colorWarningText} paintOrder="stroke" stroke={token.colorBgLayout} strokeWidth={4} strokeLinejoin="round">{f.label}</text>
              </g>
            );
          })}

          {/* foreign keys (under the chips' labels, above the area boxes) */}
          {visibleRels.map((r, i) => {
            const a = L.chips.get(r.from)!;
            const b = L.chips.get(r.to)!;
            const strong = focusTable && (r.from === focusTable || r.to === focusTable);
            return <path key={i} d={fkPath(a, b)} fill="none" stroke={strong ? token.colorPrimary : muted} strokeOpacity={strong ? 0.9 : 0.35} strokeWidth={strong ? 1.6 : 1} markerEnd={strong ? "url(#fh-arrow)" : "url(#fh-arrow-muted)"} />;
          })}

          {[...L.chips.entries()].map(([t, c]) => {
            const row = byName.get(t);
            const s = chipStyle(t);
            const count = row ? compact(row.rows) : "";
            const maxChars = Math.floor((CW - 18 - count.length * 5.6) / 6.2);
            const name = short(t);
            return (
              <g
                key={t}
                role="button"
                tabIndex={0}
                aria-label={`Table ${t}`}
                opacity={s.opacity}
                style={{ cursor: "pointer", outline: "none" }}
                onClick={(e) => { e.stopPropagation(); pick(t); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(t); } }}
                onMouseEnter={() => setHover(t)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${t}${row?.label ? ` — ${row.label}` : ""}\n${row ? row.rows.toLocaleString() + " rows · " + row.size : ""}`}</title>
                <rect x={c.x} y={c.y} width={CW} height={CH} rx={4} fill={s.fill} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={row?.restricted ? "3 2" : undefined} />
                <text x={c.x + 6} y={c.y + 14} fontSize={10.5} fontFamily={font} fill={s.text}>{name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name}</text>
                <text x={c.x + CW - 6} y={c.y + 14} fontSize={9.5} textAnchor="end" fill={s.text === "#fff" ? "rgba(255,255,255,.8)" : muted}>{count}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <Legend token={token} grantsLive={grantsLive} />
      <Details sel={sel} setSel={setSel} byName={byName} rels={rels} levelOf={levelOf} chips={L.chips} />
    </Card>
  );
}

/** Kind: React component. The colour key under the drawing. */
function Legend({ token, grantsLive }: { token: ReturnType<typeof theme.useToken>["token"]; grantsLive: boolean }) {
  const sw = (fill: string, stroke: string, dash?: boolean) => (
    <span style={{ display: "inline-block", width: 18, height: 11, borderRadius: 3, background: fill, border: `1px ${dash ? "dashed" : "solid"} ${stroke}`, verticalAlign: -1, marginRight: 6 }} />
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12, color: token.colorTextSecondary, marginTop: 8 }}>
      <span>{sw(token.colorPrimary, token.colorPrimary)}selected table</span>
      <span>{sw(token.colorPrimaryBg, token.colorPrimary)}linked by a foreign key (arrow points at the referenced table)</span>
      <span>{sw(token.colorSuccessBg, token.colorSuccess)}part can write</span>
      <span>{sw(token.colorInfoBg, token.colorInfo)}part can only read</span>
      <span>{sw(token.colorBgContainer, token.colorBorder, true)}restricted (secrets)</span>
      <span>number = rows</span>
      <span>{grantsLive ? "access = live Postgres grants" : "access = expected grants (roles not found in this database)"}</span>
    </div>
  );
}

/** Kind: React component. What the selection means: a table's links and access, or a part's tables. */
function Details({
  sel,
  setSel,
  byName,
  rels,
  levelOf,
  chips,
}: {
  sel: Sel;
  setSel: (s: Sel) => void;
  byName: Map<string, TableRow>;
  rels: DbRelation[];
  levelOf: (s: SystemId, t: string) => Level;
  chips: Layout["chips"];
}) {
  const tag = (t: string, extra?: string) => (
    <Tag key={t + (extra ?? "")} style={{ cursor: "pointer", marginBottom: 4 }} onClick={() => setSel({ kind: "table", id: t })}>
      <span className="mono">{t}</span>
      {extra && <span style={{ opacity: 0.6 }}> {extra}</span>}
    </Tag>
  );
  const box: CSSProperties = { marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(128,128,128,.2)" };

  if (!sel)
    return (
      <div style={box}>
        <Typography.Text type="secondary">
          Click a <b>table</b> to see what it is linked to and who can change it, or a <b>part</b> (Website, Admin console…) to see which tables it reads and writes. Hover a table for a quick look.
        </Typography.Text>
      </div>
    );

  if (sel.kind === "system") {
    const s = SYSTEMS.find((x) => x.id === sel.id)!;
    const all = [...chips.keys()];
    const writes = all.filter((t) => levelOf(s.id, t) === "write");
    const reads = all.filter((t) => levelOf(s.id, t) === "read");
    return (
      <div style={box}>
        <Typography.Title level={5} style={{ margin: 0 }}>{s.name}</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {s.where} · fed by {s.source}
          {s.role && <> · database role <span className="mono">{s.role}</span></>}
        </Typography.Paragraph>
        <div style={{ marginBottom: 6 }}><b>Writes ({writes.length})</b></div>
        <div>{writes.length ? writes.map((t) => tag(t)) : <Typography.Text type="secondary">nothing</Typography.Text>}</div>
        <div style={{ margin: "8px 0 6px" }}><b>Reads only ({reads.length})</b></div>
        <div>{reads.length ? reads.map((t) => tag(t)) : <Typography.Text type="secondary">nothing</Typography.Text>}</div>
      </div>
    );
  }

  const row = byName.get(sel.id);
  const out = rels.filter((r) => r.from === sel.id);
  const inc = rels.filter((r) => r.to === sel.id);
  const who = SYSTEMS.map((s) => ({ s, lv: levelOf(s.id, sel.id) })).filter((x) => x.lv);
  if (!row) return <div style={box}><Empty description="Unknown table" /></div>;
  return (
    <div style={box}>
      <Space align="baseline" wrap style={{ justifyContent: "space-between", width: "100%" }}>
        <Space align="baseline" wrap>
          <Typography.Title level={5} style={{ margin: 0 }}><span className="mono">{row.table}</span></Typography.Title>
          {row.label && <Typography.Text type="secondary">{row.label}</Typography.Text>}
          <Tag>{chips.get(row.table)?.area}</Tag>
          <Typography.Text type="secondary">{row.rows.toLocaleString()} rows · {row.size}</Typography.Text>
        </Space>
        {row.resource ? (
          <Link href={`/db/${row.resource}`}><Button size="small" type="primary">Browse rows</Button></Link>
        ) : (
          <Typography.Text type="secondary">{row.restricted ? "Restricted: never shown" : "Only through the SQL console"}</Typography.Text>
        )}
      </Space>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 10 }}>
        <div>
          <div style={{ marginBottom: 6 }}><b>Points to</b> <Typography.Text type="secondary">(its foreign keys)</Typography.Text></div>
          {out.length ? out.map((r) => tag(r.to, `via ${r.fromCol}`)) : <Typography.Text type="secondary">nothing</Typography.Text>}
        </div>
        <div>
          <div style={{ marginBottom: 6 }}><b>Pointed to by</b></div>
          {inc.length ? inc.map((r) => tag(r.from, `.${r.fromCol}`)) : <Typography.Text type="secondary">nothing</Typography.Text>}
        </div>
        <div>
          <div style={{ marginBottom: 6 }}><b>Used by</b></div>
          {who.length ? who.map(({ s, lv }) => (
            <Tag key={s.id} color={lv === "write" ? "green" : "blue"} style={{ cursor: "pointer", marginBottom: 4 }} onClick={() => setSel({ kind: "system", id: s.id })}>
              {s.name} · {lv === "write" ? "read + write" : "read"}
            </Tag>
          )) : <Typography.Text type="secondary">no part has access</Typography.Text>}
        </div>
      </div>
    </div>
  );
}
