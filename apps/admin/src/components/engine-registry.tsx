"use client";
/**
 * FILE: apps/admin/src/components/engine-registry.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The registry list: every entity (golden record) with search (name, former names, RCS number,
 *   LEI, CSSF code) and filters (kind, service provider, category, status, tier, source, has RCS). Filters live
 *   in the URL (?q=…&kind=…), so a filtered view can be bookmarked or shared; the server does the querying.
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/registry/page.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: `URLSearchParams`, `useRouter().push`, `Record<string, string | undefined>`.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import { ENGINE_SOURCES, ENTITY_KINDS, ENTITY_STATUSES } from "@fundhub/engine-db/enums";
import type { categoryOptions, registryList, RegistryFilters } from "@/lib/engine-data";
import { fmt } from "./engine-overview";

type List = Awaited<ReturnType<typeof registryList>>;
type Categories = Awaited<ReturnType<typeof categoryOptions>>;

/** Kind: constant. Colour per entity status. */
export const STATUS_COLOR: Record<string, string> = { active: "green", in_liquidation: "orange", struck_off: "red", unknown: "default" };

/** Kind: React component. The page. */
export function RegistryList({ list, filters, categories }: { list: List; filters: RegistryFilters; categories: Categories }) {
  const router = useRouter();
  // Changing a filter rebuilds the URL (dropping empty values and resetting to page 1).
  const go = (patch: Partial<RegistryFilters>) => {
    const next = { ...filters, page: undefined, ...patch };
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
    router.push(`/engine/registry${q.size ? `?${q}` : ""}`);
  };
  const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x.replace(/_/g, " ") }));
  const level1 = categories.filter((c) => c.level === 1);

  return (
    <Card title={`Registry — ${list.total.toLocaleString()} entities`} extra={<Typography.Text type="secondary">Golden records merged from CSSF, GLEIF, RCS, LBR extracts, websites and staff edits</Typography.Text>}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search allowClear placeholder="Name, former name, B123456, LEI, P00000348…" defaultValue={filters.q} style={{ width: 340 }} onSearch={(q) => go({ q })} />
        <Select allowClear placeholder="Kind" style={{ width: 170 }} value={filters.kind} options={opts(ENTITY_KINDS)} onChange={(kind) => go({ kind })} />
        <Select allowClear placeholder="Service provider" style={{ width: 150 }} value={filters.sp} options={[{ value: "yes", label: "Service providers" }, { value: "no", label: "Not service providers" }]} onChange={(sp) => go({ sp })} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Category" style={{ width: 260 }} value={filters.category}
          options={level1.map((c) => ({ label: c.label, options: [{ value: String(c.id), label: c.label }, ...categories.filter((s) => s.parentId === c.id).map((s) => ({ value: String(s.id), label: `— ${s.label}` }))] }))}
          onChange={(category) => go({ category })} />
        <Select allowClear placeholder="Status" style={{ width: 140 }} value={filters.status} options={opts(ENTITY_STATUSES)} onChange={(status) => go({ status })} />
        <Select allowClear placeholder="Tier" style={{ width: 100 }} value={filters.tier} options={["0", "1", "2"].map((t) => ({ value: t, label: `Tier ${t}` }))} onChange={(tier) => go({ tier })} />
        <Select allowClear placeholder="Has source" style={{ width: 140 }} value={filters.source} options={opts(ENGINE_SOURCES)} onChange={(source) => go({ source })} />
        <Select allowClear placeholder="RCS number" style={{ width: 140 }} value={filters.rcs} options={[{ value: "yes", label: "Has RCS no." }, { value: "no", label: "No RCS no." }]} onChange={(rcs) => go({ rcs })} />
      </Space>
      <Table size="small" rowKey="id" dataSource={list.rows}
        pagination={{ current: list.page, pageSize: list.pageSize, total: list.total, showSizeChanger: false, onChange: (page) => go({ ...filters, page: String(page) }) }}
        columns={[
          { title: "Name", dataIndex: "name", render: (n: string, r) => <Link href={`/engine/registry/${r.id}`}>{n}</Link> },
          { title: "RCS", dataIndex: "rcsNumber", render: (v: string | null) => <span className="mono">{v ?? "—"}</span>, width: 100 },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s.replace(/_/g, " ")}</Tag>, width: 110 },
          { title: "Kind", dataIndex: "kind", render: (k: string, r) => <Space size={2}>{r.sp && <Tag color="blue">SP</Tag>}<span>{k.replace(/_/g, " ")}</span></Space>, width: 170 },
          { title: "Category", render: (_, r) => <span>{r.category ?? "—"}{r.subcategory && <Typography.Text type="secondary"> · {r.subcategory}</Typography.Text>}</span> },
          { title: "Tier", dataIndex: "tier", width: 60 },
          { title: "Sources", dataIndex: "sources", render: (s: string[]) => <Space size={2} wrap>{s.map((x) => <Tag key={x} color={x === "manual" ? "purple" : undefined}>{x}</Tag>)}</Space>, width: 200 },
          { title: "Last change", dataIndex: "lastChangedAt", render: fmt, width: 150 },
        ]} />
    </Card>
  );
}
