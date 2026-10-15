"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, Empty, Popconfirm, Progress, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { CloudDownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { acceptFields, queueScrape, rejectRecord } from "@/lib/pipeline-actions";
import { useAction } from "./use-action";

const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
const SOURCE_LABEL: Record<string, string> = { ai_web: "AI web extractor", rcs: "RCS register" };
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined || v === "" ? "—" : String(v));
const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...(b as unknown[])].sort() : b);

type Field = { value: unknown; confidence: number; sourceUrl?: string | null };
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
export type RunRow = { id: number; source: string; status: string; trigger: string; stats: Record<string, number> | null; error: string | null; startedAt: string; finishedAt: string | null };
export type JobRow = { id: number; source: string; providerName: string | null; status: string; requestedBy: string | null; error: string | null; createdAt: string };

function RecordCard({ r }: { r: RecordRow }) {
  const { run, pending } = useAction();
  const changed = Object.entries(r.extracted).filter(([k, f]) => !same(f.value, r.current[k]));
  const [selected, setSelected] = useState<string[]>(changed.filter(([, f]) => f.confidence >= 0.7).map(([k]) => k));
  const mock = r.raw?.mock === true;

  return (
    <Card type="inner" size="small" style={{ marginBottom: 12 }}
      title={<Space><span>{r.providerName}</span><Tag>{SOURCE_LABEL[r.source] ?? r.source}</Tag>{mock && <Tag color="orange">mock data</Tag>}</Space>}
      extra={<Typography.Text type="secondary">{fmt(r.createdAt)}{r.sourceUrl && <> · <a href={r.sourceUrl} target="_blank" rel="noreferrer">source</a></>}</Typography.Text>}
    >
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

export function PipelineView({ records, runs, jobs, providers }: { records: RecordRow[]; runs: RunRow[]; jobs: JobRow[]; providers: { id: number; name: string }[] }) {
  const { run, pending } = useAction();
  const [source, setSource] = useState("ai_web");
  const [providerId, setProviderId] = useState<number | null>(null);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
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
