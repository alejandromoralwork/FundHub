"use client";
/**
 * FILE: apps/admin/src/components/engine-overview.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Scraping Engine dashboard: headline totals, RCS session state (with pause / resume),
 *   today's census per source (expected vs seen, new, gone), RCS coverage per prefix, queue state, recent runs
 *   and the latest change events. Data comes from lib/engine-data.ts engineDashboard().
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/page.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: `import type` of a server function's return type, `Awaited<ReturnType<…>>`.
 */

import Link from "next/link";
import { Alert, Button, Card, Col, Empty, Popconfirm, Progress, Row, Space, Statistic, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { engineDashboard } from "@/lib/engine-data";
import { setRcsSession } from "@/lib/engine-actions";
import { useAction } from "./use-action";

type Data = Awaited<ReturnType<typeof engineDashboard>>;

/** Kind: function. Short date-time. */
export const fmt = (d: string | null | undefined) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
/** Kind: constant. Colour per run / session state. */
export const STATE_COLOR: Record<string, string> = { succeeded: "green", completed: "green", ok: "green", running: "blue", active: "blue", created: "default", retry: "orange", paused: "orange", failed: "red", blocked: "red", logged_out: "red", unknown: "default", cancelled: "default" };
/** Kind: function. A value as short text for tables. */
export const short = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "…" : v;
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
};

/** Kind: React component. Shown when the engine database cannot be reached. */
export function EngineUnavailable({ error }: { error: string }) {
  return (
    <Alert type="error" showIcon message="The Scraping Engine database is not reachable."
      description={<>Set <code>ENGINE_DATABASE_URL</code> for the Console (locally: <code>npm run engine:db:local</code>, then <code>npm run engine:db:setup</code>). Error: {error}</>} />
  );
}

/** Kind: React component. The RCS session card. */
export function RcsSessionCard({ sessions }: { sessions: { source: string; state: string; message: string | null; checkedAt: string }[] }) {
  const { run, pending } = useAction();
  const rcs = sessions.find((s) => s.source === "rcs");
  const state = rcs?.state ?? "unknown";
  return (
    <Card size="small" title="RCS session (LuxTrust)">
      <Space direction="vertical" style={{ width: "100%" }}>
        <Space>
          <Tag color={STATE_COLOR[state]}>{state}</Tag>
          <Typography.Text type="secondary">{rcs?.message ?? "never logged in"} · {fmt(rcs?.checkedAt)}</Typography.Text>
        </Space>
        {state !== "ok" && (
          <Alert type="warning" showIcon message="RCS work is paused." description={<>On the machine running the RCS worker: <code>npm run engine -- rcs:login</code>, log in with LuxTrust, press Enter. If LBR showed an access-limit page, wait for it to expire, check in the browser, then resume.</>} />
        )}
        <Space>
          <Popconfirm title="Pause all RCS work?" onConfirm={() => run(() => setRcsSession("blocked"))}>
            <Button size="small" danger disabled={state !== "ok"} loading={pending}>Pause RCS</Button>
          </Popconfirm>
          <Popconfirm title="Only resume after checking LBR works in the worker's browser. Resume?" onConfirm={() => run(() => setRcsSession("ok"))}>
            <Button size="small" disabled={state === "ok" || state === "unknown"} loading={pending}>Resume</Button>
          </Popconfirm>
        </Space>
      </Space>
    </Card>
  );
}

/** Kind: React component. The dashboard. */
export function EngineOverview({ data }: { data: Data }) {
  const t = data.totals;
  const sourceCensus = data.census.filter((c) => c.source !== "registry");
  const known = data.census.filter((c) => c.scope.startsWith("rcs:known:"));
  const queue = data.queue;
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={16}>
        <Col span={4}><Card size="small"><Statistic title="Entities" value={t.entities} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="Service providers" value={t.service_providers} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="With RCS number" value={t.with_rcs} /></Card></Col>
        <Col span={4}><Card size="small"><Statistic title="With LEI" value={t.with_lei} /></Card></Col>
        <Col span={4}>
          <Card size="small">
            <Link href="/engine/matches"><Statistic title="Matches to review" value={t.pending_matches} valueStyle={t.pending_matches ? { color: "#d97706" } : undefined} /></Link>
          </Card>
        </Col>
        <Col span={4}><Card size="small"><Link href="/engine/registry"><Button type="primary" block>Open registry</Button></Link><Link href="/engine/jobs"><Button block style={{ marginTop: 8 }}>Jobs</Button></Link></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={10}><RcsSessionCard sessions={data.sessions} /></Col>
        <Col span={14}>
          <Card size="small" title="RCS coverage (numbers known from any source vs highest number seen)">
            {known.length === 0 ? (
              <Typography.Text type="secondary">Run "RCS seed frontier" (Jobs) after a GLEIF / CSSF load.</Typography.Text>
            ) : (
              known.map((k) => (
                <div key={k.scope}>
                  <Typography.Text>Prefix {k.scope.slice(-1)}: {k.seen.toLocaleString()} known of up to {(k.expectedTotal ?? 0).toLocaleString()} numbers</Typography.Text>
                  <Progress percent={k.expectedTotal ? Math.round((k.seen / k.expectedTotal) * 1000) / 10 : 0} size="small" />
                </div>
              ))
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={`Census ${data.census[0]?.takenOn ?? ""}`}>
        {sourceCensus.length === 0 ? (
          <Empty description="No census yet — run a CSSF census or a GLEIF sync." />
        ) : (
          <Table size="small" pagination={false} rowKey={(r) => `${r.source}:${r.scope}`} dataSource={sourceCensus}
            columns={[
              { title: "Source", dataIndex: "source", render: (s: string) => <Tag>{s}</Tag> },
              { title: "Scope", dataIndex: "scope" },
              { title: "Expected (source says)", dataIndex: "expectedTotal", render: (v: number | null) => v?.toLocaleString() ?? "—" },
              { title: "Held", dataIndex: "seen", render: (v: number, r) => <span style={{ color: r.expectedTotal && v < r.expectedTotal ? "#d97706" : undefined }}>{v.toLocaleString()}</span> },
              { title: "New today", dataIndex: "added" },
              { title: "Gone today", dataIndex: "gone" },
            ]} />
        )}
      </Card>

      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title="Queue">
            {queue === null ? (
              <Typography.Text type="secondary">Queue not created yet: start an engine worker once (<code>npm run engine -- worker</code>).</Typography.Text>
            ) : (
              <Table size="small" pagination={false} rowKey={(r) => `${r.name}:${r.state}`} dataSource={queue}
                columns={[{ title: "Job", dataIndex: "name" }, { title: "State", dataIndex: "state", render: (s: string) => <Tag color={STATE_COLOR[s]}>{s}</Tag> }, { title: "Count", dataIndex: "n" }]} />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="Recent runs">
            <Table size="small" pagination={false} rowKey="id" dataSource={data.runs}
              columns={[
                { title: "Job", dataIndex: "job" },
                { title: "Status", dataIndex: "status", render: (s: string, r) => <Tag color={STATE_COLOR[s]} title={r.error ?? undefined}>{s}</Tag> },
                { title: "Started", dataIndex: "startedAt", render: fmt },
                { title: "Stats", dataIndex: "stats", render: short },
              ]} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Latest changes">
        <Table size="small" pagination={false} rowKey="id" dataSource={data.events}
          columns={[
            { title: "When", dataIndex: "detectedAt", render: fmt, width: 150 },
            { title: "Entity", render: (_, r) => (r.entityId ? <Link href={`/engine/registry/${r.entityId}`}>{r.entityName ?? r.entityId}</Link> : "—") },
            { title: "Change", dataIndex: "kind", render: (k: string, r) => <Space size={4}><Tag>{k}</Tag>{r.attribute && <span className="mono">{r.attribute}</span>}</Space> },
            { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={s === "manual" ? "purple" : undefined}>{s}</Tag> },
            { title: "New value", dataIndex: "newValue", render: short },
            { title: "By", dataIndex: "actor", render: (a: string | null) => a ?? "engine" },
          ]} />
      </Card>
    </Space>
  );
}
