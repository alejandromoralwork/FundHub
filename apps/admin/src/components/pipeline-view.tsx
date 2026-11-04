"use client";

/**
 * FILE: apps/admin/src/components/pipeline-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's data-pipeline screen. The scraper (services/scraper) collects provider facts from
 *   company websites (an AI extractor) or the RCS business register and stores them as "records". Nothing goes
 *   live automatically: here staff see, per record, which fields differ from the live profile, with a confidence
 *   score, tick the ones to accept and apply them, or dismiss the record. Staff can also queue a new scrape and
 *   view the history of scrape runs and queued jobs.
 * WHERE IT RUNS: in the browser ("use client"): checkboxes, dropdowns and local state. Data comes from the server
 *   page as props; decisions go to server actions in "@/lib/pipeline-actions".
 * FRAMEWORK NOTES:
 *   - antd parts: Tabs (`items`, one object per tab), Badge (a count bubble or a coloured status dot),
 *     Progress (here a 5-step mini bar for confidence), Checkbox, Select with search, Popconfirm, Empty.
 *   - `RecordCard` keeps its own state (which fields are ticked). React gives every <RecordCard key={…}> its own
 *     separate copy of that state.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Record<string, Field>`, `unknown`, optional property `sourceUrl?:`, type assertion `b as unknown[]`.
 *   - array destructuring in parameters `([k, f]) => …`, and skipping an item `([, f]) => …`.
 *   - generics `useState<string[]>`, `useState<number | null>`; spread `[...selected, key]`; `??`, `?.`, `!`.
 */

// `import { a } from "b"` brings named things from "b"; `import X from "b"` its default export.
// Plain names = npm libraries; `@/…` = this app's src folder; `./…` = this folder.
// React's state hook.
import { useState } from "react";
// Ant Design UI components.
import { Alert, Badge, Button, Card, Checkbox, Empty, Popconfirm, Progress, Select, Space, Table, Tabs, Tag, Typography } from "antd";
// Cloud-download icon for the "Run scrape" button.
import { CloudDownloadOutlined } from "@ant-design/icons";
// Date library for formatting and durations.
import dayjs from "dayjs";
// Server actions: apply chosen fields to the live profile, queue a scrape job, dismiss a record.
import { acceptFields, queueScrape, rejectRecord } from "@/lib/pipeline-actions";
// Hook: run a server action, show a toast, refresh the page data.
import { useAction } from "./use-action";

/** Kind: arrow function. Formats date text as "18 Oct 2026 14:05", or "—" for `null`. */
const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
/** Kind: constant. Human names for the scraper's source codes (unknown codes are shown as-is with `?? s`). */
const SOURCE_LABEL: Record<string, string> = { ai_web: "AI web extractor", rcs: "RCS register" };
/** Kind: arrow function. Value → display text: lists joined with commas; null/undefined/empty text → "—". */
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined || v === "" ? "—" : String(v));
/**
 * Kind: arrow function. Are two values equal? Both are turned into JSON text and compared. Arrays are copied
 * (`[...a]`) and sorted first, so ["b","a"] counts as the same as ["a","b"] (order does not matter for lists like
 * services). Copying matters because `.sort()` would otherwise reorder the original array.
 * `b as unknown[]` tells TypeScript "b is an array" here (already checked by `Array.isArray(b)`).
 * @returns `boolean`.
 */
const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...(b as unknown[])].sort() : b);

/**
 * Kind: type alias (private to this file). One scraped field: the `value` found, the scraper's `confidence`
 * from 0 to 1, and optionally the page it came from (`?` = may be missing; may also be `null`).
 */
type Field = { value: unknown; confidence: number; sourceUrl?: string | null };
/**
 * Kind: type alias (exported for the server page). One scraped record for one provider:
 * `extracted` maps field names to scraped Fields; `current` maps the same names to the live profile's values;
 * `raw` is the scraper's raw output (or `null`), used here only to spot mock/test data.
 */
export type RecordRow = {
  id: number;
  source: string;
  providerId: number;
  providerName: string;
  sourceUrl: string | null;
  extracted: Record<string, Field>;
  current: Record<string, unknown>;
  raw: Record<string, unknown> | null;
  createdAt: string;
};
/**
 * Kind: type alias. One scraper run: source, status ("running", "succeeded", …), what started it (`trigger`),
 * counters in `stats` (e.g. `{ records: 3, unchanged: 40, … }`, or `null`), any error text, start/finish times.
 */
export type RunRow = { id: number; source: string; status: string; trigger: string; stats: Record<string, number> | null; error: string | null; startedAt: string; finishedAt: string | null };
/**
 * Kind: type alias. One queued scrape request: for which provider (`null` = all), its status, who asked for it,
 * any error, and when it was queued.
 */
export type JobRow = { id: number; source: string; providerName: string | null; status: string; requestedBy: string | null; error: string | null; createdAt: string };

/**
 * Kind: React component (private to this file).
 * Shows one scraped record: a table of fields whose scraped value differs from the live profile, each with a
 * checkbox, plus "Apply selected" and "Dismiss" buttons.
 * @param r  type `RecordRow` — the record to show.
 * @returns JSX: an inner Card.
 */
function RecordCard({ r }: { r: RecordRow }) {
  const { run, pending } = useAction();
  // `Object.entries` gives [fieldName, Field] pairs; keep only those whose scraped value is NOT the same as the
  // live value (`!` = not). `changed` is therefore an array of [name, Field] pairs.
  const changed = Object.entries(r.extracted).filter(([k, f]) => !same(f.value, r.current[k]));
  // The ticked field names. Initially: every changed field with confidence of at least 70%.
  // `([, f])` skips the first item of the pair (the name); `.map(([k]) => k)` keeps only the names.
  // Note: this starting value is used only on the first draw of this card.
  const [selected, setSelected] = useState<string[]>(changed.filter(([, f]) => f.confidence >= 0.7).map(([k]) => k));
  // True when the scraper marked this record as test data (`r.raw?.mock` is safe even when `raw` is null).
  const mock = r.raw?.mock === true;

  // Title: provider name, source tag and (if test data) an orange "mock data" tag. Top-right: when scraped,
  // plus a link to the source page if there is one.
  return (
    <Card type="inner" size="small" style={{ marginBottom: 12 }}
      title={<Space><span>{r.providerName}</span><Tag>{SOURCE_LABEL[r.source] ?? r.source}</Tag>{mock && <Tag color="orange">mock data</Tag>}</Space>}
      extra={<Typography.Text type="secondary">{fmt(r.createdAt)}{r.sourceUrl && <> · <a href={r.sourceUrl} target="_blank" rel="noreferrer">source</a></>}</Typography.Text>}
    >
      {/* No differences → a short note. Otherwise a table with one row per changed field. The checkbox adds the
          field name to `selected` when ticked (`[...selected, row.key]` = a new array with it appended) or removes
          it when unticked (`.filter` keeps every other name). React state must be replaced, not edited in place,
          which is why new arrays are built. Confidence is a green (≥70%) or amber 5-step bar plus the percentage;
          "Evidence" links to the exact page where the value was found. */}
      {changed.length === 0 ? (
        <Typography.Text type="secondary">Nothing new: the scraped values match the live profile.</Typography.Text>
      ) : (
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={changed.map(([key, f]) => ({ key, f, current: r.current[key] }))}
          columns={[
            {
              title: "",
              width: 32,
              render: (_, row) => (
                <Checkbox checked={selected.includes(row.key)} onChange={(e) => setSelected(e.target.checked ? [...selected, row.key] : selected.filter((k) => k !== row.key))} />
              ),
            },
            { title: "Field", dataIndex: "key", render: (k: string) => <span className="mono">{k}</span>, width: 140 },
            { title: "Live profile", render: (_, row) => <Typography.Text type="secondary">{show(row.current)}</Typography.Text> },
            { title: "Scraped", render: (_, row) => <span>{show(row.f.value)}</span> },
            {
              title: "Confidence",
              width: 130,
              render: (_, row) => (
                <Space size={4}>
                  <Progress percent={Math.round(row.f.confidence * 100)} size="small" steps={5} showInfo={false} strokeColor={row.f.confidence >= 0.7 ? "#0f9d78" : "#d97706"} />
                  <span className="tnum" style={{ fontSize: 12 }}>{Math.round(row.f.confidence * 100)}%</span>
                </Space>
              ),
            },
            { title: "Evidence", width: 80, render: (_, row) => (row.f.sourceUrl ? <a href={row.f.sourceUrl} target="_blank" rel="noreferrer">page</a> : "—") },
          ]}
        />
      )}
      {/* "Apply selected" writes the ticked fields to the live profile via the `acceptFields` server action, after
          a confirmation; it is disabled when nothing is ticked (`!selected.length` = "length is 0"). "Dismiss" calls
          `rejectRecord` to drop the whole record. */}
      <Space style={{ marginTop: 12 }}>
        {changed.length > 0 && (
          <Popconfirm title={`Write ${selected.length} field(s) to the live profile?`} onConfirm={() => run(() => acceptFields(r.id, selected))} disabled={!selected.length}>
            <Button type="primary" loading={pending} disabled={!selected.length}>Apply selected ({selected.length})</Button>
          </Popconfirm>
        )}
        <Button onClick={() => run(() => rejectRecord(r.id))}>Dismiss</Button>
      </Space>
    </Card>
  );
}

/**
 * Kind: React component.
 * @param records    type `RecordRow[]` — scraped records waiting for review.
 * @param runs       type `RunRow[]` — recent scraper runs.
 * @param jobs       type `JobRow[]` — recently queued scrape requests.
 * @param providers  type `{ id: number; name: string }[]` — published providers, for the "scrape just one" dropdown.
 * @returns JSX: a control card (choose source/provider, run a scrape) and a tabs card (review queue, runs, jobs).
 */
export function PipelineView({ records, runs, jobs, providers }: { records: RecordRow[]; runs: RunRow[]; jobs: JobRow[]; providers: { id: number; name: string }[] }) {
  const { run, pending } = useAction();
  // The chosen scrape source (default: the AI web extractor).
  const [source, setSource] = useState("ai_web");
  // The chosen provider, or `null` meaning "all published providers".
  const [providerId, setProviderId] = useState<number | null>(null);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* Controls. The source dropdown's options come from SOURCE_LABEL (`Object.entries` → [code, label] pairs).
          The provider dropdown is searchable by name (`showSearch`, `optionFilterProp="label"`) and clearable
          (`allowClear`); clearing gives `undefined`, which `?? null` turns into null ("all"), and `?? undefined`
          does the reverse for display. "Run scrape" queues a job via the `queueScrape` server action. */}
      <Card title="Data pipeline" extra={<Typography.Text type="secondary">Scraped data never goes live without review</Typography.Text>}>
        <Space wrap>
          <Select value={source} onChange={setSource} style={{ width: 200 }} options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="All published providers" style={{ width: 300 }} value={providerId ?? undefined}
            onChange={(v) => setProviderId(v ?? null)} options={providers.map((p) => ({ value: p.id, label: p.name }))} />
          <Button type="primary" icon={<CloudDownloadOutlined />} loading={pending} onClick={() => run(() => queueScrape(source, providerId))}>Run scrape</Button>
        </Space>
        <Alert style={{ marginTop: 12 }} type="info" showIcon
          message="The data module runs separately on GitHub Actions: weekly for all websites, immediately when you click Run scrape (if configured), and a daily sweep. The RCS source uses mock data until a register provider is chosen." />
      </Card>
      {/* Tabs. "Review queue" shows a count bubble and one RecordCard per record (each with a unique `key`).
          "Runs": status as a coloured dot (green succeeded, blue pulsing running, red otherwise; hover shows the
          error), a one-line summary of the counters (`?? 0` when a counter is missing) and the duration in seconds.
          "Queued jobs": who asked for which scrape and what happened to it. */}
      <Card>
        <Tabs
          items={[
            {
              key: "review",
              label: <Badge count={records.length} offset={[12, 0]}>Review queue</Badge>,
              children: records.length ? records.map((r) => <RecordCard key={r.id} r={r} />) : <Empty description="Nothing to review" />,
            },
            {
              key: "runs",
              label: "Runs",
              children: (
                <Table<RunRow> size="small" rowKey="id" dataSource={runs} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: "#", dataIndex: "id", width: 60 },
                    { title: "Source", dataIndex: "source", render: (s: string) => SOURCE_LABEL[s] ?? s },
                    { title: "Status", dataIndex: "status", render: (s: string, r) => <Badge status={s === "succeeded" ? "success" : s === "running" ? "processing" : "error"} text={s} title={r.error ?? undefined} /> },
                    { title: "Trigger", dataIndex: "trigger" },
                    { title: "Result", render: (_, r) => (r.stats ? `${r.stats.records ?? 0} with changes · ${r.stats.unchanged ?? 0} unchanged · ${r.stats.empty ?? 0} empty · ${r.stats.failed ?? 0} failed of ${r.stats.providers ?? 0}` : "—") },
                    { title: "Started", dataIndex: "startedAt", render: fmt },
                    { title: "Duration", render: (_, r) => (r.finishedAt ? `${dayjs(r.finishedAt).diff(r.startedAt, "second")}s` : "—") },
                  ]} />
              ),
            },
            {
              key: "jobs",
              label: "Queued jobs",
              children: (
                <Table<JobRow> size="small" rowKey="id" dataSource={jobs} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: "#", dataIndex: "id", width: 60 },
                    { title: "Source", dataIndex: "source", render: (s: string) => SOURCE_LABEL[s] ?? s },
                    { title: "Provider", dataIndex: "providerName", render: (n: string | null) => n ?? "All providers" },
                    { title: "Status", dataIndex: "status", render: (s: string, j) => <Tag color={s === "done" ? "green" : s === "failed" ? "red" : "blue"} title={j.error ?? undefined}>{s}</Tag> },
                    { title: "Requested by", dataIndex: "requestedBy" },
                    { title: "When", dataIndex: "createdAt", render: fmt },
                  ]} />
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
