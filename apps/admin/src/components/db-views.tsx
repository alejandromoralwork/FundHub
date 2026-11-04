"use client";
/**
 * FILE: apps/admin/src/components/db-views.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's "Database" section, a careful window onto the Postgres database.
 *   - `TablesOverview`: every database table with its row count, size, group and access level.
 *   - `ResourceList`: a generic, searchable, sortable, paged table of the rows of one table.
 *   - `ResourceEdit`: a generic form to create or edit one row, building the right input for each column.
 *   - `SqlConsole`: a box to type read-only SQL queries (database questions) and see the results.
 *   "Generic" means the same code works for any table: it first asks the server for the table's "meta"
 *   (its columns and what is allowed) and builds the screen from that.
 * WHERE IT RUNS: in the browser (`"use client"`): Refine's hooks fetch data from the Console's own API
 *   (`/admin/api/…`) while you page, sort and search. The API, running on the server, decides what each staff
 *   role may see or change.
 * FRAMEWORK NOTES:
 *   - Refine (`@refinedev/core`, `@refinedev/antd`) is an admin framework. Its hooks talk to our "data
 *     provider" (in `@/lib/data-provider`), which turns requests like "page 2 of providers, sorted by name"
 *     into calls to our API. Hooks used: `useTable` (data + paging/sorting/filtering for an antd Table),
 *     `useForm` (load a record into an antd Form and save it), `useCustom` (any other API call), `useGo`
 *     (navigate). Components used: `List`, `Create`, `Edit` (page frames with title and buttons),
 *     `EditButton`, `DeleteButton` (the delete one asks for confirmation and calls the API itself).
 *   - antd: `Table`, `Form`, inputs (`Input`, `InputNumber`, `Switch`, `Select`, `DatePicker`), `Card`,
 *     `Alert`, `Tag`, `Empty`.
 *   - React: components, props, `useState`, and the "custom hook" `useMeta` (our own function starting with
 *     `use` that combines other hooks).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases, unions of exact strings, optional fields `enumValues?: string[]`;
 *   - a union of two object shapes (`SqlResult` is either a result or `{ error }`) narrowed with `"error" in x`;
 *   - generics `useCustom<Meta>`, `Table<TableRow>`; `unknown` (a value of any type that must be checked
 *     before use); type assertions `as Meta | undefined`, `as const`; `switch`/`case`; `for … of` loops;
 *   - spread in arrays and props, `new Set(…)` (unique values), optional chaining `?.`, `??`, ternaries.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@/…` = this app's src folder.

// Next.js link component.
import Link from "next/link";
// React hook for remembering values (search text, SQL text, results).
import { useState } from "react";
// Refine core hooks (see FRAMEWORK NOTES) and `BaseRecord`, Refine's type for "one record of any table".
import { useCustom, useGo, type BaseRecord } from "@refinedev/core";
// Refine's antd-styled page frames, buttons and form/table hooks.
import { Create, DeleteButton, Edit, EditButton, List, useForm, useTable } from "@refinedev/antd";
// antd UI components.
import { Alert, Button, Card, DatePicker, Empty, Form, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography } from "antd";
// Icons: code brackets (SQL), padlock (restricted / read-only), plus (create).
import { CodeOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
// Date library; antd's DatePicker works with dayjs date objects.
import dayjs from "dayjs";
// The base web address of the Console's database API (used to fetch a table's "meta").
import { API_BASE } from "@/lib/data-provider";

// ---------------------------------------------------------------- overview

/**
 * Kind: type alias (exported). One database table in the overview: its real name, approximate number of
 * rows, size on disk as text (e.g. "1.2 MB"), the Console resource name if it can be browsed here (null =
 * only via SQL), a friendly label, the group it belongs to, whether rows may be edited, and whether it is
 * restricted (sensitive data, e.g. passwords, never shown).
 */
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

/**
 * Kind: React component (exported; used by the /db page).
 * @param tables  `TableRow[]` — all tables.
 * @param canSql  `boolean` — may this staff member use the SQL console? If so, a button to it is shown.
 * @returns       JSX: a Refine `List` page containing the tables table.
 */
export function TablesOverview({ tables, canSql }: { tables: TableRow[]; canSql: boolean }) {
  return (
    // Refine's `List` draws a page card with a title and a button area (`headerButtons`).
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
      {/* All tables on one page (`pagination={false}`), one row per table keyed by its name. */}
      <Table<TableRow>
        rowKey="table"
        dataSource={tables}
        pagination={false}
        size="middle"
        columns={[
          {
            // The table name: a link if it can be browsed here; otherwise grey text, with a padlock if
            // restricted. `r` is the whole row.
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
            // Filter menu listing each group once: `new Set(…)` keeps only unique values, `[...set]` turns
            // the set back into an array, then `.map` makes the menu entries. `onFilter` keeps matching rows.
            title: "Group",
            dataIndex: "group",
            filters: [...new Set(tables.map((t) => t.group))].map((g) => ({ text: g, value: g })),
            onFilter: (v, r) => r.group === v,
          },
          // `sorter` lets staff click the header to sort: it compares two rows `a` and `b`; a negative result
          // puts `a` first. `toLocaleString()` adds thousands separators.
          { title: "Rows", dataIndex: "rows", align: "right", render: (n: number) => <span className="tnum">{n.toLocaleString()}</span>, sorter: (a, b) => a.rows - b.rows },
          { title: "Size", dataIndex: "size", align: "right" },
          {
            // A chain of ternaries: restricted → "restricted"; not browsable → "SQL console"; editable →
            // "read / write"; otherwise "read".
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

/**
 * Kind: type alias. Describes one column of a table, as sent by the API's "meta" endpoint: its name, its
 * kind of data (one of six), the allowed values for an "enum" (fixed list) column, whether it may be empty
 * (`nullable`), whether staff may change it, and whether it is the primary key (the row's unique id).
 */
type Col = {
  name: string;
  type: "number" | "text" | "boolean" | "json" | "date" | "enum";
  enumValues?: string[];
  nullable: boolean;
  editable: boolean;
  primary: boolean;
};
/**
 * Kind: type alias. Everything the screen needs to know about one table: label, its columns, which columns
 * the search box looks in, and whether this staff member may create, delete or edit rows.
 */
type Meta = { label: string; columns: Col[]; search: string[]; canCreate: boolean; canDelete: boolean; canEdit: boolean };

/**
 * Kind: custom React hook.
 * Fetches a table's meta from `<API_BASE>/<resource>/meta`.
 * @param resource  `string` — the Console resource name, e.g. "providers".
 * @returns         `{ meta, isLoading, error }`: `meta` is the `Meta` once loaded (otherwise `undefined`),
 *                  `isLoading` is true while waiting, `error` is set if the request failed.
 */
function useMeta(resource: string) {
  // `useCustom<Meta>` sends a GET request; the generic `<Meta>` says what the answer looks like. It returns
  // `result` (the answer) and `query` (loading/error information); destructuring picks both out.
  const { result, query } = useCustom<Meta>({ url: `${API_BASE}/${resource}/meta`, method: "get" });
  // Refine yields an empty placeholder until the query resolves (e.g. during SSR).
  // `result?.data` = the data if `result` exists (optional chaining); `as Meta | undefined` tells TypeScript
  // to treat it as that type.
  const meta = result?.data as Meta | undefined;
  // Only treat it as real meta if it has a `columns` list (so the empty placeholder counts as "not loaded").
  return { meta: meta?.columns ? meta : undefined, isLoading: query.isLoading, error: query.error };
}

/**
 * Kind: function returning JSX.
 * Shows one cell value in a readable way depending on the column's type.
 * @param value  `unknown` — the raw value from the database (could be anything, so it is checked first).
 * @param col    `Col` — the column it belongs to.
 * @returns      JSX for the cell.
 */
function renderCell(value: unknown, col: Col) {
  // Empty values are shown as a faint "null" so they are not mistaken for empty text.
  if (value === null || value === undefined) return <span style={{ color: "#c0c6cf" }}>null</span>;
  // `switch` picks a branch by `col.type`; each `case` returns, so it does not fall through to the next.
  switch (col.type) {
    case "boolean":
      return value ? <Tag color="green">true</Tag> : <Tag>false</Tag>;
    case "date":
      // `String(value)` turns it into text; dayjs then formats it, e.g. "2026-03-02 14:05".
      return <span className="tnum">{dayjs(String(value)).format("YYYY-MM-DD HH:mm")}</span>;
    case "json": {
      // JSON = structured data. Lists are shown as "a, b, c"; anything else as JSON text. The braces
      // `{ … }` after `case` give `text` its own scope so the same name can be reused below.
      const text = Array.isArray(value) ? value.join(", ") : JSON.stringify(value);
      // Long text is cut to 60 characters with "…"; the full text appears on hover (`title`).
      return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}…` : text}</span>;
    }
    case "enum":
      return <Tag>{String(value)}</Tag>;
    default: {
      // Numbers and text: same cut-to-60-characters rule as above.
      const text = String(value);
      return <span title={text}>{text.length > 60 ? `${text.slice(0, 60)}…` : text}</span>;
    }
  }
}

/**
 * Kind: React component (exported; used by the /db/[resource] page).
 * The rows of one table, with search, server-side sorting and paging, and edit/delete buttons.
 * @param resource  `string` — which table (Console resource name).
 * @returns         JSX: a Refine `List` page with the table.
 */
export function ResourceList({ resource }: { resource: string }) {
  // Load the table's columns and permissions.
  const { meta, error } = useMeta(resource);
  // The text typed in the search box.
  const [q, setQ] = useState("");
  // Refine's `useTable` fetches the rows through our data provider. It returns `tableProps` (data, paging
  // and change handlers ready to spread onto an antd Table) and `setFilters` (to apply our search).
  // `syncWithLocation` keeps page/sort/filter in the address bar; `mode: "server"` means sorting and
  // filtering are done by the database, not in the browser, because tables can be large.
  const { tableProps, setFilters } = useTable({
    resource,
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { mode: "server" },
    filters: { mode: "server" },
  });

  // If the meta request failed (e.g. no permission), show its error message. The double assertion
  // `as unknown as { message: string }` forces TypeScript to accept that the error has a `message`.
  if (error) return <Alert type="error" message={(error as unknown as { message: string }).message} />;
  // Still loading: show a card with antd's loading skeleton.
  if (!meta) return <Card loading />;
  // Show at most the first 9 columns so the table stays readable (`.slice(0, 9)`).
  const visible = meta.columns.slice(0, 9);
  // Does the table have an "id" column? (`.some` returns true if at least one item matches.) Edit/delete
  // need an id to know which row to act on.
  const hasId = meta.columns.some((c) => c.name === "id");

  return (
    // `canCreate` and `createButtonProps` configure Refine's default Create button, but `headerButtons`
    // below replaces the button area with our own search box and Create link.
    <List
      title={meta.label}
      canCreate={meta.canCreate}
      createButtonProps={{ icon: <PlusOutlined />, onClick: undefined }}
      headerButtons={({ defaultButtons }) => (
        <Space>
          {/* The search box (only if the table has searchable columns). Typing updates `q`; pressing Enter
              or the search icon (`onSearch`) sends a filter named "q" to the server, replacing any old one. */}
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
          {/* Our own Create button, linking to the create form for this table. */}
          {meta.canCreate && (
            <Link href={`/db/${resource}/create`}>
              <Button type="primary" icon={<PlusOutlined />}>
                Create
              </Button>
            </Link>
          )}
          {/* `defaultButtons && null` always renders nothing: Refine's default buttons are deliberately not
              shown (the expression just "uses" the variable). */}
          {defaultButtons && null}
        </Space>
      )}
    >
      {/* `{...tableProps}` spreads Refine's ready-made props (rows, paging, sorting handlers) onto the
          antd Table. `rowKey`: use the "id" field if there is one; otherwise make a key from the whole row
          as JSON text. `scroll={{ x: true }}` allows sideways scrolling for wide tables. */}
      <Table
        {...tableProps}
        rowKey={hasId ? "id" : (r) => JSON.stringify(r)}
        size="small"
        scroll={{ x: true }}
        columns={[
          // One column per visible database column. `...` spreads the array of columns made by `.map`
          // into this list. JSON columns cannot be sorted by the server, so `sorter` is off for them.
          ...visible.map((c) => ({
            title: c.name,
            dataIndex: c.name,
            key: c.name,
            sorter: c.type !== "json",
            render: (v: unknown) => renderCell(v, c),
          })),
          // Add an actions column only if rows have an id AND the staff member may edit or delete;
          // otherwise spread an empty array (adds nothing).
          ...(hasId && (meta.canEdit || meta.canDelete)
            ? [
                {
                  title: "",
                  key: "actions",
                  // `as const` keeps the exact value "right" (not just any string), which antd requires.
                  // The column stays pinned to the right edge while scrolling sideways.
                  fixed: "right" as const,
                  render: (_: unknown, r: BaseRecord) => (
                    <Space>
                      {/* Refine's EditButton, icon only, inside our own link to the edit page
                          (`onClick={undefined}` stops Refine's own navigation so the link is used). */}
                      {meta.canEdit && (
                        <Link href={`/db/${resource}/${r.id}`}>
                          <EditButton hideText size="small" recordItemId={r.id} onClick={undefined} />
                        </Link>
                      )}
                      {/* Refine's DeleteButton asks "Are you sure?" and then deletes the row through the
                          data provider, refreshing the table. */}
                      {meta.canDelete && <DeleteButton hideText size="small" resource={resource} recordItemId={r.id} />}
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      {/* A note when some columns were hidden by the 9-column limit. */}
      {meta.columns.length > visible.length && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Showing the first {visible.length} of {meta.columns.length} columns. Open a row to see all fields.
        </Typography.Text>
      )}
    </List>
  );
}

/**
 * Kind: React component (private).
 * Picks the right input for a column type: switch for true/false, number box, drop-down for fixed lists,
 * date-and-time picker, a monospace text area for JSON, and a growing text area for everything else.
 * @param col  `Col` — the column.
 * @returns    JSX for the input, greyed out (disabled) if the column may not be edited.
 */
function FieldInput({ col }: { col: Col }) {
  const disabled = !col.editable;
  switch (col.type) {
    case "boolean":
      return <Switch disabled={disabled} />;
    case "number":
      return <InputNumber disabled={disabled} style={{ width: "100%" }} />;
    case "enum":
      // `allowClear` only when the column may be empty. `col.enumValues?.map` = map the list if it exists.
      return <Select disabled={disabled} allowClear={col.nullable} options={col.enumValues?.map((v) => ({ value: v, label: v }))} />;
    case "date":
      return <DatePicker showTime disabled={disabled} style={{ width: "100%" }} />;
    case "json":
      return <Input.TextArea disabled={disabled} rows={3} className="mono" />;
    default:
      return <Input.TextArea disabled={disabled} autoSize={{ minRows: 1, maxRows: 6 }} />;
  }
}

/**
 * Kind: function.
 * Converts between API values and antd form values (dates ↔ dayjs, json ↔ text).
 * This one goes API → form: date text becomes a dayjs object (what DatePicker needs) and JSON becomes
 * readable text (`JSON.stringify(v, null, 1)` = pretty-printed with 1-space indentation).
 * @param cols    `Col[]` — the table's columns.
 * @param record  `Record<string, unknown> | undefined` — the row from the API, or undefined (not loaded / new).
 * @returns       an object of form values, or `undefined` when there is no record.
 */
function toForm(cols: Col[], record: Record<string, unknown> | undefined) {
  if (!record) return undefined;
  // An empty object to fill in, field by field.
  const out: Record<string, unknown> = {};
  // `for (const c of cols)` loops over every column in turn.
  for (const c of cols) {
    // `record[c.name]` reads the field whose name is in `c.name`.
    const v = record[c.name];
    // `v != null` (with `!=`, not `!==`) is true when v is neither null nor undefined.
    out[c.name] = c.type === "date" && v ? dayjs(String(v)) : c.type === "json" && v != null ? JSON.stringify(v, null, 1) : v;
  }
  return out;
}

/**
 * Kind: function. The reverse direction, form → API: keeps only editable fields that the form actually has
 * (`c.name in values` checks the key exists), and turns dayjs dates back into standard ISO text
 * (e.g. "2026-03-02T14:05:00.000Z"). JSON text is sent as text; the server parses it.
 * @param cols    `Col[]` — the table's columns.
 * @param values  `Record<string, unknown>` — what the form contains.
 * @returns       `Record<string, unknown>` — the values to save.
 */
function fromForm(cols: Col[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    // `continue` skips to the next column: read-only or missing fields are not sent.
    if (!c.editable || !(c.name in values)) continue;
    const v = values[c.name];
    // `(v as dayjs.Dayjs)` tells TypeScript this value is a dayjs date, so `.toISOString()` is allowed.
    out[c.name] = c.type === "date" && v ? (v as dayjs.Dayjs).toISOString() : v;
  }
  return out;
}

/**
 * Kind: React component (exported; used by /db/[resource]/[id] and /db/[resource]/create).
 * Edit an existing row (when `id` is given) or create a new one (when it is not).
 * @param resource  `string` — which table.
 * @param id        optional `string` — the row's id; missing means "create".
 * @returns         JSX: a Refine `Edit` or `Create` page with a generated form.
 */
export function ResourceEdit({ resource, id }: { resource: string; id?: string }) {
  const { meta } = useMeta(resource);
  // `go(…)` navigates to another page, Refine-style.
  const go = useGo();
  // Refine's `useForm` loads the record (when editing) and saves it. It returns props for the antd Form,
  // props for the Save button, the loading `query`, and `onFinish` (call it with values to save).
  // `redirect: false` turns off Refine's own redirect; instead, after a successful save
  // (`onMutationSuccess`) we go back to the table's list.
  const { formProps, saveButtonProps, query, onFinish } = useForm({
    resource,
    id,
    action: id ? "edit" : "create",
    redirect: false,
    onMutationSuccess: () => go({ to: `/db/${resource}` }),
  });
  if (!meta) return <Card loading />;
  // The loaded row (when editing); `query?.data?.data` safely digs into the response.
  const record = query?.data?.data as Record<string, unknown> | undefined;
  // When editing, show every column (read-only ones greyed out); when creating, only the editable ones.
  const fields = meta.columns.filter((c) => (id ? true : c.editable));
  // Choose the page frame: a component can be stored in a variable and used as `<Wrapper>` (capitalised).
  const Wrapper = id ? Edit : Create;

  return (
    <Wrapper title={`${id ? "Edit" : "Create"} · ${meta.label}`} saveButtonProps={saveButtonProps} isLoading={id ? query?.isLoading : false}>
      {/* If nothing can be edited, say so. */}
      {!fields.some((c) => c.editable) && <Empty description="This table is read-only here." />}
      {/* `{...formProps}` passes Refine's form wiring. `initialValues` fills the fields from the record.
          `key` changes from "empty" to "loaded" when the record arrives; a new key makes React rebuild the
          form, which is needed because antd only reads `initialValues` once. `onFinish` converts the values
          with `fromForm` before Refine saves them. */}
      <Form
        {...formProps}
        layout="vertical"
        initialValues={toForm(meta.columns, record)}
        key={record ? "loaded" : "empty"}
        onFinish={(values) => onFinish(fromForm(meta.columns, values as Record<string, unknown>))}
      >
        {/* A responsive CSS grid: as many 280px-or-wider columns as fit across the page. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0 16px" }}>
          {/* One form field per column. The label is the column name, with a padlock if read-only.
              Switches store true/false in `checked`, hence `valuePropName`. Required rule: only for editable,
              non-nullable, non-boolean, non-JSON columns, and only when creating (`required: !id`). */}
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

/**
 * Kind: type alias (a union of two shapes).
 * Either a successful result — column names, the rows, how many rows, how long it took in milliseconds,
 * and whether the rows were cut off at the limit — or `{ error: string }` when the query failed.
 */
type SqlResult = { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; ms: number; truncated: boolean } | { error: string };

/**
 * Kind: React component (exported; used by the /db/sql page).
 * @param run     `(query: string) => Promise<SqlResult>` — a server action passed in by the page that runs
 *                the SQL on the server in a read-only transaction and returns the result.
 * @param tables  `string[]` — table names, listed as a reminder.
 * @returns       JSX: the SQL box, Run button and results table.
 */
export function SqlConsole({ run, tables }: { run: (query: string) => Promise<SqlResult>; tables: string[] }) {
  // The SQL text, starting with an example query (providers per category with average rating).
  // `\n` inside the string is a line break.
  const [query, setQuery] = useState("select category, count(*) as providers, round(avg(rating)::numeric, 2) as avg_rating\nfrom providers\nwhere status = 'published'\ngroup by category\norder by providers desc;");
  // The last result (null before the first run) and whether a query is running.
  const [result, setResult] = useState<SqlResult | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card title="SQL console" extra={<Tag color="blue">read-only · 5s timeout · 500 rows</Tag>}>
      {/* `process.env.NEXT_PUBLIC_ANALYST_ROLE` is a setting baked in at build time (only settings whose
          name starts with NEXT_PUBLIC_ reach the browser). The table names are listed as <code> chips. */}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Queries run inside a read-only transaction{process.env.NEXT_PUBLIC_ANALYST_ROLE ? " as the analyst role" : ""}; writes are rejected by Postgres.
        Tables: {tables.map((t) => <code key={t} style={{ marginRight: 6 }}>{t}</code>)}
      </Typography.Paragraph>
      {/* The SQL text box. `onKeyDown` watches key presses: Ctrl+Enter (or Cmd+Enter on a Mac, `metaKey`)
          finds the Run button by its id and clicks it. `?.click()` only clicks if it was found. */}
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
        {/* Run: mark busy, wait for the server's result and store it, then mark not busy. */}
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
        {/* `"error" in result` checks whether the result has an `error` field; this also lets TypeScript
            know which of the two shapes it is (called "narrowing"). Success → row count and timing. */}
        {result && !("error" in result) && (
          <Typography.Text type="secondary">
            {result.rowCount} rows · {result.ms} ms{result.truncated ? " · truncated to 500" : ""}
          </Typography.Text>
        )}
      </Space>
      {/* Failure → a red box with the database's error message. */}
      {result && "error" in result && <Alert style={{ marginTop: 12 }} type="error" message={result.error} />}
      {/* Success → the rows. Rows have no id, so the row's position `i` is used as its key. Columns are
          built from the column names; each cell shows a faint "null", JSON text for objects, or plain text
          (`typeof v === "object"` checks whether the value is an object/array). */}
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
