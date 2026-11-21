"use client";
/**
 * FILE: apps/admin/src/components/pipeline-diagram.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The interactive DATAFLOW DIAGRAM of the Company Intelligence pipeline, drawn from live counts:
 *
 *   Sources ─▶ Raw ─▶ Staging ─◇ approval gate ─▶ Clean ─▶ Match ─▶ Golden (core) ─▶ Publish ─▶ Website DB
 *                                ops: sources · precedence · review policies · runs · quality (under everything)
 *
 *   Every box shows its row counts; a red badge flags work waiting for a person (records held at the gate,
 *   conflicts, rejects, uncertain matches). Click a stage (or a source) to see what it does, the Postgres tables
 *   it owns and where to act on it. Plain SVG from computed coordinates, coloured with the antd theme tokens,
 *   so it follows light / dark mode.
 * WHERE IT RUNS: in the browser ("use client"); data from lib/engine-data.ts pipelineOverview().
 */

import Link from "next/link";
import { useState } from "react";
import { Button, Card, Descriptions, Space, Tag, Typography, theme } from "antd";

/** Kind: type alias. Per-source coverage row (mart.coverage_by_source). */
export type CoverageRow = { source: string; system: string; name: string; kind: string; enabled: boolean; records: number; found: number; linked: number; pending_review: number; last_run_at: string | null };

type StageId = "sources" | "raw" | "staging" | "gate" | "clean" | "match" | "core" | "publish" | "website" | "ops";

/** Kind: constant. What each stage is, which tables it owns, what to show, where to act. */
const STAGES: Record<StageId, { title: string; schema?: string; what: string; tables: string[]; metrics: [string, string][]; alerts?: [string, string][]; links: [string, string][] }> = {
  sources: { title: "Sources", what: "Where data comes from. LBR is the master list of every Luxembourg company; GLEIF, CSSF, FundHub accounts, company websites and news enrich and cross-check it. Social and people sources are registered but switched off (phase 2).", tables: ["ops.sources"], metrics: [], links: [["Sources & policies", "/engine/sources"], ["Jobs & schedules", "/engine/jobs"]] },
  raw: { title: "Raw (landing)", schema: "raw", what: "Append-only copy of everything acquired: one row per content version, bytes in object storage (addressed by SHA-256). Never updated, so every later stage can be re-run without re-scraping.", tables: ["raw.fetches", "raw.documents"], metrics: [["raw.fetches", "fetches"], ["raw.documents", "documents"]], links: [["Reprocess a source (Jobs)", "/engine/jobs"]] },
  staging: { title: "Staging", schema: "staging", what: "One row per id at a source (source_records) and every parsed version in the source's own vocabulary (parsed_records). Unchanged content is detected here by hash and stops.", tables: ["staging.source_records", "staging.parsed_records"], metrics: [["staging.source_records", "source records"], ["staging.parsed_records", "parsed versions"]], links: [["Database browser", "/db"]] },
  gate: { title: "Approval gate", what: "Optional human check before anything counts. A review policy per source decides: flow on automatically, hold every record, hold when a legal fact changes / confidence is low / a new company would be created, or spot-check a sample. Held versions wait for Approve, Edit & approve, or Reject.", tables: ["ops.review_policies", "staging.parsed_records (review_status)"], metrics: [["staging.pending_review", "waiting for approval"], ["staging.rejected", "rejected"]], alerts: [["staging.pending_review", "waiting"]], links: [["Approve now", "/engine/review?tab=staging"], ["Edit policies", "/engine/sources"]] },
  clean: { title: "Clean", schema: "clean", what: "Validation and normalization into FundHub's vocabulary: names, RCS / LEI, URLs (https, no tracking), generic e-mails only, phones in E.164, LU postcodes, ISO dates and countries. Facts become claims with history (SCD-2); refused values become rejects.", tables: ["clean.claims", "clean.rejects", "clean.licences", "clean.filings", "clean.web_pages", "clean.articles"], metrics: [["clean.claims_open", "current claims"], ["clean.licences", "CSSF licence lines"], ["clean.filings", "LBR filings"], ["clean.articles", "news articles"], ["clean.rejects", "rejected values"]], alerts: [["clean.rejects", "rejects"]], links: [["Rejects", "/engine/review?tab=rejects"]] },
  match: { title: "Match & cross-check", schema: "match", what: "Entity resolution: RCS number, LEI, CSSF id, FundHub listing, verified website domain, then name + postcode. Certain links apply automatically; doubtful ones wait as candidates. Where sources disagree about a company, a conflict is opened.", tables: ["match.candidates", "match.conflicts"], metrics: [["match.candidates_pending", "matches to review"], ["match.conflicts_open", "open conflicts"]], alerts: [["match.candidates_pending", "matches"], ["match.conflicts_open", "conflicts"]], links: [["Match review", "/engine/review?tab=matches"], ["Conflicts", "/engine/review?tab=conflicts"]] },
  core: { title: "Golden records (core)", schema: "core", what: "One company per real legal entity. Each field comes from the most trusted source that states it (attribute precedence; staff edits always win) and records its lineage. Also people and positions, web & social presence, news mentions, relations (clients, administrators…) and the change feed.", tables: ["core.companies", "core.company_identifiers", "core.company_names", "core.company_relations", "core.people", "core.positions", "core.web_presence", "core.news_mentions", "core.field_lineage", "core.changes"], metrics: [["core.companies", "companies"], ["core.service_providers", "service providers"], ["core.multi_source", "cross-checked (2+ sources)"], ["core.positions", "people in roles"], ["core.web_presence", "web & social profiles"], ["core.news_mentions", "news mentions"], ["core.relations", "relations"], ["core.changes_7d", "changes (7 days)"]], alerts: [["core.mentions_pending", "mentions"]], links: [["Companies", "/engine/companies"], ["Data quality", "/engine/quality"]] },
  publish: { title: "Publish", what: "Golden records of companies listed on FundHub are compared with their live listing; differences become proposals that staff accept field by field. The website never reads this database.", tables: ["website: ingest_records (source 'engine')"], metrics: [["publish.linked_providers", "linked listings"]], links: [["Publish review", "/pipeline"]] },
  website: { title: "Website DB", what: "fundhub.lu's own database (providers, accounts, claims, reviews…). It feeds the pipeline back as the 'FundHub accounts' source (read-only role).", tables: ["providers", "provider_claims", "profile_edits", "ingest_records"], metrics: [], links: [["Database map", "/db"]] },
  ops: { title: "Ops (pipeline control)", schema: "ops", what: "Spans every layer: source registry, attribute precedence, review policies, job runs and cursors, census snapshots, data-quality checks and results, LBR capture tooling, news feeds.", tables: ["ops.sources", "ops.attribute_precedence", "ops.review_policies", "ops.runs", "ops.quality_checks", "ops.quality_results", "ops.census_snapshots", "ops.news_feeds"], metrics: [], links: [["Jobs & schedules", "/engine/jobs"], ["Data quality", "/engine/quality"], ["Sources", "/engine/sources"]] },
};

/** Kind: constant. Source groups shown in the Sources column. */
const SOURCE_GROUPS: { label: string; kinds: string[] }[] = [
  { label: "Registers & regulator", kinds: ["register", "secondary_register", "regulator"] },
  { label: "Self-declared", kinds: ["self_declared"] },
  { label: "Web & news", kinds: ["web", "news"] },
  { label: "Social & people", kinds: ["social", "people", "reviews"] },
];

const W = 1240;
const COL = { sources: 20, raw: 250, staging: 390, gate: 535, clean: 600, match: 745, core: 890, publish: 1050, website: 1050 };
const BOX_W = 128;
const TOP = 46;

const nf = new Intl.NumberFormat("en");

/** Kind: React component. The diagram + the detail panel of the selected stage. */
export function PipelineDiagram({ metrics, coverage }: { metrics: Record<string, number>; coverage: CoverageRow[] }) {
  const { token } = theme.useToken();
  const [sel, setSel] = useState<StageId | null>("gate");
  const [selSource, setSelSource] = useState<string | null>(null);
  const m = (k: string) => metrics[k] ?? 0;
  const muted = token.colorTextSecondary;
  const font = "ui-monospace, SFMono-Regular, Menlo, monospace";

  // ---- Sources column layout
  const items: ({ kind: "group"; label: string; y: number } | { kind: "src"; row: CoverageRow; y: number })[] = [];
  let y = TOP;
  for (const g of SOURCE_GROUPS) {
    const rows = coverage.filter((c) => g.kinds.includes(c.kind));
    if (!rows.length) continue;
    items.push({ kind: "group", label: g.label, y });
    y += 18;
    for (const row of rows) {
      items.push({ kind: "src", row, y });
      y += 30;
    }
    y += 8;
  }
  const H = Math.max(y, 420) + 70;
  const midY = TOP + (Math.max(y, 420) - TOP) / 2;

  // ---- Stage boxes (x, height from the number of metric lines)
  const boxH = (id: StageId) => 44 + STAGES[id].metrics.length * 17;
  const stageBox = (id: StageId, x: number) => ({ id, x, y: midY - boxH(id) / 2, w: BOX_W, h: boxH(id) });
  const boxes = [stageBox("raw", COL.raw), stageBox("staging", COL.staging), stageBox("clean", COL.clean), stageBox("match", COL.match), stageBox("core", COL.core)];
  const publish = { id: "publish" as const, x: COL.publish, y: midY - 110, w: 150, h: 70 };
  const website = { id: "website" as const, x: COL.website, y: midY + 30, w: 150, h: 70 };
  const gate = { cx: COL.gate + 22, cy: midY, r: 26 };
  const opsBand = { x: COL.raw, y: H - 56, w: W - COL.raw - 20, h: 36 };

  const pending = m("staging.pending_review");
  const color = (id: StageId) => (sel === id ? { fill: token.colorPrimary, stroke: token.colorPrimary, text: "#fff", sub: "rgba(255,255,255,.85)" } : { fill: token.colorBgContainer, stroke: token.colorBorder, text: token.colorText, sub: muted });
  const alertCount = (id: StageId) => (STAGES[id].alerts ?? []).reduce((a, [k]) => a + m(k), 0);
  const pick = (id: StageId) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setSel(id);
    setSelSource(null);
  };

  const arrow = (x1: number, y1: number, x2: number, y2: number, key: string, dashed = false) => {
    const mx = (x1 + x2) / 2;
    return <path key={key} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 3},${y2}`} fill="none" stroke={muted} strokeWidth={1.3} strokeDasharray={dashed ? "4 4" : undefined} markerEnd="url(#pl-arrow)" />;
  };

  const st = sel ? STAGES[sel] : null;
  const src = selSource ? coverage.find((c) => c.source === selSource) : null;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <div style={{ overflowX: "auto", border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 12, background: token.colorBgLayout }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 1000, height: "auto", display: "block" }} role="img" aria-label="Dataflow of the Company Intelligence pipeline, from sources through raw, staging, the approval gate, clean, match and golden records to publishing" onClick={() => setSel(null)}>
          <defs>
            <marker id="pl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={muted} />
            </marker>
          </defs>

          {/* Column titles */}
          {[["SOURCES", COL.sources], ["RAW", COL.raw], ["STAGING", COL.staging], ["CLEAN", COL.clean], ["MATCH", COL.match], ["GOLDEN", COL.core], ["OUTPUT", COL.publish]].map(([t, x]) => (
            <text key={t as string} x={(x as number) + 2} y={24} fontSize={10.5} fontWeight={700} letterSpacing={1.2} fill={muted}>{t}</text>
          ))}

          {/* Sources */}
          <g>
            {items.map((it) =>
              it.kind === "group" ? (
                <text key={`g-${it.label}`} x={COL.sources} y={it.y + 10} fontSize={10.5} fontWeight={650} fill={muted}>{it.label}</text>
              ) : (
                <g key={it.row.source} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); setSel("sources"); setSelSource(it.row.source); }}>
                  <rect x={COL.sources} y={it.y} width={190} height={24} rx={6} fill={selSource === it.row.source ? token.colorPrimaryBg : token.colorBgContainer} stroke={selSource === it.row.source ? token.colorPrimary : token.colorBorder} strokeDasharray={it.row.enabled ? undefined : "4 3"} opacity={it.row.enabled ? 1 : 0.6} />
                  <text x={COL.sources + 8} y={it.y + 16} fontSize={11.5} fill={token.colorText}>{it.row.name.length > 22 ? it.row.name.slice(0, 21) + "…" : it.row.name}</text>
                  <text x={COL.sources + 182} y={it.y + 16} fontSize={10.5} textAnchor="end" fontFamily={font} fill={muted}>{it.row.enabled ? nf.format(it.row.found) : "off"}</text>
                  {it.row.pending_review > 0 && <circle cx={COL.sources + 190} cy={it.y} r={7} fill={token.colorError} />}
                  {it.row.pending_review > 0 && <text x={COL.sources + 190} y={it.y + 3.5} fontSize={8.5} textAnchor="middle" fill="#fff">{it.row.pending_review > 99 ? "99+" : it.row.pending_review}</text>}
                  {arrow(COL.sources + 192, it.y + 12, COL.raw, midY, `a-${it.row.source}`, !it.row.enabled)}
                </g>
              ),
            )}
          </g>

          {/* Flow arrows between stages */}
          {arrow(COL.raw + BOX_W, midY, COL.staging, midY, "raw-staging")}
          {arrow(COL.staging + BOX_W, midY, gate.cx - gate.r, midY, "staging-gate")}
          {arrow(gate.cx + gate.r, midY, COL.clean, midY, "gate-clean")}
          {arrow(COL.clean + BOX_W, midY, COL.match, midY, "clean-match")}
          {arrow(COL.match + BOX_W, midY, COL.core, midY, "match-core")}
          {arrow(COL.core + BOX_W, midY, publish.x, publish.y + publish.h / 2, "core-publish")}
          {arrow(publish.x + publish.w / 2, publish.y + publish.h, website.x + website.w / 2, website.y, "publish-website")}
          {/* FundHub accounts flow back from the website into the sources */}
          <path d={`M${website.x + website.w / 2},${website.y + website.h} C${website.x + website.w / 2},${H - 70} ${COL.sources + 100},${H - 70} ${COL.sources + 100},${y - 4}`} fill="none" stroke={token.colorWarning} strokeWidth={1.2} strokeDasharray="5 4" markerEnd="url(#pl-arrow)" />
          <text x={(website.x + COL.sources) / 2} y={H - 74} fontSize={10} fill={token.colorWarning} textAnchor="middle">FundHub accounts, claims & self-edits feed back as a source (read-only)</text>

          {/* Stage boxes */}
          {boxes.map((b) => {
            const c = color(b.id);
            const s = STAGES[b.id];
            const alerts = alertCount(b.id);
            return (
              <g key={b.id} style={{ cursor: "pointer" }} onClick={pick(b.id)}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} />
                <text x={b.x + 10} y={b.y + 20} fontSize={13} fontWeight={700} fill={c.text}>{s.title.replace(" (landing)", "").replace(" (core)", "").replace(" & cross-check", "")}</text>
                {s.schema && <text x={b.x + 10} y={b.y + 34} fontSize={9.5} fontFamily={font} fill={c.sub}>schema {s.schema}</text>}
                {s.metrics.map(([k, label], i) => (
                  <g key={k}>
                    <text x={b.x + 10} y={b.y + 52 + i * 17} fontSize={10.5} fill={c.sub}>{label.length > 15 ? label.slice(0, 14) + "…" : label}</text>
                    <text x={b.x + b.w - 10} y={b.y + 52 + i * 17} fontSize={10.5} textAnchor="end" fontFamily={font} fontWeight={600} fill={c.text}>{nf.format(m(k))}</text>
                  </g>
                ))}
                {alerts > 0 && (
                  <g>
                    <circle cx={b.x + b.w - 4} cy={b.y + 4} r={10} fill={token.colorError} />
                    <text x={b.x + b.w - 4} y={b.y + 7.5} fontSize={9} fontWeight={700} textAnchor="middle" fill="#fff">{alerts > 999 ? "1k+" : alerts}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Approval gate (diamond) */}
          <g style={{ cursor: "pointer" }} onClick={pick("gate")}>
            <path d={`M${gate.cx},${gate.cy - gate.r} L${gate.cx + gate.r},${gate.cy} L${gate.cx},${gate.cy + gate.r} L${gate.cx - gate.r},${gate.cy} Z`} fill={sel === "gate" ? token.colorPrimary : pending ? token.colorWarningBg : token.colorBgContainer} stroke={sel === "gate" ? token.colorPrimary : pending ? token.colorWarning : token.colorBorder} strokeWidth={1.6} />
            <text x={gate.cx} y={gate.cy + 4} fontSize={11} fontWeight={700} textAnchor="middle" fill={sel === "gate" ? "#fff" : token.colorText}>{nf.format(pending)}</text>
            <text x={gate.cx} y={gate.cy - gate.r - 8} fontSize={10.5} fontWeight={650} textAnchor="middle" fill={token.colorText}>Approval gate</text>
            <text x={gate.cx} y={gate.cy + gate.r + 15} fontSize={9.5} textAnchor="middle" fill={muted}>{pending ? "waiting for a person" : "optional, per source"}</text>
          </g>

          {/* Publish + website */}
          {[publish, website].map((b) => {
            const c = color(b.id);
            return (
              <g key={b.id} style={{ cursor: "pointer" }} onClick={pick(b.id)}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={c.fill} stroke={c.stroke} strokeWidth={1.5} strokeDasharray={b.id === "website" ? "5 4" : undefined} />
                <text x={b.x + 10} y={b.y + 22} fontSize={13} fontWeight={700} fill={c.text}>{b.id === "publish" ? "Publish proposals" : "Website DB (fundhub.lu)"}</text>
                <text x={b.x + 10} y={b.y + 40} fontSize={10.5} fill={c.sub}>{b.id === "publish" ? `${nf.format(m("publish.linked_providers"))} linked listings` : "providers · accounts · claims"}</text>
                <text x={b.x + 10} y={b.y + 56} fontSize={10.5} fill={c.sub}>{b.id === "publish" ? "staff accept field by field" : "never reads this database"}</text>
              </g>
            );
          })}

          {/* Ops band */}
          <g style={{ cursor: "pointer" }} onClick={pick("ops")}>
            <rect x={opsBand.x} y={opsBand.y} width={opsBand.w} height={opsBand.h} rx={8} fill={sel === "ops" ? token.colorPrimary : token.colorFillQuaternary} stroke={sel === "ops" ? token.colorPrimary : token.colorBorderSecondary} />
            <text x={opsBand.x + 12} y={opsBand.y + 22} fontSize={11.5} fontWeight={650} fill={sel === "ops" ? "#fff" : token.colorText}>ops</text>
            <text x={opsBand.x + 44} y={opsBand.y + 22} fontSize={11} fill={sel === "ops" ? "rgba(255,255,255,.85)" : muted}>source registry · attribute precedence · review policies · runs & cursors · census · data quality · LBR capture tooling · news feeds</text>
          </g>
        </svg>
      </div>

      {(st || src) && (
        <Card size="small" title={src ? `${src.name} (${src.system})` : st!.title} extra={src ? <Tag color={src.enabled ? "green" : "default"}>{src.enabled ? "enabled" : "off"}</Tag> : st!.schema ? <Tag>schema {st!.schema}</Tag> : null}>
          {src ? (
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="Code"><code>{src.source}</code></Descriptions.Item>
              <Descriptions.Item label="Records">{nf.format(src.records)} ({nf.format(src.found)} found)</Descriptions.Item>
              <Descriptions.Item label="Linked to a company">{nf.format(src.linked)}</Descriptions.Item>
              <Descriptions.Item label="Waiting at the gate">{nf.format(src.pending_review)}</Descriptions.Item>
            </Descriptions>
          ) : (
            <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Typography.Paragraph style={{ margin: 0 }}>{st!.what}</Typography.Paragraph>
              <div>
                <Typography.Text type="secondary">Tables: </Typography.Text>
                {st!.tables.map((t) => <Tag key={t} style={{ fontFamily: font, marginBottom: 4 }}>{t}</Tag>)}
              </div>
              {st!.metrics.length > 0 && (
                <Space wrap size={16}>
                  {st!.metrics.map(([k, label]) => (
                    <span key={k}><Typography.Text strong>{nf.format(m(k))}</Typography.Text> <Typography.Text type="secondary">{label}</Typography.Text></span>
                  ))}
                </Space>
              )}
            </Space>
          )}
          <Space wrap style={{ marginTop: 12 }}>
            {(src ? ([["Sources & policies", "/engine/sources"], ["Approve its records", `/engine/review?tab=staging&source=${src.source}`], ["Companies from it", `/engine/companies?source=${src.source}`]] as [string, string][]) : st!.links).map(([label, href]) => (
              <Link key={href} href={href}><Button size="small">{label}</Button></Link>
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
