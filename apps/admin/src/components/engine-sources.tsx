"use client";
/**
 * FILE: apps/admin/src/components/engine-sources.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Sources page: the source registry (what each source is, how it is acquired, trust,
 *   coverage, compliance notes) with an on/off switch; the STAGING REVIEW POLICY of each source (when its
 *   records wait for a person at the approval gate) with an editor; the attribute precedence matrix (which
 *   source wins each golden field); the news feeds.
 * WHERE IT RUNS: in the browser; data from lib/engine-data.ts sourcesPage(); writes via lib/engine-actions.ts.
 */

import { useState } from "react";
import { Button, Card, Checkbox, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import { REVIEW_MODES } from "@fundhub/engine-db/enums";
import type { sourcesPage } from "@/lib/engine-data";
import { savePolicy, setSourceEnabled } from "@/lib/engine-actions";
import { fmt } from "./engine-overview";
import { useAction } from "./use-action";

type Data = Awaited<ReturnType<typeof sourcesPage>>;
type Policy = Data["policies"][number];

const MODE_LABEL: Record<string, string> = { auto: "flows automatically", review_all: "every record reviewed", review_if: "reviewed when…", sample: "spot checks" };
const MODE_COLOR: Record<string, string> = { auto: "green", review_all: "orange", review_if: "blue", sample: "purple" };
const PROTECTABLE = ["name", "status", "legalForm", "rcsNumber", "lei", "address", "registrationDate", "website", "description", "headcount"];

/** Kind: function. A policy as one readable line. */
export function policyText(p: Policy | undefined) {
  if (!p) return "default policy";
  if (p.mode !== "review_if") return MODE_LABEL[p.mode] + (p.mode === "sample" ? ` (${Math.round(p.sampleRate * 100)}%)` : "");
  const c = p.conditions ?? {};
  const parts = [
    c.newRecord && "new record",
    c.newCompany && "would create a company",
    c.parserChanged && "parser changed",
    c.protectedAttributes?.length && `${c.protectedAttributes.join(", ")} changes`,
    typeof c.minConfidence === "number" && `confidence < ${Math.round(c.minConfidence * 100)}%`,
  ].filter(Boolean);
  return `reviewed when ${parts.join(" or ") || "—"}`;
}

export function SourcesView({ data, canEdit }: { data: Data; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<{ source: string; scope: string } | null>(null);
  const [form] = Form.useForm();
  const cov = (code: string) => data.coverage.find((c) => c.source === code);
  const policyOf = (code: string) => data.policies.find((p) => p.source === code && p.scope === "*");

  const open = (source: string, scope = "*") => {
    const p = data.policies.find((x) => x.source === source && x.scope === scope);
    form.setFieldsValue({
      mode: p?.mode ?? "auto",
      newRecord: !!p?.conditions?.newRecord,
      newCompany: !!p?.conditions?.newCompany,
      parserChanged: !!p?.conditions?.parserChanged,
      protectedAttributes: p?.conditions?.protectedAttributes ?? [],
      minConfidence: typeof p?.conditions?.minConfidence === "number" ? Math.round(p.conditions.minConfidence * 100) : null,
      sampleRate: Math.round((p?.sampleRate ?? 0) * 100),
      enabled: p?.enabled ?? true,
      note: p?.note ?? "",
    });
    setEditing({ source, scope });
  };
  const save = async () => {
    const v = await form.validateFields();
    run(async () => {
      const res = await savePolicy({
        source: editing!.source,
        scope: editing!.scope,
        mode: v.mode,
        newRecord: v.newRecord,
        newCompany: v.newCompany,
        parserChanged: v.parserChanged,
        protectedAttributes: v.protectedAttributes,
        minConfidence: v.minConfidence === null || v.minConfidence === undefined ? null : v.minConfidence / 100,
        sampleRate: (v.sampleRate ?? 0) / 100,
        enabled: v.enabled,
        note: v.note,
      });
      if (!res.error) setEditing(null);
      return res;
    });
  };
  const mode = Form.useWatch("mode", form);

  // Precedence matrix: attributes × sources, cell = rank (1 = most trusted).
  const attrs = [...new Set(data.precedence.map((p) => p.attribute))];
  const srcCodes = data.registry.map((s) => s.code).filter((c) => data.precedence.some((p) => p.source === c));

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>Sources</Typography.Title>
        <Typography.Text type="secondary">What feeds the pipeline, how much of it we hold, and when its records wait for a person at the staging approval gate.</Typography.Text>
      </div>

      <Card size="small" title="Source registry">
        <Table
          size="small"
          rowKey="code"
          pagination={false}
          scroll={{ x: true }}
          dataSource={data.registry}
          expandable={{ expandedRowRender: (s) => <Space direction="vertical" size={4}><Typography.Text>{s.description}</Typography.Text>{s.complianceNote && <Typography.Text type="warning">Compliance: {s.complianceNote}</Typography.Text>}{s.homepage && <a href={s.homepage} target="_blank" rel="noreferrer">{s.homepage}</a>}</Space> }}
          columns={[
            { title: "Source", render: (_, s) => <Space direction="vertical" size={0}><Typography.Text strong>{s.name}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.system} · <code>{s.code}</code></Typography.Text></Space> },
            { title: "Kind", render: (_, s) => <Tag>{s.kind.replace("_", " ")}</Tag> },
            { title: "Acquisition", render: (_, s) => s.acquisition.replace("_", " ") },
            { title: <Tooltip title="Default trust, 0 = most trusted; per-field precedence below">Trust</Tooltip>, dataIndex: "trust", align: "right" },
            { title: "Records", align: "right", render: (_, s) => (cov(s.code)?.found ?? 0).toLocaleString("en") },
            { title: "Last run", render: (_, s) => fmt(cov(s.code)?.last_run_at) },
            {
              title: "Approval gate",
              render: (_, s) => {
                const p = policyOf(s.code);
                return (
                  <Space size={4} wrap>
                    <Tag color={MODE_COLOR[p?.mode ?? "auto"]}>{p?.mode ?? "default"}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{policyText(p)}</Typography.Text>
                    {canEdit && <Button size="small" type="link" onClick={() => open(s.code)}>Edit</Button>}
                  </Space>
                );
              },
            },
            { title: "Enabled", render: (_, s) => <Switch size="small" checked={s.enabled} disabled={!canEdit || s.code === "manual"} loading={pending} onChange={(v) => run(() => setSourceEnabled(s.code, v))} /> },
          ]}
        />
      </Card>

      {data.policies.some((p) => p.scope !== "*") && (
        <Card size="small" title="Scope-specific policies">
          <Table size="small" rowKey="id" pagination={false} dataSource={data.policies.filter((p) => p.scope !== "*")} columns={[
            { title: "Source", dataIndex: "source" },
            { title: "Scope", dataIndex: "scope" },
            { title: "Policy", render: (_, p) => <Space><Tag color={MODE_COLOR[p.mode]}>{p.mode}</Tag>{policyText(p)}</Space> },
            { title: "", render: (_, p) => canEdit && <Button size="small" type="link" onClick={() => open(p.source, p.scope)}>Edit</Button> },
          ]} />
        </Card>
      )}

      <Card size="small" title="Attribute precedence (who wins each golden field — 1 = most trusted)">
        <Table
          size="small"
          rowKey="attribute"
          pagination={false}
          scroll={{ x: true }}
          dataSource={attrs.map((a) => ({ attribute: a }))}
          columns={[
            { title: "Field", dataIndex: "attribute", fixed: "left" },
            ...srcCodes.map((code) => ({
              title: code,
              align: "center" as const,
              render: (_: unknown, r: { attribute: string }) => {
                const p = data.precedence.find((x) => x.attribute === r.attribute && x.source === code);
                return p ? <Tag color={p.rank === 0 ? "gold" : p.rank === 1 ? "green" : undefined}>{p.rank + 1}</Tag> : "";
              },
            })),
          ]}
        />
      </Card>

      <Card size="small" title="News feeds">
        <Table size="small" rowKey="id" pagination={false} dataSource={data.feeds} columns={[
          { title: "Feed", render: (_, f) => <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a> },
          { title: "Articles", dataIndex: "articles", align: "right" },
          { title: "Last polled", render: (_, f) => fmt(f.last_polled_at) },
          { title: "Status", render: (_, f) => (!f.enabled ? <Tag>off</Tag> : f.last_error ? <Tooltip title={f.last_error}><Tag color="red">error</Tag></Tooltip> : <Tag color="green">ok</Tag>) },
        ]} />
      </Card>

      <Modal open={!!editing} title={`Approval gate — ${editing?.source}${editing?.scope !== "*" ? ` / ${editing?.scope}` : ""}`} onCancel={() => setEditing(null)} onOk={save} okText="Save" confirmLoading={pending}>
        <Form form={form} layout="vertical">
          <Form.Item name="mode" label="Mode">
            <Select options={REVIEW_MODES.map((m) => ({ value: m, label: `${m} — ${MODE_LABEL[m]}` }))} />
          </Form.Item>
          {mode === "review_if" && (
            <>
              <Form.Item name="newRecord" valuePropName="checked" style={{ marginBottom: 4 }}><Checkbox>New record (first version from this source)</Checkbox></Form.Item>
              <Form.Item name="newCompany" valuePropName="checked" style={{ marginBottom: 4 }}><Checkbox>Would create a new company</Checkbox></Form.Item>
              <Form.Item name="parserChanged" valuePropName="checked"><Checkbox>Parser version changed</Checkbox></Form.Item>
              <Form.Item name="protectedAttributes" label="Hold when any of these fields change">
                <Select mode="multiple" options={PROTECTABLE.map((a) => ({ value: a, label: a }))} />
              </Form.Item>
              <Form.Item name="minConfidence" label="Hold when confidence is below (%)">
                <InputNumber min={0} max={100} style={{ width: 120 }} />
              </Form.Item>
            </>
          )}
          {mode === "sample" && (
            <Form.Item name="sampleRate" label="Share of records held (%)">
              <InputNumber min={0} max={100} style={{ width: 120 }} />
            </Form.Item>
          )}
          <Form.Item name="enabled" label="Policy active" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="note" label="Note"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
