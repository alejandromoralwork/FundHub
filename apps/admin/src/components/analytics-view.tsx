"use client";
/**
 * FILE: apps/admin/src/components/analytics-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Draws the Console's "Analytics" page: bar charts and small tables of business figures from
 *   our own database (form submissions per week, new website accounts, revenue, report downloads and
 *   providers per category). Website traffic is not here; it links out to PostHog instead.
 * WHERE IT RUNS: in the browser (`"use client"` above), because the chart library draws interactive charts
 *   with hover tooltips. The numbers themselves are fetched on the server by `getAnalytics` and passed in as
 *   the `data` prop.
 * FRAMEWORK NOTES:
 *   - A React component is a function returning JSX (HTML-like markup). "Props" are its inputs, written like
 *     HTML attributes: `<Bars data={…} x="week" />`.
 *   - Recharts is a chart library made of React components: `<BarChart>` contains `<XAxis>`, `<Bar>`, etc.
 *   - Ant Design (antd) supplies `Card`, `Row`/`Col` (a 24-column grid) and `Table` (rows from a `dataSource`
 *     array, columns described by a `columns` array).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` = import only a type; `typeof fn` = "the type of this function";
 *   - `ReturnType<…>` / `Awaited<…>` = built-in helper types (what a function returns / what a Promise holds);
 *   - optional props `height?: number` and default values `height = 220`;
 *   - union of exact strings `"horizontal" | "vertical"`; `Record<string, unknown>` = "object with any keys";
 *   - arrow functions `(w) => …`, template strings `` `€${…}` ``, spread `{ ...r }`, ternary `a ? b : c`.
 */

// `import { a } from "b"` brings the named thing `a` in from module `b`. Plain names are npm libraries;
// `@fundhub/…` is one of our shared packages in packages/; `@/…` is this app's src folder.

// antd UI pieces: cards, grid columns/rows, data tables and text styles.
import { Card, Col, Row, Table, Typography } from "antd";
// Recharts pieces for bar charts: the chart, its bars, background grid lines, auto-resizing wrapper,
// hover tooltip and the two axes.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
// dayjs: a small date library, used here to print week dates as e.g. "3 Mar".
import dayjs from "dayjs";
// Turns a category code (e.g. "fund-admin") into its human label, from our shared taxonomy.
import { categoryLabel } from "@fundhub/core/taxonomy";
// Only the TYPE of the server function that gathers the figures (no code is imported, just its shape).
import type { getAnalytics } from "@/lib/metrics";

/**
 * Kind: type alias.
 * "Whatever `getAnalytics` returns, once its Promise has resolved." Read inside-out:
 * `typeof getAnalytics` = the function's type; `ReturnType<…>` = what it returns (a Promise, because it is
 * async); `Awaited<…>` = the value inside that Promise. This keeps the page in step with the server code
 * automatically: if the server adds a field, this type gains it too.
 */
type Data = Awaited<ReturnType<typeof getAnalytics>>;

/** Kind: constant. The single green used for every bar (FundHub's accent colour). */
const ACCENT = "#0f9d78";
/** Kind: constant. Very light grey for the chart's background grid lines. */
const GRID = "#eef0f3";
/** Kind: constant. Shared style for axis labels: small grey text (an object passed to Recharts' `tick`). */
const AXIS = { fontSize: 11, fill: "#8a94a3" };

/**
 * Kind: React component (private helper for this file).
 * One series, one hue: magnitude only. Exact values are in tooltips and the tables below.
 * A reusable bar chart so every chart on the page looks the same.
 * Props (the `{ … }: { … }` part destructures the props object and declares its type):
 * @param data    type `Record<string, unknown>[]` — an array of row objects, one bar per row.
 * @param x       type `string` — the name of the field holding each bar's label (e.g. "week").
 * @param y       type `string` — the name of the field holding each bar's value (e.g. "total").
 * @param height  optional (`?`) `number` — chart height in pixels; `= 220` is the default if not given.
 * @param format  optional function `(v: number) => string` — turns a value into display text (e.g. euros).
 * @param layout  optional, exactly `"horizontal"` (upright bars) or `"vertical"` (bars lying sideways,
 *                handy for long labels); defaults to `"horizontal"`.
 * @returns       JSX for the chart.
 */
function Bars({ data, x, y, height = 220, format, layout = "horizontal" }: {
  data: Record<string, unknown>[];
  x: string;
  y: string;
  height?: number;
  format?: (v: number) => string;
  layout?: "horizontal" | "vertical";
}) {
  // `===` compares for exact equality; `vertical` becomes `true` or `false`.
  const vertical = layout === "vertical";
  return (
    // `ResponsiveContainer` makes the chart fill its card's width and redraw when the window resizes.
    <ResponsiveContainer width="100%" height={height}>
      {/* The chart itself. The ternaries (`vertical ? A : B`) pick spacing that suits each orientation. */}
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 0, left: vertical ? 8 : -12 }} barCategoryGap={vertical ? 6 : "20%"}>
        {/* Grid lines run along the value direction only; `!vertical` means "not vertical". */}
        <CartesianGrid stroke={GRID} vertical={vertical} horizontal={!vertical} />
        {/* Choose the axes by orientation. `<>…</>` is a "fragment": a wrapper that groups two elements
            without adding anything to the page. For sideways bars the value axis (`type="number"`) is X
            and the labels (`type="category"`) are on Y, 190px wide to fit long names. */}
        {vertical ? (
          <>
            <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={format} />
            <YAxis type="category" dataKey={x} tick={AXIS} axisLine={false} tickLine={false} width={190} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={format} />
          </>
        )}
        {/* Hover box with the exact value. `formatter` is an arrow function: if a `format` was given, use it
            (after `Number(v)` turns the value into a number), otherwise just show the value as text. */}
        <Tooltip cursor={{ fill: "rgba(15,157,120,0.06)" }} formatter={(v) => (format ? format(Number(v)) : String(v))} />
        {/* The bars: `dataKey={y}` says which field gives the height. `radius` rounds the two outer corners
            ([top-left, top-right, bottom-right, bottom-left]); `maxBarSize` stops bars getting too fat. */}
        <Bar dataKey={y} fill={ACCENT} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Kind: constant holding an arrow function.
 * @param w  type `string` — a date such as "2026-03-02" (the Monday a week starts on).
 * @returns  `string` like "2 Mar" (dayjs format "D MMM" = day number + short month name).
 */
const week = (w: string) => dayjs(w).format("D MMM");
/**
 * Kind: constant holding an arrow function.
 * @param cents  type `number` — money in euro cents (the database stores money as whole cents to avoid
 *               rounding errors).
 * @returns      `string` like "€1,250": divided by 100, rounded to whole euros, with thousands separators
 *               (`toLocaleString("en-GB")`). The backticks make a template string; `${…}` inserts a value.
 */
const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

/**
 * Kind: React component (exported; used by the Analytics page).
 * @param data        type `Data` — all the figures, gathered on the server by `getAnalytics`.
 * @param posthogUrl  type `string | null` — link to our PostHog (web analytics) dashboard, or `null` if the
 *                    POSTHOG_URL setting is not configured. `|` means "either of these types".
 * @returns           JSX for the whole Analytics page.
 */
export function AnalyticsView({ data, posthogUrl }: { data: Data; posthogUrl: string | null }) {
  // `.map(fn)` returns a NEW array with `fn` applied to every item. For each weekly row `r`:
  // `{ ...r, … }` copies all its fields (spread), then replaces `week` with a readable label and adds a
  // `total` of the four form types (quote requests, advisory, data and awards).
  const requests = data.requests.map((r) => ({ ...r, week: week(r.week), total: r.rfi + r.advisory + r.data + r.awards }));
  // Same for sign-ups: total = visitor accounts + provider accounts.
  const signups = data.signups.map((s) => ({ ...s, week: week(s.week), total: s.visitor + s.provider }));
  // Add a human-readable `label` to each category row.
  const categories = data.categories.map((c) => ({ ...c, label: categoryLabel(c.category) }));

  return (
    // A CSS grid with 16px gaps stacks the title, intro and charts vertically.
    <div style={{ display: "grid", gap: 16 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>Analytics</Typography.Title>
      {/* If `posthogUrl` is set, show a link (`target="_blank"` opens a new tab; `rel="noreferrer"` is a
          safety setting for that); otherwise show plain text explaining how to configure it. */}
      <Typography.Text type="secondary">
        Business data from the database. Website traffic lives in{" "}
        {posthogUrl ? <a href={posthogUrl} target="_blank" rel="noreferrer">PostHog</a> : "PostHog (set POSTHOG_URL to link it here)"}.
      </Typography.Text>
      {/* antd grid: each `Col` is 24 units wide on phones (`xs`) and 12 (half) on large screens (`lg`). */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Form submissions per week (12 weeks)">
            <Bars data={requests} x="week" y="total" />
            {/* Under the chart, an antd `Table` with the breakdown for the last 4 weeks: `.slice(-4)` returns
                the last four items. `rowKey` names a field that is unique per row (React needs it to track
                rows). `pagination={false}` shows all rows. Each column's `dataIndex` names the field to show. */}
            <Table size="small" pagination={false} rowKey="week" dataSource={requests.slice(-4)} style={{ marginTop: 8 }}
              columns={[{ title: "Week", dataIndex: "week" }, { title: "Quotes", dataIndex: "rfi" }, { title: "Advisory", dataIndex: "advisory" }, { title: "Data", dataIndex: "data" }, { title: "Awards", dataIndex: "awards" }]} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="New website accounts per week (12 weeks)">
            <Bars data={signups} x="week" y="total" />
            <Table size="small" pagination={false} rowKey="week" dataSource={signups.slice(-4)} style={{ marginTop: 8 }}
              columns={[{ title: "Week", dataIndex: "week" }, { title: "Visitors", dataIndex: "visitor" }, { title: "Providers", dataIndex: "provider" }]} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          {/* Money chart: `format={eur}` passes the euro formatter so axis and tooltip show "€…". */}
          <Card size="small" title="Revenue collected per month (paid invoices)">
            <Bars data={data.revenue} x="month" y="paid" format={eur} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          {/* `data.downloads.length ? A : B`: an empty array has length 0, which counts as false, so the
              "No downloads yet." text shows instead. Height grows with the number of reports (34px each),
              but never below 120px (`Math.max` returns the bigger number). */}
          <Card size="small" title="Report downloads (90 days)">
            {data.downloads.length ? <Bars data={data.downloads} x="report" y="downloads" layout="vertical" height={Math.max(120, data.downloads.length * 34)} /> : <Typography.Text type="secondary">No downloads yet.</Typography.Text>}
          </Card>
        </Col>
        <Col xs={24}>
          <Card size="small" title="Published providers by category">
            <Bars data={categories} x="label" y="providers" layout="vertical" height={categories.length * 34 + 30} />
            {/* `align: "right"` right-aligns number columns. The last column has no `dataIndex`; instead a
                `render` function computes the cell: `(_, c)` receives the cell value (unused, so named `_`)
                and the whole row `c`, and returns verified ÷ providers as a whole percentage. `Math.max(…, 1)`
                avoids dividing by zero. */}
            <Table size="small" pagination={false} rowKey="category" dataSource={categories} style={{ marginTop: 8 }}
              columns={[
                { title: "Category", dataIndex: "label" },
                { title: "Providers", dataIndex: "providers", align: "right" },
                { title: "Verified", dataIndex: "verified", align: "right" },
                { title: "Verified %", align: "right", render: (_, c) => `${Math.round((c.verified / Math.max(c.providers, 1)) * 100)}%` },
              ]} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
