"use client";
/**
 * FILE: apps/admin/src/components/engine-jobs.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Jobs & schedules" page: one card per job (from the shared catalog) with a small form for
 *   its parameters and a "Run" button that queues it for the engine workers; a schedule switch per scheduled
 *   job; the RCS number space (editable); the RCS session card; and the queue's latest jobs with their output.
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/jobs/page.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: `Form` with dynamic fields, `Object.entries` over the catalog.
 */

import { useState } from "react";
import { Alert, Button, Card, Checkbox, Col, Form, Input, InputNumber, Popconfirm, Row, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import type { JobInfo } from "@fundhub/engine-db/jobs-catalog";
import type { jobsPage } from "@/lib/engine-data";
import { enqueueEngineJob, setScheduleEnabled, updateNumberSpace } from "@/lib/engine-actions";
import { fmt, RcsSessionCard, short, STATE_COLOR } from "./engine-overview";
import { useAction } from "./use-action";

type Data = Awaited<ReturnType<typeof jobsPage>>;

const GROUP_LABEL: Record<string, string> = { cssf: "CSSF", gleif: "GLEIF", rcs: "RCS (browser, your session)", maintenance: "Maintenance" };

/** Kind: React component. One job: parameters form + run button + schedule switch. */
function JobCard({ name, info, disabled, canRun, counts }: { name: string; info: JobInfo; disabled: boolean; canRun: boolean; counts: Record<string, number> }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  return (
    <Card size="small" style={{ height: "100%" }}
      title={<Space><span>{info.title}</span><Tag>{GROUP_LABEL[info.group]}</Tag></Space>}
      extra={info.schedule ? (
        <Space size={4}>
          <Typography.Text type="secondary" className="mono" style={{ fontSize: 12 }}>{info.schedule.cron}</Typography.Text>
          <Switch size="small" checked={!disabled} disabled={!canRun} loading={pending} onChange={(on) => run(() => setScheduleEnabled(name, on))} />
        </Space>
      ) : <Typography.Text type="secondary" style={{ fontSize: 12 }}>on demand</Typography.Text>}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>{info.description}</Typography.Paragraph>
      <Form form={form} layout="vertical" size="small" onFinish={(values) => run(() => enqueueEngineJob(name, values))}>
        {info.params.map((p) => (
          <Form.Item key={p.name} name={p.name} label={p.label} valuePropName={p.kind === "boolean" ? "checked" : "value"} rules={p.required ? [{ required: true }] : undefined} style={{ marginBottom: 8 }}>
            {p.kind === "boolean" ? <Checkbox /> : p.kind === "number" ? <InputNumber placeholder={p.placeholder} style={{ width: "100%" }} /> : <Input placeholder={p.placeholder} />}
          </Form.Item>
        ))}
        <Space>
          <Button htmlType="submit" type="primary" icon={<PlayCircleOutlined />} loading={pending} disabled={!canRun}>Run</Button>
          {Object.entries(counts).map(([state, n]) => <Tag key={state} color={STATE_COLOR[state]}>{state}: {n}</Tag>)}
        </Space>
      </Form>
    </Card>
  );
}

/** Kind: React component. One editable RCS prefix row. */
function PrefixRow({ row, canEdit }: { row: Data["space"][number]; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [v, setV] = useState({ enabled: row.enabled, maxKnown: row.maxKnown, sweptTo: row.sweptTo });
  const dirty = v.enabled !== row.enabled || v.maxKnown !== row.maxKnown || v.sweptTo !== row.sweptTo;
  return (
    <Space>
      <Switch size="small" checked={v.enabled} disabled={!canEdit} onChange={(enabled) => setV({ ...v, enabled })} />
      <span>max known</span>
      <InputNumber size="small" min={0} value={v.maxKnown} disabled={!canEdit} onChange={(n) => setV({ ...v, maxKnown: n ?? 0 })} />
      <span>swept to</span>
      <InputNumber size="small" min={0} value={v.sweptTo} disabled={!canEdit} onChange={(n) => setV({ ...v, sweptTo: n ?? 0 })} />
      <Popconfirm title="Save this prefix?" onConfirm={() => run(() => updateNumberSpace({ prefix: row.prefix, ...v }))} disabled={!dirty}>
        <Button size="small" disabled={!dirty || !canEdit} loading={pending}>Save</Button>
      </Popconfirm>
    </Space>
  );
}

/** Kind: React component. The page. */
export function EngineJobs({ data, canRun }: { data: Data; canRun: boolean }) {
  const counts = (name: string) => Object.fromEntries(data.counts.filter((c) => c.name === name).map((c) => [c.state, c.n]));
  const groups = ["cssf", "gleif", "rcs", "maintenance"];
  const entries = Object.entries(data.catalog) as [string, JobInfo][];
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {!data.queueReady && <Alert type="warning" showIcon message="The queue does not exist yet." description="Start an engine worker once (npm run engine -- worker --groups cssf,gleif,maintenance); it creates the queue tables." />}
      <Alert type="info" showIcon message="Jobs run on the engine workers, not in the Console. Queued jobs wait until a worker serving that group is running (CSSF / GLEIF / maintenance worker, and ONE RCS worker on the machine with your LuxTrust session)." />
      <Tabs
        items={[
          ...groups.map((g) => ({
            key: g,
            label: GROUP_LABEL[g],
            children: (
              <Row gutter={[16, 16]}>
                {entries.filter(([, info]) => info.group === g).map(([name, info]) => (
                  <Col key={name} xs={24} md={12} xl={8}>
                    <JobCard name={name} info={info} disabled={data.disabled.includes(name)} canRun={canRun} counts={counts(name)} />
                  </Col>
                ))}
              </Row>
            ),
          })),
          {
            key: "rcs-space",
            label: "RCS number space",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <RcsSessionCard sessions={data.sessions} />
                <Card size="small" title="Prefixes (B = commercial companies)">
                  <Table size="small" pagination={false} rowKey="prefix" dataSource={data.space}
                    columns={[
                      { title: "Prefix", dataIndex: "prefix", width: 70, render: (p: string) => <strong>{p}</strong> },
                      { title: "Register", dataIndex: "label" },
                      { title: "Settings", render: (_, r) => <PrefixRow row={r} canEdit={canRun} /> },
                    ]} />
                </Card>
              </Space>
            ),
          },
          {
            key: "queue",
            label: "Queue & runs",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Card size="small" title="Latest queued jobs">
                  <Table size="small" rowKey="id" dataSource={data.recent} pagination={{ pageSize: 20 }}
                    columns={[
                      { title: "Created", dataIndex: "created_on", render: fmt, width: 150 },
                      { title: "Job", dataIndex: "name" },
                      { title: "State", dataIndex: "state", render: (s: string, r) => <Tag color={STATE_COLOR[s]}>{s}{r.retry_count ? ` (retry ${r.retry_count})` : ""}</Tag> },
                      { title: "Data", dataIndex: "data", render: short },
                      { title: "Output", dataIndex: "output", render: short },
                      { title: "Done", dataIndex: "completed_on", render: fmt, width: 150 },
                    ]} />
                </Card>
                <Card size="small" title="Runs">
                  <Table size="small" rowKey="id" dataSource={data.runs} pagination={false}
                    columns={[
                      { title: "Job", dataIndex: "job" },
                      { title: "Status", dataIndex: "status", render: (s: string, r) => <Tag color={STATE_COLOR[s]} title={r.error ?? undefined}>{s}</Tag> },
                      { title: "Trigger", dataIndex: "trigger" },
                      { title: "Started", dataIndex: "startedAt", render: fmt },
                      { title: "Finished", dataIndex: "finishedAt", render: fmt },
                      { title: "Stats", dataIndex: "stats", render: short },
                    ]} />
                </Card>
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
