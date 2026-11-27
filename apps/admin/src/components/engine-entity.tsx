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
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/companies/[id]/page.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: `Form` + `Modal`, computed diffs before saving, `Record` lookups.
 */

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Checkbox, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { COMPANY_KINDS, COMPANY_STATUSES, RELATION_KINDS } from "@fundhub/engine-db/enums";
import type { categoryOptions, entityDetail } from "@/lib/engine-data";
import { addMandate, addRelation, endMandate, endRelationAction, findCompanies, saveEntityEdit, saveServices } from "@/lib/engine-actions";
import { fmt, short, STATE_COLOR } from "./engine-overview";
import { STATUS_COLOR } from "./engine-registry";
import { useAction } from "./use-action";
import { FUND_ROLE_LABEL, GROUP_KIND_LABEL, GROUP_ROLE_LABEL, GROUP_SOURCE_COLOR, LAW_LABEL, MANAGER_LABEL, REGIME_COLOR, REGIME_LABEL, VEHICLE_LABEL, optionsOf } from "@/lib/fund-labels";
import type { FundLaw, FundRegime, FundRole, GroupKind, GroupRole, LegalVehicle, ManagerType } from "@fundhub/engine-db/enums";

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
  { attr: "description", label: "Description", get: (e) => e.description, editable: false },
  { attr: "phone", label: "Phone", get: (e) => e.phone, editable: false },
  { attr: "email", label: "E-mail (generic)", get: (e) => e.email, editable: false },
  { attr: "headcount", label: "Headcount", get: (e) => e.headcount, editable: false },
  { attr: "foundedYear", label: "Founded", get: (e) => e.foundedYear, editable: false },
  { attr: "services", label: "Services", get: (e) => e.services, editable: false },
  { attr: "operatingCountries", label: "Countries of operation", get: (e) => e.operatingCountries, editable: true },
  { attr: "logo", label: "Logo", get: (e) => e.logo?.sourceUrl, editable: false },
];

export const SOURCE_COLOR: Record<string, string> = { manual: "purple", rcs: "geekblue", lbr_bulk: "blue", cssf: "cyan", gleif: "green", fundhub: "magenta", website: "gold", news: "volcano", linkedin: "blue", glassdoor: "lime", instagram: "pink", facebook: "blue", x: "default" };
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
          <Col span={12}><Form.Item name="status" label="Status"><Select options={COMPANY_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} /></Form.Item></Col>
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
  // A cleared select gives `undefined`; send null so the manual classification really clears the field.
  const withNulls = (c: unknown) =>
    c && typeof c === "object" ? { ...Object.fromEntries(["fundRegime", "fundLaw", "legalVehicle", "fundRole", "managerType"].map((k) => [k, null])), ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) } : c;
  const save = (classification: unknown) =>
    run(async () => {
      const res = await saveEntityEdit(e.id, {}, withNulls(classification));
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
        initialValues={{
          isServiceProvider: e.isServiceProvider, companyKind: e.companyKind, activityCategoryId: e.activityCategoryId, activitySubcategoryId: e.activitySubcategoryId, tier: e.tier,
          fundRegime: e.fundRegime, fundLaw: e.fundLaw, legalVehicle: e.legalVehicle, fundRole: e.fundRole, managerType: e.managerType,
        }}>
        <Form.Item name="isServiceProvider" valuePropName="checked"><Checkbox>Service provider (in FundHub's directory scope)</Checkbox></Form.Item>
        <Form.Item name="companyKind" label="Kind"><Select options={COMPANY_KINDS.map((k) => ({ value: k, label: k.replace(/_/g, " ") }))} /></Form.Item>
        <Form.Item name="activityCategoryId" label="Category">
          <Select allowClear options={categories.filter((c) => c.level === 1).map((c) => ({ value: c.id, label: c.label }))} onChange={() => form.setFieldValue("activitySubcategoryId", null)} />
        </Form.Item>
        <Form.Item name="activitySubcategoryId" label="Subcategory">
          <Select allowClear options={categories.filter((c) => c.parentId === category).map((c) => ({ value: c.id, label: c.label }))} />
        </Form.Item>
        <Form.Item name="tier" label="Tier (0 metadata · 1 + filing PDFs · 2 + website agent, frequent refresh)"><InputNumber min={0} max={2} /></Form.Item>
        <Typography.Text strong>Fund profile</Typography.Text>
        <Row gutter={12} style={{ marginTop: 8 }}>
          <Col span={12}><Form.Item name="fundRegime" label="UCITS / AIF"><Select allowClear options={optionsOf(REGIME_LABEL)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="fundLaw" label="Product law"><Select allowClear options={optionsOf(LAW_LABEL)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="legalVehicle" label="Legal vehicle"><Select allowClear options={optionsOf(VEHICLE_LABEL)} /></Form.Item></Col>
          <Col span={12}><Form.Item name="fundRole" label="Role in fund structure"><Select allowClear options={optionsOf(FUND_ROLE_LABEL)} /></Form.Item></Col>
          <Col span={24}><Form.Item name="managerType" label="Manager licence"><Select allowClear options={optionsOf(MANAGER_LABEL)} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

/** Kind: React component. Add-a-client form. */
function AddRelation({ companyId }: { companyId: string }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  return (
    <Form form={form} layout="inline" initialValues={{ kind: "client" }}
      onFinish={(v) => run(async () => {
        const res = await addRelation(companyId, { ...v, evidenceUrl: v.evidenceUrl || null });
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

/**
 * Kind: React component. "Services offered": every category / service the company offers (several), with where
 * each comes from (rules = CSSF licences, fundhub, website, manual); staff can set their own list.
 */
function ServicesCard({ d, categories, canEdit }: { d: Detail; categories: Categories; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { run, pending } = useAction();
  const manualIds = d.services.filter((x) => x.manual && x.category_id).map((x) => x.category_id!);
  const manualText = d.services.filter((x) => x.manual && !x.category_id).map((x) => x.label);
  // Service-provider categories (level 1) with their services (level 2) as a grouped picker.
  const options = categories
    .filter((c) => c.level === 1)
    .map((c) => ({ label: c.label, options: [{ value: c.id, label: `${c.label} (whole category)` }, ...categories.filter((x) => x.parentId === c.id).map((x) => ({ value: x.id, label: x.label }))] }));
  const byParent = new Map<string, Detail["services"]>();
  for (const x of d.services) byParent.set(x.parent ?? (x.level === 1 ? x.label : "Other services"), [...(byParent.get(x.parent ?? (x.level === 1 ? x.label : "Other services")) ?? []), x]);
  return (
    <Card size="small" title={`Services offered (${d.services.filter((x) => x.level !== 1).length})`} extra={canEdit && <Button size="small" onClick={() => setOpen(true)}>Edit</Button>}>
      {d.services.length === 0 ? (
        <Typography.Text type="secondary">None known yet (from CSSF licences, the FundHub account, the website, or staff).</Typography.Text>
      ) : (
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          {[...byParent.entries()].map(([cat, list]) => (
            <div key={cat}>
              <Typography.Text strong>{cat}</Typography.Text>{" "}
              {list.filter((x) => x.level !== 1).map((x) => (
                <Tag key={x.key} color={x.manual ? "purple" : undefined} title={`from: ${x.sources.join(", ")}`}>{x.label}</Tag>
              ))}
              {list.every((x) => x.level === 1) && <Typography.Text type="secondary"> (category, no detail)</Typography.Text>}
            </div>
          ))}
        </Space>
      )}
      <Modal title="Services offered (staff)" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={pending} width={640} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ categoryIds: manualIds, freeText: manualText }}
          onFinish={(v) => run(async () => { const r = await saveServices(d.entity.id, { categoryIds: v.categoryIds ?? [], freeText: v.freeText ?? [] }); if (!r.error) setOpen(false); return r; })}>
          <Form.Item name="categoryIds" label="Categories and services (the website's list)"><Select mode="multiple" allowClear showSearch optionFilterProp="label" options={options} /></Form.Item>
          <Form.Item name="freeText" label="Other services (free text, press Enter after each)"><Select mode="tags" tokenSeparators={[";"]} /></Form.Item>
          <Typography.Text type="secondary">Your list is kept as "manual" next to what the sources state; the sources never overwrite it.</Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
}

/** Kind: function. A real-world date with its precision ("2021", "2021-03", "2021-03-04", "?"). */
const fmtDay = (d: string | null, p?: string | null) => (!d ? "?" : p === "year" ? d.slice(0, 4) : p === "month" ? d.slice(0, 7) : p === "unknown" ? `${d.slice(0, 10)} (≈)` : d.slice(0, 10));

const EVENT_LABEL: Record<string, string> = {
  incorporated: "Incorporated", authorised: "Authorised / listed by the CSSF", launched: "Launched", sub_fund_added: "Sub-fund added", sub_fund_closed: "Sub-fund closed",
  manager_appointed: "Manager appointed", manager_changed: "Manager changed", renamed: "Renamed", merged_into: "Merged into", redomiciled_in: "Redomiciled in",
  redomiciled_out: "Redomiciled out", in_liquidation: "In liquidation", deregistered: "Left the CSSF list", closed: "Closed",
};

/** Kind: React component. Staff form: record a service mandate (role, provider, since, until). */
function AddMandate({ companyId, roles }: { companyId: string; roles: Detail["roles"] }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { run, pending } = useAction();
  const [options, setOptions] = useState<{ value: string; label: string; name: string }[]>([]);
  return (
    <>
      <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add provider</Button>
      <Modal title="Record a service provider" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ role: "depositary", validFromPrecision: "day" }}
          onFinish={(v) =>
            run(async () => {
              const res = await addMandate(companyId, { ...v, validFrom: v.validFrom ? dayjs(v.validFrom).format("YYYY-MM-DD") : null, validTo: v.validTo ? dayjs(v.validTo).format("YYYY-MM-DD") : null });
              if (!res.error) { setOpen(false); form.resetFields(); }
              return res;
            })
          }>
          <Form.Item name="role" label="Role"><Select options={roles.map((r) => ({ value: r.code, label: `${r.label}${r.exclusive ? " · one at a time" : ""}` }))} /></Form.Item>
          <Form.Item name="providerCompanyId" label="Provider (company in the database)">
            <Select showSearch allowClear filterOption={false} placeholder="Type a name, RCS number or LEI"
              onSearch={async (q) => setOptions((await findCompanies(q)).map((c) => ({ value: c.id, label: `${c.name}${c.rcsNumber ? ` · ${c.rcsNumber}` : ""}`, name: c.name })))}
              onChange={(v) => { const o = options.find((x) => x.value === v); if (o) form.setFieldValue("providerName", o.name); }}
              options={options} />
          </Form.Item>
          <Form.Item name="providerName" label="Provider name (as written in the source)" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Space>
            <Form.Item name="validFrom" label="Since"><DatePicker /></Form.Item>
            <Form.Item name="validFromPrecision" label="Known to the"><Select style={{ width: 110 }} options={[{ value: "day", label: "day" }, { value: "month", label: "month" }, { value: "year", label: "year" }]} /></Form.Item>
            <Form.Item name="validTo" label="Until (if ended)"><DatePicker /></Form.Item>
          </Space>
          <Typography.Text type="secondary">For a one-at-a-time role (depositary, auditor, ManCo / AIFM, central administration) the current provider's episode ends on the new start date.</Typography.Text>
        </Form>
      </Modal>
    </>
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
        title={<Space wrap><span style={{ fontSize: 18 }}>{e.canonicalName}</span><Tag color={STATUS_COLOR[e.status]}>{e.status.replace(/_/g, " ")}</Tag>{e.isServiceProvider && <Tag color="blue">service provider</Tag>}<Tag>{e.companyKind.replace(/_/g, " ")}</Tag><Tag>tier {e.tier}</Tag></Space>}
        extra={<Space><Link href="/engine/companies">← Companies</Link>{canEdit && <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>Edit</Button>}</Space>}
      >
        <Table size="small" pagination={false} rowKey="attr" dataSource={FIELDS}
          columns={[
            { title: "Field", dataIndex: "label", width: 190 },
            { title: "Value", render: (_, f) => (f.attr === "website" && e.website ? <a href={e.website} target="_blank" rel="noreferrer">{e.website}</a> : show(f.get(e))) },
            { title: "From", width: 110, render: (_, f) => (d.winners[f.attr] ? <Tag color={SOURCE_COLOR[d.winners[f.attr]!]}>{d.winners[f.attr]}</Tag> : "—") },
            {
              title: "Cross-check",
              width: 150,
              render: (_, f) => {
                const l = d.lineage.find((x) => x.attribute === f.attr);
                const c = d.conflicts.find((x) => x.attribute === f.attr && x.status === "open");
                if (c) return <Link href="/engine/review?tab=conflicts"><Tag color="red">sources disagree</Tag></Link>;
                if (!l) return "—";
                return <Tag color={l.sourcesTotal > 1 ? "green" : undefined}>{l.sourcesAgreeing}/{l.sourcesTotal} source{l.sourcesTotal > 1 ? "s" : ""} agree</Tag>;
              },
            },
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
          Stated by {e.sourceCount} source{e.sourceCount === 1 ? "" : "s"} · first seen {fmt(e.firstSeenAt)} · last changed {fmt(e.lastChangedAt)} · last seen {fmt(e.lastSeenAt)}{e.websiteVerifiedAt ? ` · website verified ${fmt(e.websiteVerifiedAt)}` : ""}
        </Typography.Text>
      </Card>

      <Row gutter={16}>
        <Col span={10}>
          <Card size="small" title="Classification" extra={canEdit && <Button size="small" onClick={() => setClassifying(true)}>Change</Button>}>
            <Descriptions size="small" column={1}
              items={[
                { label: "Service provider", children: e.isServiceProvider ? "yes" : "no" },
                { label: "Kind", children: e.companyKind.replace(/_/g, " ") },
                { label: "Category", children: catLabel(e.activityCategoryId) },
                { label: "Subcategory", children: catLabel(e.activitySubcategoryId) },
                { label: "Tier", children: e.tier },
                ...(e.fundRegime ? [{ label: "UCITS / AIF", children: <Tag color={REGIME_COLOR[e.fundRegime as FundRegime]}>{REGIME_LABEL[e.fundRegime as FundRegime]}</Tag> }] : []),
                ...(e.fundLaw ? [{ label: "Product law", children: LAW_LABEL[e.fundLaw as FundLaw] }] : []),
                ...(e.legalVehicle ? [{ label: "Legal vehicle", children: VEHICLE_LABEL[e.legalVehicle as LegalVehicle] }] : []),
                ...(e.fundRole ? [{ label: "Fund role", children: FUND_ROLE_LABEL[e.fundRole as FundRole] }] : []),
                ...(e.managerType ? [{ label: "Manager licence", children: MANAGER_LABEL[e.managerType as ManagerType] }] : []),
                ...(e.launchDate ? [{ label: "Launched", children: `${String(e.launchDate).slice(0, 10)}${e.launchDateSource ? ` (${e.launchDateSource})` : ""}` }] : []),
                ...(e.closureDate ? [{ label: "Closed", children: `${String(e.closureDate).slice(0, 10)}${e.closureReason ? ` (${e.closureReason})` : ""}` }] : []),
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
                {d.clientOf.map((c) => <Tag key={c.id}><Link href={`/engine/companies/${c.providerId}`}>{c.providerName}</Link> ({c.kind}){c.validTo ? " — ended" : ""}</Tag>)}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <ServicesCard d={d} categories={categories} canEdit={canEdit} />

      <Card size="small" title={`Clients & relations (${d.relations.filter((r) => !r.validTo).length} current)`} extra={canEdit && <AddRelation companyId={e.id} />}>
        <Table size="small" rowKey="id" dataSource={d.relations} pagination={{ pageSize: 20 }}
          columns={[
            { title: "Role", dataIndex: "kind", render: (k: string) => <Tag>{k.replace(/_/g, " ")}</Tag>, width: 150 },
            { title: "Name", render: (_, r) => (r.objectCompanyId ? <Link href={`/engine/companies/${r.objectCompanyId}`}>{r.objectName}</Link> : r.objectName) },
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
              key: "groups",
              label: `Groups (${d.groups.filter((g) => !g.valid_to).length})`,
              children: (
                <Table size="small" rowKey={(g) => `${g.id}`} dataSource={d.groups} pagination={false}
                  locale={{ emptyText: "In no group yet (groups are rebuilt daily by the build_groups job)." }}
                  columns={[
                    { title: "Group", render: (_, g) => <Link href={`/engine/groups/${g.id}`}>{g.path}</Link> },
                    { title: "Kind", dataIndex: "kind", render: (k: string) => GROUP_KIND_LABEL[k as GroupKind] ?? k, width: 190 },
                    { title: "Role", dataIndex: "role", render: (r: string) => <Tag>{GROUP_ROLE_LABEL[r as GroupRole] ?? r}</Tag>, width: 140 },
                    { title: "Source", dataIndex: "source", render: (src: string, g) => <Tag color={GROUP_SOURCE_COLOR[src]}>{src}{g.confidence < 1 ? ` ${Math.round(g.confidence * 100)}%` : ""}</Tag>, width: 120 },
                    { title: "Evidence", dataIndex: "evidence", render: (v: string | null) => <Typography.Text type="secondary">{v ?? "—"}</Typography.Text> },
                    { title: "", dataIndex: "valid_to", render: (v: string | null) => (v ? <Typography.Text type="secondary">ended {fmt(v)}</Typography.Text> : <Tag color="green">current</Tag>), width: 150 },
                  ]} />
              ),
            },
            {
              key: "providers",
              label: `Service providers (${d.served.filter((m) => m.status === "current").length})`,
              children: (
                <>
                  {canEdit && <div style={{ marginBottom: 8 }}><AddMandate companyId={e.id} roles={d.roles} /></div>}
                  <Table size="small" rowKey="id" dataSource={d.served} pagination={false}
                    locale={{ emptyText: "No service provider known yet. Fund managers come from GLEIF (build_groups); other roles from documents later, or add them here." }}
                    columns={[
                      { title: "Role", dataIndex: "role", render: (r: string) => <Tag>{d.roles.find((x) => x.code === r)?.label ?? r}</Tag>, width: 220 },
                      { title: "Provider", render: (_, m) => (m.providerCompanyId ? <Link href={`/engine/companies/${m.providerCompanyId}`}>{m.providerName}</Link> : <span>{m.providerName}{m.providerLei && <Typography.Text type="secondary" className="mono"> · {m.providerLei}</Typography.Text>}</span>) },
                      { title: "Since", render: (_, m) => fmtDay(m.validFrom, m.validFromPrecision), width: 120 },
                      { title: "Until", render: (_, m) => (m.status === "current" ? <Tag color="green">current</Tag> : fmtDay(m.validTo, m.validToPrecision)), width: 120 },
                      { title: "By", dataIndex: "decidedBy", render: (v: string) => <Tag color={v.startsWith("staff:") ? "purple" : SOURCE_COLOR[v]}>{v.startsWith("staff:") ? "staff" : v}</Tag>, width: 90 },
                      { title: "Evidence", dataIndex: "evidence", render: (v: string | null) => <Typography.Text type="secondary" ellipsis={{ tooltip: v }} style={{ maxWidth: 280 }}>{v ?? "—"}</Typography.Text> },
                      {
                        title: "",
                        width: 70,
                        render: (_, m) =>
                          canEdit && m.status === "current" ? (
                            <Popconfirm title="End this mandate today? (Use 'Add provider' with a start date for a switch on another date.)" onConfirm={() => run(() => endMandate(m.id, dayjs().format("YYYY-MM-DD")))}>
                              <Button size="small" type="link" danger>End</Button>
                            </Popconfirm>
                          ) : null,
                      },
                    ]} />
                </>
              ),
            },
            ...(d.serving.length
              ? [{
                  key: "clients",
                  label: `Clients as provider (${d.serving.length})`,
                  children: (
                    <Table size="small" rowKey="id" dataSource={d.serving} pagination={{ pageSize: 25 }}
                      columns={[
                        { title: "Client", render: (_: unknown, m: Detail["serving"][number]) => <Link href={`/engine/companies/${m.clientId}`}>{m.client}</Link> },
                        { title: "Role", dataIndex: "role", render: (r: string) => d.roles.find((x) => x.code === r)?.label ?? r, width: 220 },
                        { title: "Since", render: (_: unknown, m: Detail["serving"][number]) => fmtDay(m.validFrom, m.validFromPrecision), width: 120 },
                        { title: "Fund role", dataIndex: "fundRole", render: (r: string | null) => (r ? FUND_ROLE_LABEL[r as FundRole] : "—"), width: 150 },
                      ]} />
                  ),
                }]
              : []),
            {
              key: "lifecycle",
              label: `Lifecycle (${d.lifecycle.length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.lifecycle} pagination={{ pageSize: 25 }}
                  locale={{ emptyText: "No dated events (the fund_lifecycle job builds them for funds and sub-funds)." }}
                  columns={[
                    { title: "Date", render: (_, ev) => fmtDay(ev.eventDate, ev.datePrecision), width: 120 },
                    { title: "Event", dataIndex: "kind", render: (k: string) => EVENT_LABEL[k] ?? k, width: 220 },
                    { title: "Related", render: (_, ev) => (ev.relatedCompanyId ? <Link href={`/engine/companies/${ev.relatedCompanyId}`}>{ev.related ?? "company"}</Link> : "—") },
                    { title: "Source", dataIndex: "source", render: (v: string) => <Tag color={SOURCE_COLOR[v]}>{v}</Tag>, width: 90 },
                    { title: "Evidence", dataIndex: "evidence", render: (v: string | null) => <Typography.Text type="secondary">{v ?? "—"}</Typography.Text> },
                  ]} />
              ),
            },
            {
              key: "people",
              label: `People (${d.team.filter((p) => !p.validTo).length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.team} pagination={{ pageSize: 25 }}
                  columns={[
                    { title: "Name", render: (_, p) => (p.profileUrl ? <a href={p.profileUrl} target="_blank" rel="noreferrer">{p.name}</a> : p.name) },
                    { title: "Title", dataIndex: "title" },
                    { title: "Role", dataIndex: "role", render: (r: string) => <Tag>{r.replace(/_/g, " ")}</Tag>, width: 160 },
                    { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag>, width: 90 },
                    { title: "Evidence", dataIndex: "evidenceUrl", render: (u: string | null) => (u ? <a href={u} target="_blank" rel="noreferrer">page</a> : "—"), width: 80 },
                    { title: "Since", dataIndex: "validFrom", render: fmt, width: 150 },
                    { title: "Until", dataIndex: "validTo", render: (v: string | null) => (v ? fmt(v) : <Tag color="green">current</Tag>), width: 150 },
                  ]} />
              ),
            },
            {
              key: "web",
              label: `Web & social (${d.presence.length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.presence} pagination={false}
                  columns={[
                    { title: "Platform", dataIndex: "platform", render: (p: string) => <Tag>{p}</Tag>, width: 110 },
                    { title: "Profile", dataIndex: "url", render: (u: string) => <a href={u} target="_blank" rel="noreferrer">{u}</a> },
                    { title: "Verified", dataIndex: "verified", render: (v: boolean) => (v ? <Tag color="green">✓ verified</Tag> : <Tag>unverified</Tag>), width: 110 },
                    { title: "Followers", dataIndex: "followers", render: (v: number | null) => v?.toLocaleString("en") ?? "—", width: 100 },
                    { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag>, width: 90 },
                    { title: "Last seen", dataIndex: "lastSeenAt", render: fmt, width: 150 },
                  ]} />
              ),
            },
            {
              key: "news",
              label: `News (${d.news.filter((n) => n.decision !== "rejected").length})`,
              children: (
                <Table size="small" rowKey="id" dataSource={d.news.filter((n) => n.decision !== "rejected")} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: "Published", dataIndex: "publishedAt", render: fmt, width: 150 },
                    { title: "Article", render: (_, n) => <Space direction="vertical" size={0}><a href={n.url} target="_blank" rel="noreferrer">{n.title}</a><Typography.Text type="secondary">{n.snippet ?? ""}</Typography.Text></Space> },
                    { title: "By", dataIndex: "author", width: 160 },
                    { title: "Match", render: (_, n) => <Tag color={n.decision === "pending" ? "orange" : undefined}>{n.decision === "pending" ? "to review" : `${Math.round(n.confidence * 100)}%`}</Tag>, width: 100 },
                  ]} />
              ),
            },
            {
              key: "lineage",
              label: `Lineage & conflicts${d.conflicts.some((c) => c.status === "open") ? " ⚠" : ""}`,
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Typography.Text type="secondary">For each golden field: the source whose value is used (precedence) and how many of the sources that state the field agree with it. All current claims are below, per source.</Typography.Text>
                  <Table size="small" rowKey="attribute" dataSource={d.lineage} pagination={false}
                    columns={[
                      { title: "Field", dataIndex: "attribute", render: (a: string) => <span className="mono">{a}</span>, width: 170 },
                      { title: "Used", dataIndex: "source", render: (s: string) => <Tag color={SOURCE_COLOR[s]}>{s}</Tag>, width: 90 },
                      { title: "Value", dataIndex: "value", render: short },
                      { title: "Agreement", render: (_, l) => `${l.sourcesAgreeing} of ${l.sourcesTotal}`, width: 100 },
                      {
                        title: "Other sources say",
                        render: (_, l) =>
                          d.open
                            .filter((o) => o.attribute === l.attribute && o.source !== l.source)
                            .map((o) => <div key={o.source}><Tag color={SOURCE_COLOR[o.source]}>{o.source}</Tag>{short(o.value)}</div>),
                      },
                    ]} />
                  {d.conflicts.length > 0 && (
                    <Table size="small" rowKey="id" dataSource={d.conflicts} pagination={false} title={() => "Conflicts"}
                      columns={[
                        { title: "Field", dataIndex: "attribute", width: 170 },
                        { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "open" ? "red" : undefined}>{s}</Tag>, width: 100 },
                        { title: "Values", render: (_, c) => c.values.map((v) => <div key={v.source}><Tag color={SOURCE_COLOR[v.source]}>{v.source}</Tag>{short(v.value)}</div>) },
                        { title: "Updated", dataIndex: "updatedAt", render: fmt, width: 150 },
                      ]} />
                  )}
                </Space>
              ),
            },
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
              label: `CSSF licences (${d.details.length})`,
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
              label: `LBR filings (${d.filings.length})`,
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
