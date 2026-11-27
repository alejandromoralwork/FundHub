"use client";
/**
 * FILE: apps/admin/src/components/engine-groups.tsx
 * PART: console (apps/admin) — Company intelligence → Groups
 * WHAT IT DOES: The company-group screens.
 *   - GroupsView: one tab per layer (corporate · fund structures · service providers), a search (group or member
 *     name), and the groups as a tree (corporate group › fund platform › fund structure…) with member counts.
 *   - GroupDetailView: one group: its path, parent, sub-groups and members (role, source, evidence), with staff
 *     edits: rename / move under another group, add a company with a role, remove a member, create a sub-group.
 *   Generated groups come from GLEIF / CSSF / name rules (job build_groups); staff edits are kept as "manual".
 * WHERE IT RUNS: in the browser; data from lib/engine-data.ts (groupsPage, groupDetail), writes via engine-actions.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { GroupKind, GroupLayer, GroupRole } from "@fundhub/engine-db/enums";
import type { groupDetail, groupsPage, GroupFilters } from "@/lib/engine-data";
import { addGroupMember, createGroup, deleteGroup, findCompanies, findGroups, removeGroupMember, updateGroup } from "@/lib/engine-actions";
import { FUND_ROLE_LABEL, GROUP_KIND_LABEL, GROUP_ROLE_LABEL, GROUP_SOURCE_COLOR, LAYER_LABEL, REGIME_COLOR, REGIME_LABEL, optionsOf } from "@/lib/fund-labels";
import type { FundRegime, FundRole } from "@fundhub/engine-db/enums";
import { fmt } from "./engine-overview";
import { useAction } from "./use-action";

type Page = Awaited<ReturnType<typeof groupsPage>>;
type Detail = NonNullable<Awaited<ReturnType<typeof groupDetail>>>;
type Row = Page["groups"][number] & { children?: Row[] };

/** Kind: constant. Which group kinds belong to which layer (for the create form). */
const KINDS_OF: Record<GroupLayer, GroupKind[]> = { corporate: ["corporate_group"], fund: ["fund_platform", "fund_structure"], service_provider: ["provider_group"] };

/** Kind: React component. Type-ahead picker for a group (server search). */
function GroupPicker({ value, onChange, placeholder }: { value?: number | null; onChange?: (v: number | null) => void; placeholder?: string }) {
  const [options, setOptions] = useState<{ value: number; label: string }[]>([]);
  return (
    <Select
      allowClear
      showSearch
      filterOption={false}
      value={value ?? undefined}
      placeholder={placeholder ?? "Type 2+ letters of a group name"}
      onSearch={async (q) => setOptions((await findGroups(q)).map((g) => ({ value: g.id, label: `${g.name} · ${GROUP_KIND_LABEL[g.kind as GroupKind]} (${g.memberCount})` })))}
      onChange={(v) => onChange?.(v ?? null)}
      options={options}
    />
  );
}

/** Kind: React component. Type-ahead picker for a company. */
function CompanyPicker({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  return (
    <Select
      showSearch
      filterOption={false}
      value={value}
      placeholder="Name, RCS number or LEI"
      onSearch={async (q) => setOptions((await findCompanies(q)).map((c) => ({ value: c.id, label: `${c.name}${c.rcsNumber ? ` · ${c.rcsNumber}` : ""} · ${c.kind.replace(/_/g, " ")}` })))}
      onChange={onChange}
      options={options}
    />
  );
}

/** Kind: React component. "New group" modal (also used for "New sub-group"). */
function NewGroup({ layer, parentGroupId, label = "New group" }: { layer: GroupLayer; parentGroupId?: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { run, pending } = useAction();
  const router = useRouter();
  const chosenLayer: GroupLayer = Form.useWatch("layer", form) ?? layer;
  return (
    <>
      <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>{label}</Button>
      <Modal title={label} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ layer, kind: KINDS_OF[layer][0], parentGroupId }}
          onFinish={(v) =>
            run(async () => {
              const res = await createGroup(v);
              if (res.id) {
                setOpen(false);
                router.push(`/engine/groups/${res.id}`);
              }
              return res;
            })
          }>
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}><Input placeholder="e.g. Deloitte network, Blue Ocean fund family" /></Form.Item>
          <Form.Item name="layer" label="Layer"><Select options={optionsOf(LAYER_LABEL)} onChange={(l: GroupLayer) => form.setFieldValue("kind", KINDS_OF[l][0])} /></Form.Item>
          <Form.Item name="kind" label="Kind"><Select options={KINDS_OF[chosenLayer].map((k) => ({ value: k, label: GROUP_KIND_LABEL[k] }))} /></Form.Item>
          <Form.Item name="parentGroupId" label="Inside group (optional)"><GroupPicker /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/** Kind: React component. The groups page. */
export function GroupsView({ page, filters }: { page: Page; filters: GroupFilters }) {
  const router = useRouter();
  const go = (patch: Partial<GroupFilters>) => {
    const next = { ...filters, ...patch };
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    router.push(`/engine/groups${q.size ? `?${q}` : ""}`);
  };
  // Flat rows (ordered by depth) → tree for the table.
  const tree = useMemo(() => {
    const byId = new Map<number, Row>(page.groups.map((g) => [g.id, { ...g }]));
    const roots: Row[] = [];
    for (const g of byId.values()) {
      const parent = g.parent_group_id ? byId.get(g.parent_group_id) : undefined;
      if (parent) (parent.children ??= []).push(g);
      else roots.push(g);
    }
    return roots;
  }, [page.groups]);
  const counts = (layer: string) => page.counts.filter((c) => c.layer === layer);
  const layer = page.layer as GroupLayer;

  return (
    <Card
      title="Company groups"
      extra={<NewGroup layer={layer} />}
    >
      <Typography.Paragraph type="secondary">
        Corporate groups come from GLEIF parents; fund platforms (a ManCo / AIFM and its funds) and fund structures (umbrella → sub-funds, feeders,
        GP, SPVs) from GLEIF and the CSSF; provider groups from corporate groups or a shared brand word. The <code>build_groups</code> job rebuilds them
        daily; groups and memberships you create or change here are marked <Tag color="purple">manual</Tag> and kept.
      </Typography.Paragraph>
      <Tabs
        activeKey={layer}
        onChange={(l) => go({ layer: l, q: filters.q })}
        items={(Object.keys(LAYER_LABEL) as GroupLayer[]).map((l) => ({
          key: l,
          label: `${LAYER_LABEL[l]} (${counts(l).reduce((a, c) => a + c.groups, 0).toLocaleString()})`,
        }))}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Group or member name" defaultValue={filters.q} style={{ width: 320 }} onSearch={(q) => go({ q })} />
        <Select allowClear placeholder="Source" style={{ width: 140 }} value={filters.source} options={["gleif", "cssf", "name_rule", "manual"].map((s) => ({ value: s, label: s }))} onChange={(source) => go({ source })} />
        {counts(layer).map((c) => (
          <Tag key={c.kind}>{GROUP_KIND_LABEL[c.kind as GroupKind]}: {c.groups.toLocaleString()} groups · {c.members.toLocaleString()} memberships</Tag>
        ))}
      </Space>
      {!page.groups.length && <Alert type="info" showIcon message="No groups yet" description="Run the build_groups job (Jobs & schedules), after the CSSF census and the GLEIF sync." />}
      <Table<Row>
        size="small"
        rowKey="id"
        dataSource={tree}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        expandable={{ defaultExpandedRowKeys: tree.length <= 5 ? tree.map((t) => t.id) : [] }}
        columns={[
          { title: "Group", render: (_, g) => <Link href={`/engine/groups/${g.id}`}>{g.name}</Link> },
          { title: "Kind", dataIndex: "kind", render: (k: string) => GROUP_KIND_LABEL[k as GroupKind] ?? k, width: 200 },
          { title: "Members", dataIndex: "member_count", render: (n: number) => n.toLocaleString(), width: 100, align: "right" },
          { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={GROUP_SOURCE_COLOR[s]}>{s}</Tag>, width: 110 },
        ]}
      />
      {page.groups.length > 0 && <Typography.Text type="secondary">Largest 200 top-level groups that match, with everything under them. Search to narrow.</Typography.Text>}
    </Card>
  );
}

/** Kind: React component. One group. */
export function GroupDetailView({ d, canEdit }: { d: Detail; canEdit: boolean }) {
  const g = d.group;
  const { run, pending } = useAction();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [editForm] = Form.useForm();
  const [addForm] = Form.useForm();
  const current = d.members.filter((m) => !m.validTo);
  const shown = showEnded ? d.members : current;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={
          <Space wrap>
            <Link href={`/engine/groups?layer=${g.layer}`}>Groups</Link>
            <span>›</span>
            <span style={{ fontSize: 18 }}>{g.name}</span>
            <Tag>{GROUP_KIND_LABEL[g.kind as GroupKind]}</Tag>
            <Tag color={GROUP_SOURCE_COLOR[g.source]}>{g.source}{g.confidence < 1 ? ` ${Math.round(g.confidence * 100)}%` : ""}</Tag>
          </Space>
        }
        extra={
          canEdit && (
            <Space>
              <Button onClick={() => setEditing(true)}>Edit</Button>
              <NewGroup layer={g.layer as GroupLayer} parentGroupId={g.id} label="New sub-group" />
              {g.source === "manual" && (
                <Popconfirm title="Delete this staff group? Its sub-groups move to the top level." onConfirm={() => run(async () => { const r = await deleteGroup(g.id); if (!r.error) router.push("/engine/groups"); return r; })}>
                  <Button danger>Delete</Button>
                </Popconfirm>
              )}
            </Space>
          )
        }
      >
        <Space direction="vertical">
          <Typography.Text type="secondary">{d.path}</Typography.Text>
          {d.parent && (
            <span>
              Inside: <Link href={`/engine/groups/${d.parent.id}`}>{d.parent.name}</Link> <Tag>{GROUP_KIND_LABEL[d.parent.kind as GroupKind]}</Tag>
            </span>
          )}
          {g.headCompanyId ? (
            <span>Head: <Link href={`/engine/companies/${g.headCompanyId}`}>{d.members.find((m) => m.companyId === g.headCompanyId)?.name ?? "company"}</Link></span>
          ) : g.headLei ? (
            <span>Head: {g.name} <Typography.Text type="secondary" className="mono">LEI {g.headLei}{g.headCountry ? ` · ${g.headCountry}` : ""} (not a Luxembourg company in our database)</Typography.Text></span>
          ) : null}
          {g.description && <Typography.Paragraph style={{ margin: 0 }}>{g.description}</Typography.Paragraph>}
          {g.source !== "manual" && canEdit && <Typography.Text type="secondary">Generated by build_groups. Editing it turns it into a staff group that the builder no longer changes.</Typography.Text>}
        </Space>
      </Card>

      {d.children.length > 0 && (
        <Card size="small" title={`Sub-groups (${d.children.length})`}>
          <Table size="small" rowKey="id" dataSource={d.children} pagination={{ pageSize: 20 }}
            columns={[
              { title: "Group", render: (_, c) => <Link href={`/engine/groups/${c.id}`}>{c.name}</Link> },
              { title: "Kind", dataIndex: "kind", render: (k: string) => GROUP_KIND_LABEL[k as GroupKind], width: 200 },
              { title: "Members", dataIndex: "memberCount", width: 100, align: "right" },
              { title: "Source", dataIndex: "source", render: (s: string) => <Tag color={GROUP_SOURCE_COLOR[s]}>{s}</Tag>, width: 110 },
            ]} />
        </Card>
      )}

      <Card
        size="small"
        title={`Members (${current.length} current${d.members.length > current.length ? `, ${d.members.length - current.length} ended` : ""})`}
        extra={
          <Space>
            {d.members.length > current.length && <Button size="small" type="link" onClick={() => setShowEnded(!showEnded)}>{showEnded ? "Hide ended" : "Show ended"}</Button>}
            {canEdit && <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add company</Button>}
          </Space>
        }
      >
        <Table size="small" rowKey="id" dataSource={shown} pagination={{ pageSize: 50 }}
          columns={[
            { title: "Company", render: (_, m) => <Link href={`/engine/companies/${m.companyId}`}>{m.name}</Link> },
            { title: "Role", dataIndex: "role", render: (r: string) => <Tag>{GROUP_ROLE_LABEL[r as GroupRole] ?? r}</Tag>, width: 140 },
            {
              title: "Profile",
              width: 230,
              render: (_, m) => (
                <Space size={2} wrap>
                  {m.sp && <Tag color="blue">SP</Tag>}
                  <span>{m.kind.replace(/_/g, " ")}</span>
                  {m.fundRegime && <Tag color={REGIME_COLOR[m.fundRegime as FundRegime]}>{REGIME_LABEL[m.fundRegime as FundRegime]}</Tag>}
                  {m.fundRole && <Typography.Text type="secondary">{FUND_ROLE_LABEL[m.fundRole as FundRole]}</Typography.Text>}
                </Space>
              ),
            },
            { title: "RCS / LEI", render: (_, m) => <span className="mono">{m.rcsNumber ?? m.lei ?? "—"}</span>, width: 190 },
            { title: "Source", dataIndex: "source", render: (s: string, m) => <Tag color={GROUP_SOURCE_COLOR[s]}>{s}{m.confidence < 1 ? ` ${Math.round(m.confidence * 100)}%` : ""}</Tag>, width: 110 },
            { title: "Evidence", dataIndex: "evidence", render: (v: string | null) => <Typography.Text type="secondary" ellipsis={{ tooltip: v }} style={{ maxWidth: 260 }}>{v ?? "—"}</Typography.Text> },
            { title: "Since", render: (_, m) => (m.validTo ? <Typography.Text type="secondary">ended {fmt(m.validTo)}</Typography.Text> : fmt(m.validFrom)), width: 150 },
            {
              title: "",
              width: 80,
              render: (_, m) =>
                canEdit && !m.validTo ? (
                  <Popconfirm title="Remove from this group? The builder will not add it back." onConfirm={() => run(() => removeGroupMember(g.id, m.companyId))}>
                    <Button size="small" type="link" danger>Remove</Button>
                  </Popconfirm>
                ) : null,
            },
          ]} />
      </Card>

      <Modal title="Edit group" open={editing} onCancel={() => setEditing(false)} onOk={() => editForm.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={editForm} layout="vertical" initialValues={{ name: g.name, parentGroupId: g.parentGroupId, description: g.description }}
          onFinish={(v) => run(async () => { const r = await updateGroup(g.id, v); if (!r.error) setEditing(false); return r; })}>
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Form.Item name="parentGroupId" label="Inside group">
            <GroupPicker placeholder={d.parent ? d.parent.name : "Top level — type to choose a parent"} />
          </Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="Add a company" open={adding} onCancel={() => setAdding(false)} onOk={() => addForm.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={addForm} layout="vertical" initialValues={{ role: g.kind === "fund_structure" ? "sub_fund" : g.kind === "fund_platform" ? "managed_fund" : g.kind === "corporate_group" ? "subsidiary" : "member" }}
          onFinish={(v) => run(async () => { const r = await addGroupMember(g.id, v); if (!r.error) { setAdding(false); addForm.resetFields(); } return r; })}>
          <Form.Item name="companyId" label="Company" rules={[{ required: true }]}><CompanyPicker /></Form.Item>
          <Form.Item name="role" label="Role"><Select options={optionsOf(GROUP_ROLE_LABEL)} /></Form.Item>
          <Form.Item name="evidence" label="Why (optional)"><Input placeholder="e.g. same promoter, annual report 2025" /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
