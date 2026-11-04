"use client";
/**
 * FILE: apps/admin/src/components/dashboard-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's home page (Dashboard). It greets the staff member and shows clickable number
 *   tiles: work waiting for staff ("Needs attention": claims, reviews, inbox, scraped records, GDPR requests,
 *   drafts), business figures for the last 30 days (revenue, unpaid invoices, requests, accounts…), how fresh
 *   each scraped data source is, and the latest staff actions from the audit log.
 * WHERE IT RUNS: in the browser (`"use client"`), mainly so dates can show as "3 hours ago" and tiles can be
 *   hoverable links. The numbers are gathered on the server by `getDashboard` and passed in as `data`.
 * FRAMEWORK NOTES:
 *   - React component = function returning JSX; "props" are its inputs (written like HTML attributes).
 *   - antd: `Card`, `Statistic` (a big number with a title), `Row`/`Col` (24-column grid), `List` (draws one
 *     `List.Item` per array item via `renderItem`), `Badge` (coloured status dot), `Tag`, `Alert`.
 *   - Next.js `Link`: a link that changes Console page without reloading the whole app.
 *   - dayjs "plugins" add extra abilities; `relativeTime` adds `.fromNow()` ("2 days ago").
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` + `Awaited<ReturnType<typeof fn>>` (the type of what an async function gives back);
 *   - optional props `href?: string`; union `number | string`;
 *   - storing JSX in a variable (`const body = (<Card>…</Card>)`) and choosing how to wrap it;
 *   - ternaries (also nested), `&&`, `??`, `!!x` (to true/false), template strings.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@/…` = this app's src folder.

// Next.js link component.
import Link from "next/link";
// antd UI components (see FRAMEWORK NOTES).
import { Alert, Badge, Card, Col, List, Row, Statistic, Tag, Typography } from "antd";
// dayjs date library and its "relative time" plugin.
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
// Only the TYPE of the server function that gathers the dashboard numbers.
import type { getDashboard } from "@/lib/metrics";

// Switch on the plugin once, when this file loads, so `.fromNow()` works everywhere below.
dayjs.extend(relativeTime);

/**
 * Kind: type alias. "Whatever `getDashboard` returns once its Promise resolves": `typeof` gets the function's
 * type, `ReturnType` what it returns (a Promise), `Awaited` what is inside the Promise. It stays in step with
 * the server code automatically.
 */
type Data = Awaited<ReturnType<typeof getDashboard>>;
/**
 * Kind: constant holding an arrow function.
 * @param cents  `number` — euro cents.
 * @returns      `string` like "€1,250" (whole euros, thousands separators).
 */
const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

/**
 * Kind: React component (private).
 * One number tile, optionally a link to the page where the work is done.
 * @param title   `string` — the label above the number.
 * @param value   `number | string` — the number, or already-formatted text such as "€1,250".
 * @param href    optional `string` — page to open on click; without it the tile is not clickable.
 * @param alert   optional `boolean` — true draws the number in amber to draw attention.
 * @param suffix  optional `string` — small text after the number, e.g. "(12 verified)".
 * @returns       JSX for the tile.
 */
function Tile({ title, value, href, alert, suffix }: { title: string; value: number | string; href?: string; alert?: boolean; suffix?: string }) {
  // Build the card once and keep it in a variable (JSX is just a value). `hoverable={!!href}`: lift on hover
  // only if it is a link. `tabular-nums` makes all digits equal width so numbers line up.
  const body = (
    <Card hoverable={!!href} size="small" style={{ height: "100%" }}>
      <Statistic title={title} value={value} suffix={suffix} valueStyle={{ color: alert ? "#b45309" : "#1e2632", fontVariantNumeric: "tabular-nums" }} />
    </Card>
  );
  // With a link address, wrap the card in a `Link`; otherwise return the bare card.
  return href ? <Link href={href}>{body}</Link> : body;
}

/**
 * Kind: React component (exported; used by the Console home page).
 * @param data       `Data` — all dashboard figures from the server.
 * @param staffName  `string` — the signed-in staff member's name, for the greeting.
 * @param denied     `boolean` — true when the user was sent here after trying to open a section their role
 *                   may not see; a warning is then shown.
 * @returns          JSX for the dashboard.
 */
export function DashboardView({ data, staffName, denied }: { data: Data; staffName: string; denied: boolean }) {
  // A short name for the counts object, to keep the lines below readable.
  const c = data.counts;
  return (
    // A CSS grid with 16px gaps stacks all sections vertically.
    <div style={{ display: "grid", gap: 16 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Good to see you, {staffName}
      </Typography.Title>
      {/* `denied && <Alert>`: the warning only appears when `denied` is true. */}
      {denied && <Alert type="warning" showIcon message="Your role doesn't have access to that section." />}

      <Typography.Text type="secondary">Needs attention</Typography.Text>
      {/* Tiles: half width on phones (`xs={12}` of 24), a quarter on medium screens (`md={6}`). Each tile
          turns amber when its count is above zero (`> 0` gives true/false). */}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Tile title="Company claims to review" value={c.pending_claims} href="/claims" alert={c.pending_claims > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Reviews to verify" value={c.pending_reviews} href="/reviews" alert={c.pending_reviews > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Open requests (inbox)" value={c.open_requests} href="/requests" alert={c.open_requests > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Scraped records to review" value={c.pending_ingest} href="/pipeline" alert={c.pending_ingest > 0} />
        </Col>
        <Col xs={12} md={6}>
          {/* GDPR requests have a legal deadline, so the title shows the next due date when there is one. */}
          <Tile
            title={c.gdpr_next_due ? `GDPR requests (next due ${dayjs(c.gdpr_next_due).format("D MMM")})` : "GDPR requests open"}
            value={c.gdpr_open}
            href="/gdpr"
            alert={c.gdpr_open > 0}
          />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Post drafts" value={c.post_drafts} href="/content" />
        </Col>
      </Row>

      <Typography.Text type="secondary">Business (last 30 days)</Typography.Text>
      {/* Money values arrive in cents and are formatted with `eur(…)`. */}
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Tile title="MRR (Pro subscriptions)" value={eur(c.mrr_cents)} href="/billing" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Unpaid invoices" value={eur(c.unpaid_cents)} href="/billing" alert={c.unpaid_cents > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Requests received" value={c.requests_30d} href="/analytics" />
        </Col>
        <Col xs={12} md={6}>
          {/* Total new accounts = visitor accounts + provider accounts; the suffix shows the provider share. */}
          <Tile title="New accounts" value={c.visitors_30d + c.providers_30d} suffix={`(${c.providers_30d} providers)`} href="/analytics" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Published providers" value={c.providers_published} suffix={`(${c.providers_verified} verified)`} href="/db/providers" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Website accounts" value={c.accounts} href="/db/users" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Report downloads" value={c.downloads_30d} href="/analytics" />
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={10}>
          {/* Data freshness: one line per scraped source with its last run status and last success. */}
          <Card size="small" title="Data freshness" extra={<Link href="/pipeline">Pipeline</Link>}>
            {/* antd `List`: `dataSource` is the array, `renderItem` is a function called for each item `f`
                that returns its row. */}
            <List
              size="small"
              dataSource={data.freshness}
              renderItem={(f) => (
                <List.Item>
                  <span className="mono">{f.source}</span>
                  {/* Status dot: green if the last run succeeded, blue "processing" if running, red otherwise
                      (a nested ternary: "if … else if … else"). `{" "}` adds a space. `.fromNow()` gives
                      e.g. "3 hours ago". */}
                  <span>
                    {f.last_status && (
                      <Badge status={f.last_status === "succeeded" ? "success" : f.last_status === "running" ? "processing" : "error"} text={f.last_status} />
                    )}{" "}
                    <Typography.Text type="secondary">
                      {f.last_success ? `last success ${dayjs(f.last_success).fromNow()}` : "never run"}
                    </Typography.Text>
                  </span>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          {/* The latest audit-log entries: what was done, to which record, by whom and when. */}
          <Card size="small" title="Recent staff activity" extra={<Link href="/audit">Audit log</Link>}>
            {/* `locale.emptyText` replaces antd's default "No data" message. */}
            <List
              size="small"
              locale={{ emptyText: "No activity yet" }}
              dataSource={data.recent}
              renderItem={(a) => (
                <List.Item>
                  {/* e.g. [update] providers #42 — the record number is added only if there is one. */}
                  <span>
                    <Tag>{a.action}</Tag>
                    <span className="mono">
                      {a.entity}
                      {a.entity_id ? ` #${a.entity_id}` : ""}
                    </span>
                  </span>
                  {/* `a.staff ?? "—"`: a dash when no staff member is recorded (e.g. automatic actions). */}
                  <Typography.Text type="secondary">
                    {a.staff ?? "—"} · {dayjs(a.created_at).fromNow()}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
