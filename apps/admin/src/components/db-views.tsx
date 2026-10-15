"use client";

import Link from "next/link";
import { useState } from "react";
import { useCustom, useGo, type BaseRecord } from "@refinedev/core";
import { Create, DeleteButton, Edit, EditButton, List, useForm, useTable } from "@refinedev/antd";
import { Alert, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { CodeOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { API_BASE } from "@/lib/data-provider";

// ---------------------------------------------------------------- overview

export type TableRow = {
  table: string;
  rows: number;
  size: string;
  resource: string | null;
  label: string | null;
  group: string;
  editable: boolean;
  restricted: boolean;
};

export function TablesOverview({ tables, canSql }: { tables: TableRow[]; canSql: boolean }) {
  return (
    <List
      title="Database"
      headerButtons={
        canSql ? (
          <Link href="/db/sql">
            <Button icon={<CodeOutlined />}>SQL console (read-only)</Button>
          </Link>
        ) : null
      }
    >
      <Table<TableRow>
        rowKey="table"
        dataSource={tables}
        pagination={false}
        size="middle"
        columns={[
          {
            title: "Table",
            dataIndex: "table",
            render: (t: string, r) =>
              r.resource ? (
                <Link href={`/db/${r.resource}`}>
                  <span className="mono">{t}</span>
                </Link>
              ) : (
                <span className="mono" style={{ color: "#8a94a3" }}>
                  {r.restricted && <LockOutlined style={{ marginRight: 6 }} />}
                  {t}
                </span>
              ),
          },
          { title: "Name", dataIndex: "label", render: (l: string | null) => l ?? "—" },
          {
            title: "Group",
            dataIndex: "group",
            filters: [...new Set(tables.map((t) => t.group))].map((g) => ({ text: g, value: g })),
            onFilter: (v, r) => r.group === v,
          },
          { title: "Rows", dataIndex: "rows", align: "right", render: (n: number) => <span className="tnum">{n.toLocaleString()}</span>, sorter: (a, b) => a.rows - b.rows },
          { title: "Size", dataIndex: "size", align: "right" },
          {
            title: "Access",
            render: (_, r) =>
              r.restricted ? <Tag>restricted</Tag> : !r.resource ? <Tag>SQL console</Tag> : r.editable ? <Tag color="green">read / write</Tag> : <Tag color="blue">read</Tag>,
          },
        ]}
      />
    </List>
  );
}

// ---------------------------------------------------------------- generic resource list / edit

type Col = {
  name: string;
  type: "number" | "text" | "boolean" | "json" | "date" | "enum";
  enumValues?: string[];
  nullable: boolean;
  editable: boolean;
  primary: boolean;
};
type Meta = { label: string; columns: Col[]; search: string[]; canCreate: boolean; canDelete: boolean; canEdit: boolean };

function useMeta(resource: string) {
  const { result, query } = useCustom<Meta>({ url: `${API_BASE}/${resource}/meta`, method: "get" });
  // Refine yields an empty placeholder until the query resolves (e.g. during SSR).
  const meta = result?.data as Meta | undefined;
  return { meta: meta?.columns ? meta : undefined, isLoading: query.isLoading, error: query.error };
}

function renderCell(value: unknown, col: Col) {
  if (value === null || value === undefined) return <span style={{ color: "#c0c6cf" }}>null</span>;
  switch (col.type) {
    case "boolean":
      return value ? <Tag color="green">true</Tag> : <Tag>false</Tag>;
    case "date":
      return <span className="tnum">{dayjs(String(value)).format("YYYY-MM-DD HH:mm")}</span>;
    case "json": {
      const text = Array.isArray(value) ? value.join(", ") : JSON.stringify(value);
      return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}…` : text}</span>;
    }
    case "enum":
      return <Tag>{String(value)}</Tag>;
    default: {
      const text = String(value);
      return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}…` : text}</span>;
    }
  }
}

export function ResourceList({ resource }: { resource: string }) {
  const { meta, error } = useMeta(resource);
  const [q, setQ] = useState("");
  const { tableProps, setFilters } = useTable({
    resource,
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { mode: "server" },
    filters: { mode: "server" },
  });

  if (error) return <Alert type="error" message={(error as unknown as { message: string }).message} />;
  if (!meta) return <Card loading />;
  const visible = meta.columns.slice(0, 9);
  const hasId = meta.columns.some((c) => c.name === "id");

  return (
    <List
      title={meta.label}
      canCreate={meta.canCreate}
      createButtonProps={{ icon: <PlusOutlined />, onClick: undefined }}
      headerButtons={({ defaultButtons }) => (
        <Space>
          {meta.search.length > 0 && (
            <Input.Search
              placeholder={`Search ${meta.search.join(", ")}`}
              allowClear
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onSearch={(v) => setFilters([{ field: "q", operator: "contains", value: v }], "replace")}
              style={{ width: 280 }}
            />
          )}
          {meta.canCreate && (
            <Link href={`/db/${resource}/create`}>
              <Button type="primary" icon={<PlusOutlined />}>
                Create
              </Button>
            </Link>
          )}
          {defaultButtons && null}
        </Space>
      )}
    >
      <Table
        {...tableProps}
        rowKey={hasId ? "id" : (r) => JSON.stringify(r)}
        size="small"
        scroll={{ x: true }}
        columns={[
          ...visible.map((c) => ({
            title: c.name,
            dataIndex: c.name,
            key: c.name,
            sorter: c.type !== "json",
            render: (v: unknown) => renderCell(v, c),
          })),
          ...(hasId && (meta.canEdit || meta.canDelete)
            ? [
                {
                  title: "",
                  key: "actions",
                  fixed: "right" as const,
                  render: (_: unknown, r: BaseRecord) => (
                    <Space>
                      {meta.canEdit && (
                        <Link href={`/db/${resource}/${r.id}`}>
                          <EditButton hideText size="small" recordItemId={r.id} onClick={undefined} />
                        </Link>
                      )}
                      {meta.canDelete && <DeleteButton hideText size="small" resource={resource} recordItemId={r.id} />}
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      {meta.columns.length > visible.length && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Showing the first {visible.length} of {meta.columns.length} columns. Open a row to see all fields.
        </Typography.Text>
      )}
    </List>
  );
}

function FieldInput({ col }: { col: Col }) {
  const disabled = !col.editable;
  switch (col.type) {
    case "boolean":
      return <Switch disabled={disabled} />;
    case "number":
      return <InputNumber disabled={disabled} style={{ width: "100%" }} />;
    case "enum":
      return <Select disabled={disabled} allowClear={col.nullable} options={col.enumValues?.map((v) => ({ value: v, label: v }))} />;
    case "date":
      return <DatePicker showTime disabled={disabled} style={{ width: "100%" }} />;
    case "json":
      return <Input.TextArea disabled={disabled} rows={3} className="mono" />;
    default:
      return <Input.TextArea disabled={disabled} autoSize={{ minRows: 1, maxRows: 6 }} />;
  }
}

/** Converts between API values and antd form values (dates ↔ dayjs, json ↔ text). */
function toForm(cols: Col[], record: Record<string, unknown> | undefined) {
  if (!record) return undefined;
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    const v = record[c.name];
    out[c.name] = c.type === "date" && v ? dayjs(String(v)) : c.type === "json" && v != null ? JSON.stringify(v, null, 1) : v;
  }
  return out;
}

function fromForm(cols: Col[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    if (!c.editable || !(c.name in values)) continue;
    const v = values[c.name];
    out[c.name] = c.type === "date" && v ? (v as dayjs.Dayjs).toISOString() : v;
  }
  return out;
}

export function ResourceEdit({ resource, id }: { resource: string; id?: string }) {
  const { meta } = useMeta(resource);
  const go = useGo();
  const { formProps, saveButtonProps, query, onFinish } = useForm({
    resource,
    id,
    action: id ? "edit" : "create",
    redirect: false,
    onMutationSuccess: () => go({ to: `/db/${resource}` }),
  });
  if (!meta) return <Card loading />;
  const record = query?.data?.data as Record<string, unknown> | undefined;
  const fields = meta.columns.filter((c) => (id ? true : c.editable));
  const Wrapper = id ? Edit : Create;

  return (
    <Wrapper title={`${id ? "Edit" : "Create"} · ${meta.label}`} saveButtonProps={saveButtonProps} isLoading={id ? query?.isLoading : false}>
      {!fields.some((c) => c.editable) && <Empty description="This table is read-only here." />}
      <Form
        {...formProps}
        layout="vertical"
        initialValues={toForm(meta.columns, record)}
        key={record ? "loaded" : "empty"}
        onFinish={(values) => onFinish(fromForm(meta.columns, values as Record<string, unknown>))}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0 16px" }}>
          {fields.map((c) => (
            <Form.Item
              key={c.name}
              name={c.name}
              label={
                <span className="mono" style={{ fontSize: 12 }}>
                  {c.name}
                  {!c.editable && <LockOutlined style={{ marginLeft: 6, color: "#aab" }} />}
                </span>
              }
              valuePropName={c.type === "boolean" ? "checked" : "value"}
              rules={c.editable && !c.nullable && c.type !== "boolean" && c.type !== "json" ? [{ required: !id, message: "Required" }] : []}
            >
              <FieldInput col={c} />
            </Form.Item>
          ))}
        </div>
      </Form>
    </Wrapper>
  );
}

// ---------------------------------------------------------------- SQL console

type SqlResult = { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; ms: number; truncated: boolean } | { error: string };

export function SqlConsole({ run, tables }: { run: (query: string) => Promise<SqlResult>; tables: string[] }) {
  const [query, setQuery] = useState("select category, count(*) as providers, round(avg(rating)::numeric, 2) as avg_rating\nfrom providers\nwhere status = 'published'\ngroup by category\norder by providers desc;");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card title="SQL console" extra={<Tag color="blue">read-only · 5s timeout · 500 rows</Tag>}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Queries run inside a read-only transaction{process.env.NEXT_PUBLIC_ANALYST_ROLE ? " as the analyst role" : ""}; writes are rejected by Postgres.
        Tables: {tables.map((t) => <code key={t} style={{ marginRight: 6 }}>{t}</code>)}
      </Typography.Paragraph>
      <Input.TextArea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={8}
        className="mono"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") document.getElementById("run-sql")?.click();
        }}
      />
      <Space style={{ marginTop: 12 }}>
        <Button
          id="run-sql"
          type="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setResult(await run(query));
            setBusy(false);
          }}
        >
          Run (Ctrl+Enter)
        </Button>
        {result && !("error" in result) && (
          <Typography.Text type="secondary">
            {result.rowCount} rows · {result.ms} ms{result.truncated ? " · truncated to 500" : ""}
          </Typography.Text>
        )}
      </Space>
      {result && "error" in result && <Alert style={{ marginTop: 12 }} type="error" message={result.error} />}
      {result && !("error" in result) && (
        <Table
          style={{ marginTop: 12 }}
          size="small"
          scroll={{ x: true }}
          rowKey={(_, i) => String(i)}
          dataSource={result.rows}
          pagination={{ pageSize: 50 }}
          columns={result.columns.map((c) => ({
            title: <span className="mono">{c}</span>,
            dataIndex: c,
            render: (v: unknown) => (v === null ? <span style={{ color: "#c0c6cf" }}>null</span> : typeof v === "object" ? JSON.stringify(v) : String(v)),
          }))}
        />
      )}
    </Card>
  );
}
