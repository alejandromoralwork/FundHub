"use client";
/**
 * FILE: apps/admin/src/components/engine-entity.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: One entity of the Scraping Engine registry, with everything known about it and how it changed:
 *   - golden record: each field's value and which source won it (manual > RCS > … per field), with Edit and
 *     "remove override" (a staff edit is stored as source "manual"; removing it lets the registers win again);
 *   - classification (service provider, kind, category / subcategory, tier) — manual, or back to the rules;
 *   - clients / relations: add, end (ended ones stay listed as history);
 *   - tabs: source records, attribute history (every value every source ever stated, with dates), change
 *     events (who / what / when), CSSF statuses, RCS filings, names, row history (database-level audit).
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/registry/[id]/page.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: `Form` + `Modal`, computed diffs before saving, `Record` lookups.
 */

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { ENTITY_KINDS, ENTITY_STATUSES, RELATION_KINDS } from "@fundhub/engine-db/enums";
import type { categoryOptions, entityDetail } from "@/lib/engine-data";
import { addRelation, endRelationAction, saveEntityEdit } from "@/lib/engine-actions";
import { fmt, short, STATE_COLOR } from "./engine-overview";
import { STATUS_COLOR } from "./engine-registry";
import { useAction } from "./use-action";

type Detail = NonNullable<Awaited<ReturnType<typeof entityDetail>>>;
type Categories = Awaited<ReturnType<typeof categoryOptions>>;

/** Kind: constant. Golden fields shown, with the observation attribute and the entity column behind each. */
const FIELDS: { attr: string; label: string; get: (e: Detail["entity"]) => unknown; editable: boolean }[] = [
  { attr: "name", label: "Name", get: (e) => e.canonicalName, editable: true },
  { attr: "legalForm", label: "Legal form", get: (e) => e.legalForm, editable: true },
  { attr: "status", label: "Status", get: (e) => e.status, editable: true },
  { attr: "address", label: "Registered address", get: (e) => e.registeredAddress?.raw, editable: true },
  { attr: "registrationDate", label: "Registration date", get: (e) => e.registrationDate, editable: true },
  { attr: "rcsNumber", label: "RCS number", get: (e) => e.rcsNumber, editable: false },
  { attr: "lei", label: "LEI", get: (e) => e.lei, editable: false },
  { attr: "website", label: "Website", get: (e) => e.website, editable: true },
  { attr: "operatingCountries", label: "Countries of operation", get: (e) => e.operatingCountries, editable: true },
  { attr: "logo", label: "Logo", get: (e) => e.logo?.sourceUrl, editable: false },
];

const SOURCE_COLOR: Record<string, string> = { manual: "purple", rcs: "geekblue", lbr_bulk: "blue", cssf: "cyan", gleif: "green", web: "gold" };
const show = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(", ") : "—") : v === null || v === undefined || v === "" ? "—" : String(v));

/** Kind: React component. The edit modal for golden fields (only changed fields are sent). */
function EditModal({ d, open, onClose }: { d: Detail; open: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  const e = d.entity;
  const initial = {
    name: e.canonicalName,
    legalForm: e.legalForm ?? "",
    status: e.status,
    address: e.registeredAddress?.raw ?? "",
    registrationDate: e.registrationDate ? dayjs(e.registrationDate) : null,
    website: e.website ?? "",
    operatingCountries: e.operatingCountries,
  };
  const submit = (v: typeof initial) => {
    const edit: Record<string, unknown> = {};
    if (v.name !== initial.name) edit.name = v.name;
    if (v.legalForm !== initial.legalForm) edit.legalForm = v.legalForm || null;
    if (v.status !== initial.status) edit.status = v.status;
    if (v.address !== initial.address) edit.address = v.address ? { raw: v.address } : null;
    const date = v.registrationDate ? dayjs(v.registrationDate).format("YYYY-MM-DD") : null;
    if (date !== e.registrationDate) edit.registrationDate = date;
    if (v.website !== initial.website) edit.website = v.website || null;
    if (JSON.stringify(v.operatingCountries) !== JSON.stringify(initial.operatingCountries)) edit.operatingCountries = v.operatingCountries;
    run(async () => {
      const res = await saveEntityEdit(e.id, edit);
      if (!res.error) onClose();
      return res;
    });
  };
  return (
    <Modal title="Edit golden record" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={pending} okText="Save" width={640} destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Your values are stored as source &quot;manual&quot;: they win over the registers and are kept in history. Use &quot;remove override&quot; on a field to let the registers win again." />
      <Form form={form} layout="vertical" initialValues={initial} onFinish={submit}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="legalForm" label="Legal form"><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="status" label="Status"><Select options={ENTITY_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} /></Form.Item></Col>
        </Row>
        <Form.Item name="address" label="Registered address (one line)"><Input placeholder="9, rue de Bitbourg, L-1273 Luxembourg" /></Form.Item>
        <Row gutter={12}>
          <Col span={12}><Form.Item name="registrationDate" label="Registration date"><DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" /></Form.Item></Col>
          <Col span={12}><Form.Item name="website" label="Website" rules={[{ type: "url" }]}><Input placeholder="https://…" /></Form.Item></Col>
        </Row>
        <Form.Item name="operatingCountries" label="Countries of operation (ISO codes or names)"><Select mode="tags" tokenSeparators={[","]} placeholder="LU, IE, Jersey…" /></Form.Item>
      </Form>
    </Modal>
  );
}

/** Kind: React component. The classification modal. */
function ClassificationModal({ d, categories, open, onClose }: { d: Detail; categories: Categories; open: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  const e = d.entity;
  const category = Form.useWatch("activityCategoryId", form);
  const save = (classification: unknown) =>
    run(async () => {
      const res = await saveEntityEdit(e.id, {}, classification);
      if (!res.error) onClose();
      return res;
    });
  return (
    <Modal title="Classification" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={pending} okText="Save as manual" width={560} destroyOnHidden
      footer={(_, { OkBtn, CancelBtn }) => (
        <Space>
          {e.classificationSource === "manual" && <Popconfirm title="Let the rules classify this entity again?" onConfirm={() => save("rules")}><Button>Back to rules</Button></Popconfirm>}
          <CancelBtn />
          <OkBtn />
        </Space>
      )}>
      <Form form={form} layout="vertical" onFinish={save}
        initialValues={{ isServiceProvider: e.isServiceProvider, entityKind: e.entityKind, activityCategoryId: e.activityCategoryId, activitySubcategoryId: e.activitySubcategoryId, tier: e.tier }}>
        <Form.Item name="isServiceProvider" valuePropName="checked"><Checkbox>Service provider (in FundHub's directory scope)</Checkbox></Form.Item>
        <Form.Item name="entityKind" label="Kind"><Select options={ENTITY_KINDS.map((k) => ({ value: k, label: k.replace(/_/g, " ") }))} /></Form.Item>
        <Form.Item name="activityCategoryId" label="Category">
          <Select allowClear options={categories.filter((c) => c.level === 1).map((c) => ({ value: c.id, label: c.label }))} onChange={() => form.setFieldValue("activitySubcategoryId", null)} />
        </Form.Item>
        <Form.Item name="activitySubcategoryId" label="Subcategory">
          <Select allowClear options={categories.filter((c) => c.parentId === category).map((c) => ({ value: c.id, label: c.label }))} />
        </Form.Item>
        <Form.Item name="tier" label="Tier (0 metadata · 1 + filing PDFs · 2 + website agent, frequent refresh)"><InputNumber min={0} max={2} /></Form.Item>
      </Form>
    </Modal>
  );
}

/** Kind: React component. Add-a-client form. */
function AddRelation({ entityId }: { entityId: string }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  return (
    <Form form={form} layout="inline" initialValues={{ kind: "client" }}
      onFinish={(v) => run(async () => {
        const res = await addRelation(entityId, { ...v, evidenceUrl: v.evidenceUrl || null });
        if (!res.error) form.resetFields(["objectName", "evidenceUrl"]);
        return res;
      })}>
      <Form.Item name="kind"><Select style={{ width: 170 }} options={RELATION_KINDS.map((k) => ({ value: k, label: k.replace(/_/g, " ") }))} /></Form.Item>
      <Form.Item name="objectName" rules={[{ required: true, message: "Name" }]}><Input placeholder="Client / fund name" style={{ width: 260 }} /></Form.Item>
      <Form.Item name="evidenceUrl" rules={[{ type: "url" }]}><Input placeholder="Evidence URL (optional)" style={{ width: 240 }} /></Form.Item>
      <Button htmlType="submit" icon={<PlusOutlined />} loading={pending}>Add</Button>
    </Form>
  );
}

/** Kind: React component. The page. */
export function EntityView({ d, categories, canEdit }: { d: Detail; categories: Categories; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const e = d.entity;
  const catLabel = (id: number | null) => categories.find((c) => c.id === id)?.label ?? "—";
  const manualOpen = new Set(d.open.filter((o) => o.source === "manual").map((o) => o.attribute));

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        title={<Space wrap><span style={{ fontSize: 18 }}>{e.canonicalName}</span><Tag color={STATUS_COLOR[e.status]}>{e.status.replace(/_/g, " ")}</Tag>{e.isServiceProvider && <Tag color="blue">service provider</Tag>}<Tag>{e.entityKind.replace(/_/g, " ")}</Tag><Tag>tier {e.tier}</Tag></Space>}
        extra={<Space><Link href="/engine/registry">← Registry</Link>{canEdit && <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>Edit</Button>}</Space>}
      >
        <Table size="small" pagination={false} rowKey="attr" dataSource={FIELDS}
          columns={[
            { title: "Field", dataIndex: "label", width: 190 },
            { title: "Value", render: (_, f) => (f.attr === "website" && e.website ? <a href={e.website} target="_blank" rel="noreferrer">{e.website}</a> : show(f.get(e))) },
            { title: "From", width: 110, render: (_, f) => (d.winners[f.attr] ? <Tag color={SOURCE_COLOR[d.winners[f.attr]!]}>{d.winners[f.attr]}</Tag> : "—") },
            {
              title: "",
              width: 140,
              render: (_, f) =>
                canEdit && f.editable && manualOpen.has(f.attr) ? (
                  <Popconfirm title={`Remove your override of ${f.label}? The registers' value comes back.`} onConfirm={() => run(() => saveEntityEdit(e.id, { [f.attr]: null }))}>
                    <Button size="small" type="link" loading={pending}>remove override</Button>
                  </Popconfirm>
                ) : null,
            },
          ]} />
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          First seen {fmt(e.firstSeenAt)} · last changed {fmt(e.lastChangedAt)} · last seen {fmt(e.lastSeenAt)}{e.websiteVerifiedAt ? ` · website verified ${fmt(e.websiteVerifiedAt)}` : ""}
        </Typography.Text>
      </Card>

      <Row gutter={16}>
        <Col span={10}>
          <Card size="small" title="Classification" extra={canEdit && <Button size="small" onClick={() => setClassifying(true)}>Change</Button>}>
            <Descriptions size="small" column={1}
              items={[
                { label: "Service provider", children: e.isServiceProvider ? "yes" : "no" },
                { label: "Kind", children: e.entityKind.replace(/_/g, " ") },
                { label: "Category", children: catLabel(e.activityCategoryId) },
                { label: "Subcategory", children: catLabel(e.activitySubcategoryId) },
                { label: "Tier", children: e.tier },
                { label: "Decided by", children: <Tag color={e.classificationSource === "manual" ? "purple" : undefined}>{e.classificationSource ?? "—"}</Tag> },
              ]} />
          </Card>
        </Col>
        <Col span={14}>
          <Card size="small" title="Identifiers">
            <Space wrap>{d.identifiers.map((i) => <Tag key={i.id}><span className="mono">{i.scheme}: {i.value}</span> <Typography.Text type="secondary">({i.source})</Typography.Text></Tag>)}</Space>
            {d.clientOf.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text strong>Client of: </Typography.Text>
                {d.clientOf.map((c) => <Tag key={c.id}><Link href={`/engine/registry/${c.providerId}`}>{c.providerName}</Link> ({c.kind}){c.validTo ? " — ended" : ""}</Tag>)}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={`Clients & relations (${d.relations.filter((r) => !r.validTo).length} current)`} extra={canEdit && <AddRelation entityId={e.id} />}>
        <Table size="small" rowKey="id" dataSource={d.relations} pagination={{ pageSize: 20 }}
          columns={[
            { title: "Role", dataIndex: "kind", render: (k: string) => <Tag>{k.replace(/_/g, " ")}</Tag>, width: 150 },
            { title: "Name", render: (_, r) => (r.objectEntityId ? <Link href={`/engine/registry/${r.objectEntityId}`}>{r.objectName}</Link> : r.objectName) },
            { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag>, width: 90 },
            { title: "Evidence", dataIndex: "evidenceUrl", render: (u: string | null) => (u ? <a href={u} target="_blank" rel="noreferrer">link</a> : "—"), width: 80 },
            { title: "Since", dataIndex: "validFrom", render: fmt, width: 150 },
            { title: "Ended", dataIndex: "validTo", render: (v: string | null) => (v ? <Typography.Text type="secondary">{fmt(v)}</Typography.Text> : <Tag color="green">current</Tag>), width: 150 },
            {
              title: "",
              width: 70,
              render: (_, r) => (canEdit && !r.validTo ? <Popconfirm title="End this relation? It stays in history." onConfirm={() => run(() => endRelationAction(e.id, r.id))}><Button size="small" type="link" danger>End</Button></Popconfirm> : null),
            },
          ]} />
      </Card>

      <Card size="small">
        <Tabs
          items={[
            {
              key: "events",
              label: `Change events (${d.events.length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.events} pagination={{ pageSize: 25 }}
                  columns={[
                    { title: "When", dataIndex: "detectedAt", render: fmt, width: 150 },
                    { title: "Change", dataIndex: "kind", render: (k: string) => <Tag>{k}</Tag>, width: 160 },
                    { title: "Attribute", dataIndex: "attribute", render: (a: string | null) => <span className="mono">{a ?? ""}</span> },
                    { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag>, width: 90 },
                    { title: "Old", dataIndex: "oldValue", render: short },
                    { title: "New", dataIndex: "newValue", render: short },
                    { title: "By", dataIndex: "actor", render: (a: string | null) => a ?? "engine", width: 180 },
                  ]} />
              ),
            },
            {
              key: "history",
              label: "Attribute history",
              children: (
                <Table size="small" rowKey="id" dataSource={d.history} pagination={{ pageSize: 25 }}
                  columns={[
                    { title: "Attribute", dataIndex: "attribute", render: (a: string) => <span className="mono">{a}</span>, width: 170 },
                    { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag>, width: 90 },
                    { title: "Value", dataIndex: "value", render: short },
                    { title: "From", dataIndex: "validFrom", render: fmt, width: 150 },
                    { title: "Until", dataIndex: "validTo", render: (v: string | null) => (v ? fmt(v) : <Tag color="green">current</Tag>), width: 150 },
                  ]} />
              ),
            },
            {
              key: "sources",
              label: `Source records (${d.records.length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.records} pagination={false}
                  columns={[
                    { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag> },
                    { title: "Id at source", dataIndex: "externalId", render: (v: string) => <span className="mono">{v}</span> },
                    { title: "Scope", dataIndex: "scope" },
                    { title: "State", dataIndex: "state", render: (s: string) => <Tag color={s === "found" ? "green" : "red"}>{s}</Tag> },
                    { title: "Last changed", dataIndex: "lastChangedAt", render: fmt },
                    { title: "Last seen", dataIndex: "lastSeenAt", render: fmt },
                    { title: "Next fetch", dataIndex: "nextFetchAt", render: fmt },
                    { title: "Error", dataIndex: "lastError", render: (v: string | null) => (v ? <Typography.Text type="danger">{short(v)}</Typography.Text> : "") },
                  ]} />
              ),
            },
            {
              key: "cssf",
              label: `CSSF (${d.details.length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.details} pagination={{ pageSize: 25 }}
                  columns={[
                    { title: "Group", dataIndex: "kind", render: (k: string) => <Tag>{k}</Tag>, width: 120 },
                    { title: "Code", dataIndex: "code", render: (c: string) => <span className="mono">{c}</span>, width: 200 },
                    { title: "Label", dataIndex: "label" },
                    { title: "LEI", dataIndex: "lei" },
                    { title: "Start", dataIndex: "startDate", width: 110 },
                    { title: "End", dataIndex: "endDate", render: (v: string | null) => v ?? <Tag color="green">active</Tag>, width: 110 },
                  ]} />
              ),
            },
            {
              key: "filings",
              label: `RCS filings (${d.filings.length})`,
              children: (
                <Table size="small" rowKey="filingNumber" dataSource={d.filings} pagination={{ pageSize: 25 }}
                  columns={[
                    { title: "Filing", dataIndex: "filingNumber", render: (v: string) => <span className="mono">{v}</span>, width: 120 },
                    { title: "Date", dataIndex: "filingDate", width: 110 },
                    { title: "Type", dataIndex: "type" },
                    { title: "Details", dataIndex: "details", render: (v: string[]) => v.join(" · ") },
                    { title: "Corrections", render: (_, f) => [f.corrects && `corrects ${f.corrects}`, f.correctedBy && `corrected by ${f.correctedBy}`].filter(Boolean).join(" · ") },
                    { title: "PDF", render: (_, f) => (f.documentSha256 ? <Tag color="green">stored</Tag> : f.hasDocuments ? <Tag>not yet</Tag> : "—"), width: 80 },
                  ]} />
              ),
            },
            {
              key: "names",
              label: `Names (${d.names.length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.names} pagination={false}
                  columns={[{ title: "Name", dataIndex: "name" }, { title: "Kind", dataIndex: "kind" }, { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag> }, { title: "Since", dataIndex: "validFrom" }]} />
              ),
            },
            {
              key: "rows",
              label: "Row history",
              children: (
                <Table size="small" rowKey="id" dataSource={d.rowHistory} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: "When", dataIndex: "changedAt", render: fmt, width: 150 },
                    { title: "Op", dataIndex: "op", render: (o: string) => <Tag color={STATE_COLOR[o === "DELETE" ? "failed" : "ok"]}>{o}</Tag>, width: 90 },
                    { title: "By", dataIndex: "actor", render: (a: string | null) => a ?? "—", width: 200 },
                    {
                      title: "Changed columns",
                      render: (_, h) => {
                        const o = (h.oldRow ?? {}) as Record<string, unknown>;
                        const n = (h.newRow ?? {}) as Record<string, unknown>;
                        const keys = Object.keys({ ...o, ...n }).filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]) && !["last_seen_at", "last_changed_at", "classified_at"].includes(k));
                        return keys.map((k) => <div key={k}><span className="mono">{k}</span>: {short(o[k])} → {short(n[k])}</div>);
                      },
                    },
                  ]} />
              ),
            },
          ]}
        />
      </Card>

      {canEdit && <EditModal d={d} open={editing} onClose={() => setEditing(false)} />}
      {canEdit && <ClassificationModal d={d} categories={categories} open={classifying} onClose={() => setClassifying(false)} />}
    </Space>
  );
}
