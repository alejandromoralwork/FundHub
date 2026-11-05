"use client";
/**
 * FILE: apps/admin/src/components/engine-rounds.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The register of capture rounds ("loops"): every round with its scope, dates, progress and what it
 *   found (new, changed, unchanged, not found, skipped; new filings; new documents), plus the companies of the
 *   selected round. Staff with CAN.engineJobs can start a new round (initial / update), close the active one, or
 *   put its skipped companies back in the queue. Rounds are worked through in the browser with the FundHub LBR
 *   Capture extension.
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/rounds/page.tsx.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { roundsPage } from "@/lib/engine-data";
import { closeCaptureRound, resetCaptureRoundSkipped, startCaptureRound } from "@/lib/engine-actions";
import { fmt } from "./engine-overview";
import { useAction } from "./use-action";

type Data = Awaited<ReturnType<typeof roundsPage>>;

const ITEM_COLOR: Record<string, string> = { pending: "default", captured: "green", changed: "gold", unchanged: "blue", not_found: "red", skipped: "default", failed: "red" };

/** Kind: React component. "New round" modal. */
function NewRound({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  const kind = Form.useWatch("kind", form);
  const filter = Form.useWatch("filter", form);
  return (
    <Modal title="New capture round" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Start round" confirmLoading={pending} destroyOnHidden>
      <Typography.Paragraph type="secondary">Starting a round closes the active one (it stays in the register). The round is worked through in the browser with the FundHub LBR Capture extension.</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ kind: "initial", filter: "all", skipDays: 20 }}
        onFinish={(v) => run(async () => {
          const res = await startCaptureRound({ kind: v.kind, filter: v.filter, text: v.text || undefined, skipDays: v.kind === "update" ? v.skipDays || 0 : undefined, name: v.name || undefined });
          if (!res.error) onClose();
          return res;
        })}>
        <Form.Item name="kind" label="Kind">
          <Radio.Group options={[{ value: "initial", label: "Initial — companies never captured" }, { value: "update", label: "Update — re-visit captured companies (changes + new PDFs only)" }]} />
        </Form.Item>
        <Form.Item name="filter" label="Scope">
          <Select options={[{ value: "all", label: "All" }, { value: "sp", label: "Service providers" }, { value: "am", label: "Asset managers" }, { value: "text", label: "Name / B-number…" }]} />
        </Form.Item>
        {filter === "text" && <Form.Item name="text" label="Name or B-number (prefix)" rules={[{ required: true }]}><Input placeholder="e.g. Arendt or B14" /></Form.Item>}
        {kind === "update" && <Form.Item name="skipDays" label="Skip companies captured in the last … days"><InputNumber min={0} max={365} /></Form.Item>}
        <Form.Item name="name" label="Name (optional)"><Input placeholder="e.g. 2026-12 update" /></Form.Item>
      </Form>
    </Modal>
  );
}

/** Kind: React component. The page. */
export function RoundsView({ data, canEdit, status }: { data: Data; canEdit: boolean; status?: string }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const active = data.rounds.find((r) => r.status === "active");
  const selected = data.rounds.find((r) => r.id === data.selectedId);
  const go = (id: number, st?: string) => router.push(`/engine/rounds?id=${id}${st ? `&status=${st}` : ""}`);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        title="Capture rounds — register"
        extra={
          canEdit && (
            <Space>
              {active && <Popconfirm title="Put skipped / failed companies of the active round back in the queue?" onConfirm={() => run(() => resetCaptureRoundSkipped())}><Button loading={pending}>Reset skipped</Button></Popconfirm>}
              {active && <Popconfirm title={`Close "${active.name}"? Pending companies are recorded as not visited.`} onConfirm={() => run(() => closeCaptureRound())}><Button loading={pending}>Close active round</Button></Popconfirm>}
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New round</Button>
            </Space>
          )
        }
      >
        {data.rounds.length === 0 ? (
          <Empty description="No capture round yet. Start an initial round, then an update round every month." />
        ) : (
          <Table size="small" rowKey="id" dataSource={data.rounds} pagination={false}
            onRow={(r) => ({ onClick: () => go(r.id), style: { cursor: "pointer", background: r.id === data.selectedId ? "#f5f7fa" : undefined } })}
            columns={[
              { title: "Round", dataIndex: "name", render: (n: string, r) => <Space><b>{n}</b>{r.status === "active" && <Tag color="green">active</Tag>}</Space> },
              { title: "Kind", dataIndex: "kind", render: (k: string) => <Tag color={k === "update" ? "blue" : "purple"}>{k}</Tag>, width: 90 },
              { title: "Scope", dataIndex: "scope", render: (s: { filter: string; text?: string; skipCapturedWithinDays?: number }) => `${s.filter === "text" ? `"${s.text}"` : s.filter}${s.skipCapturedWithinDays ? ` · skip <${s.skipCapturedWithinDays}d` : ""}`, width: 150 },
              { title: "Started", dataIndex: "startedAt", render: fmt, width: 140 },
              { title: "Closed", dataIndex: "closedAt", render: fmt, width: 140 },
              { title: "Progress", render: (_, r) => <div style={{ minWidth: 140 }}><Progress size="small" percent={r.stats.total ? Math.round((r.stats.done / r.stats.total) * 100) : 0} /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.stats.done.toLocaleString()} / {r.stats.total.toLocaleString()}</Typography.Text></div> },
              { title: "New", render: (_, r) => r.stats.captured, width: 60 },
              { title: "Changed", render: (_, r) => r.stats.changed, width: 75 },
              { title: "Unchanged", render: (_, r) => r.stats.unchanged, width: 90 },
              { title: "Not found", render: (_, r) => r.stats.not_found, width: 85 },
              { title: "Skipped", render: (_, r) => r.stats.skipped, width: 75 },
              { title: "New filings", render: (_, r) => r.stats.new_filings, width: 90 },
              { title: "New PDFs", render: (_, r) => r.stats.new_documents, width: 85 },
            ]} />
        )}
      </Card>

      {selected && (
        <Card
          title={<Space><span>{selected.name}</span><Typography.Text type="secondary">companies</Typography.Text></Space>}
          extra={
            <Select allowClear placeholder="All statuses" style={{ width: 160 }} value={status || undefined} onChange={(st) => go(selected.id, st)}
              options={Object.keys(ITEM_COLOR).map((s) => ({ value: s, label: s.replace("_", " ") }))} />
          }
        >
          <Table size="small" rowKey="rcs" dataSource={data.items} pagination={{ pageSize: 50 }}
            columns={[
              { title: "#", dataIndex: "position", width: 70 },
              { title: "RCS", dataIndex: "rcs", render: (v: string) => <span className="mono">{v}</span>, width: 100 },
              { title: "Company", render: (_, i) => (i.entity_id ? <Link href={`/engine/registry/${i.entity_id}`}>{i.name ?? i.rcs}</Link> : i.name ?? "—") },
              { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={ITEM_COLOR[s]}>{s.replace("_", " ")}</Tag>, width: 110 },
              { title: "Visited", dataIndex: "visited_at", render: fmt, width: 150 },
              { title: "Filings", render: (_, i) => (i.filings_after === null ? "—" : `${i.filings_before ?? "–"} → ${i.filings_after}`), width: 100 },
              { title: "New filings", dataIndex: "new_filings", width: 95 },
              { title: "New PDFs", dataIndex: "new_documents", width: 85 },
              { title: "Note", dataIndex: "error", render: (e: string | null) => (e ? <Typography.Text type="danger">{e}</Typography.Text> : "") },
            ]} />
        </Card>
      )}
      {canEdit && <NewRound open={creating} onClose={() => setCreating(false)} />}
    </Space>
  );
}
