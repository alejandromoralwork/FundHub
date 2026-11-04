"use client";

/**
 * FILE: apps/admin/src/components/finance-view.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's Finance screen. It shows headline figures for a chosen year (revenue, costs,
 *   result, monthly recurring revenue, unpaid invoices), a monthly profit-and-loss chart and table, CSV
 *   exports for the accountant, and four tabs: the expenses list (add/edit/delete), budget vs actual for the
 *   current month, an indicative VAT summary per quarter, and costs by category.
 * WHERE IT RUNS: in the browser ("use client"): it has buttons, a pop-up editor and local state. All figures
 *   are calculated on the server (by `getFinanceSummary` in "@/lib/finance") and passed in as props; changes are
 *   saved through server actions in "@/lib/finance-actions".
 * FRAMEWORK NOTES:
 *   - Money is stored everywhere as whole cents (integers) to avoid rounding errors with decimals;
 *     it is only divided by 100 for display or in the edit form.
 *   - Recharts is a charting library: <ResponsiveContainer> sizes the chart, <BarChart data=…> draws bars,
 *     and child components add the grid, axes, tooltip and the bar series itself.
 *   - antd parts used: Statistic (big number with a label), Tabs (`items` array, one object per tab), Table
 *     (`columns` describe each column, `render` customises a cell), Modal (pop-up dialog), Form with
 *     `Form.useForm()` (a handle to read/fill/submit the form from code), Form.Item `name` (field key) and
 *     `rules` (validation), DatePicker, InputNumber, Popconfirm ("are you sure?").
 *   - `useAction` (our hook) runs a server action, shows a toast and refreshes the page data.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Awaited<ReturnType<typeof fn>>`: "the type of the value `fn` eventually returns" (worked out automatically).
 *   - `import type { … }` imports only a type, no code. Object types, `string | null`, unions with literal
 *     values (`ExpenseRow | "new" | null`), generics (`useState<…>`, `Table<ExpenseRow>`).
 *   - arrow functions, template strings, `.reduce/.filter/.find/.map`, `?.` and `??`, spread `{ ...row }`,
 *     ternary `c ? x : y`, `as dayjs.Dayjs` (type assertion: "trust me, this is a Dayjs date").
 */

// `import { a } from "b"` brings named things from module "b"; `import x from "b"` takes its default export.
// Plain names are npm libraries; `@fundhub/…` our shared packages; `@/…` this app's src; `./…` same folder.
// React hook to remember which expense is being edited.
import { useState } from "react";
// Recharts pieces for the monthly result bar chart.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
// Ant Design UI components (see FRAMEWORK NOTES).
import { Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
// Icons for the download, add and "sync/copy" buttons.
import { DownloadOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
// dayjs: date library for formatting and today's date/month/year.
import dayjs from "dayjs";
// Shared lists of allowed expense categories and Luxembourg VAT rates (e.g. 17, 14, 8, 3, 0).
import { EXPENSE_CATEGORIES, VAT_RATES } from "@fundhub/core/enums";
// Server actions: copy recurring costs into this month, delete/save an expense, build CSV text, save a budget.
import { copyRecurring, deleteExpense, exportCsv, saveBudget, saveExpense } from "@/lib/finance-actions";
// Only the TYPE of the server function that builds the summary (used below to describe the `summary` prop).
import type { getFinanceSummary } from "@/lib/finance";
// Helper that saves text as a downloaded file.
import { downloadText } from "./download";
// Hook: run a server action + toast + refresh.
import { useAction } from "./use-action";

/**
 * Kind: type alias.
 * Whatever `getFinanceSummary` returns once its Promise resolves: `ReturnType<typeof f>` is f's return type
 * (a Promise here) and `Awaited<…>` unwraps the Promise. Writing it this way keeps this type automatically in
 * sync with the server code (fields used below: monthly, budgets, mrr, outstanding, vat, byCategory).
 */
type Summary = Awaited<ReturnType<typeof getFinanceSummary>>;
/**
 * Kind: type alias (exported for the server page that loads the expenses).
 * One expense row. `amountNet` and `vatAmount` are in cents; `vatRate` is a percentage (17 = 17%);
 * `date` is "YYYY-MM-DD" text; `recurring` marks monthly costs; `receiptUrl` is a Drive link or `null` (none).
 */
export type ExpenseRow = {
  id: number;
  date: string;
  vendor: string;
  category: string;
  description: string;
  amountNet: number;
  vatRate: number;
  vatAmount: number;
  status: string;
  recurring: boolean;
  receiptUrl: string | null;
};

/**
 * Kind: constant holding an arrow function.
 * Formats cents as euros with 2 decimals, e.g. 123456 → "€1,234.56". `toLocaleString("en-GB", …)` adds
 * thousands separators; the `` `€${…}` `` template string inserts the result after the € sign.
 */
const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Kind: arrow function. Same as `eur` but rounded to whole euros (`Math.round`), for headline figures. */
const eur0 = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

/** Kind: arrow function. Downloads CSV text (`csv`) as a file called `name`, with the CSV file type. */
const download = (name: string, csv: string) => downloadText(name, csv, "text/csv");

/**
 * Kind: React component.
 * Props (destructured from one object):
 * @param year         type `number` — the financial year being shown (chosen in the year dropdown).
 * @param summary      type `Summary` — all server-calculated figures for that year (see the type above).
 * @param expenseRows  type `ExpenseRow[]` — the expenses of that year.
 * @param driveUrl     type `string | null` — link to the receipts folder in Drive, or `null` if not configured.
 * @returns JSX: the whole finance dashboard (stats row, P&L card, tabs card and the expense editor pop-up).
 */
export function FinanceView({ year, summary, expenseRows, driveUrl }: { year: number; summary: Summary; expenseRows: ExpenseRow[]; driveUrl: string | null }) {
  // `run(fn)` executes a server action with toast + refresh; `pending` is true while it runs.
  const { run, pending } = useAction();
  // What the editor pop-up is showing: an existing expense, the literal text "new" (blank form), or `null` (closed).
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  // `Form.useForm()` creates a handle (`form`) we pass to <Form form={form}> so code can fill and submit it.
  const [form] = Form.useForm();
  // Year totals. `.reduce((sum, m) => sum + m.revenue, 0)` walks the 12 months and adds them up, starting at 0.
  const revenue = summary.monthly.reduce((s, m) => s + m.revenue, 0);
  const costs = summary.monthly.reduce((s, m) => s + m.costs, 0);
  // The current calendar month as text, e.g. "2026-10", used by the budget tab.
  const month = dayjs().format("YYYY-MM");
  // Net amount spent this month in category `cat`: keep (`.filter`) only matching expenses whose date starts with
  // the month text, then add up their amounts (`.reduce`).
  const spentThisMonth = (cat: string) => expenseRows.filter((e) => e.category === cat && e.date.startsWith(month)).reduce((s, e) => s + e.amountNet, 0);
  // The budget set for `cat` this month. `.find` returns the first match or `undefined`; `?.amount` reads amount only
  // if a match exists; `?? 0` uses 0 when the result is `undefined` (no budget set).
  const budgetFor = (cat: string) => summary.budgets.find((b) => b.month === month && b.category === cat)?.amount ?? 0;

  /**
   * Kind: arrow function.
   * Opens the expense pop-up. For "new" it pre-fills sensible defaults (today, 17% VAT, a common category);
   * for an existing row it copies the row into the form (`{ ...row }`), turning the date text into a dayjs date
   * (what DatePicker needs) and cents into euros (what staff type).
   */
  const openEditor = (row: ExpenseRow | "new") => {
    setEditing(row);
    form.setFieldsValue(
      row === "new"
        ? { date: dayjs(), vatRate: 17, category: "Software & SaaS", status: "recorded", recurring: false }
        : { ...row, date: dayjs(row.date), amountNet: row.amountNet / 100 },
    );
  };

  // The screen is a vertical stack (Space direction="vertical") of: stats row, P&L card, tabs card, editor Modal.
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* Row 1: year picker and headline figures. Changing the year reloads the page with "?year=2025" in the
          URL, so the server recalculates for that year. The options are this year and the two before it:
          `[0, 1, 2].map(d => …)` turns each offset into a `{ value, label }` dropdown option. */}
      <Space wrap size="large" align="center">
        <Select value={year} onChange={(y) => (window.location.search = `?year=${y}`)} options={[0, 1, 2].map((d) => ({ value: dayjs().year() - d, label: String(dayjs().year() - d) }))} />
        {/* Each small Card holds one Statistic (label + big number). "Result" is red when negative, green otherwise.
            MRR = monthly recurring revenue from Pro subscriptions. */}
        <Card size="small"><Statistic title={`Revenue ${year} (net, paid)`} value={eur0(revenue)} /></Card>
        <Card size="small"><Statistic title={`Costs ${year} (net)`} value={eur0(costs)} /></Card>
        <Card size="small"><Statistic title="Result" value={eur0(revenue - costs)} valueStyle={{ color: revenue - costs < 0 ? "#b91c1c" : "#0c8265" }} /></Card>
        <Card size="small"><Statistic title="MRR (Pro)" value={eur0(summary.mrr)} /></Card>
        <Card size="small"><Statistic title="Outstanding invoices" value={eur0(summary.outstanding)} /></Card>
      </Space>

      {/* Row 2: profit & loss. The `extra` slot (top-right) holds two export buttons: each awaits the server action
          `exportCsv` (which returns CSV text) and then downloads it as a file. */}
      <Card
        title="Profit & loss"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={async () => download(`fundhub-revenue-${year}.csv`, await exportCsv("revenue", year))}>Revenue CSV</Button>
            <Button icon={<DownloadOutlined />} onClick={async () => download(`fundhub-expenses-${year}.csv`, await exportCsv("expenses", year))}>Expenses CSV</Button>
          </Space>
        }
      >
        {/* antd's grid: a Row is 24 units wide. `xs={24}` = full width on phones; `lg={14}`/`lg={10}` = side by side
            on large screens. `gutter={16}` = 16px gap between columns. */}
        <Row gutter={16}>
          <Col xs={24} lg={14}>
            <Typography.Text type="secondary">Monthly result (revenue minus costs)</Typography.Text>
            {/* Bar chart of each month's profit. `data` copies each month (`{ ...m }`) and adds a short `label`
                such as "Jan" for the X axis. Axis numbers and the hover tooltip are formatted as euros. */}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={summary.monthly.map((m) => ({ ...m, label: dayjs(`${m.month}-01`).format("MMM") }))} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid stroke="#eef0f3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#8a94a3" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#8a94a3" }} axisLine={false} tickLine={false} tickFormatter={(v) => eur0(Number(v))} />
                <Tooltip formatter={(v) => eur(Number(v))} />
                <Bar dataKey="profit" name="Result" fill="#0f9d78" radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </Col>
          <Col xs={24} lg={10}>
            {/* The same months as a table. `className="tnum"` uses fixed-width digits so numbers line up. */}
            <Table size="small" pagination={false} rowKey="month" dataSource={summary.monthly}
              columns={[
                { title: "Month", dataIndex: "month" },
                { title: "Revenue", dataIndex: "revenue", align: "right", render: (v: number) => <span className="tnum">{eur0(v)}</span> },
                { title: "Costs", dataIndex: "costs", align: "right", render: (v: number) => <span className="tnum">{eur0(v)}</span> },
                { title: "Result", dataIndex: "profit", align: "right", render: (v: number) => <span className="tnum" style={{ color: v < 0 ? "#b91c1c" : undefined }}>{eur0(v)}</span> },
              ]} />
          </Col>
        </Row>
      </Card>

      {/* Row 3: tabs. Each object in `items` is one tab: `key` (id), `label` (tab title), `children` (its content). */}
      <Card>
        <Tabs
          items={[
            // Tab 1: the list of this year's expenses with buttons to add, copy recurring costs, edit and delete.
            {
              key: "expenses",
              label: `Expenses (${expenseRows.length})`,
              children: (
                <>
                  {/* "Copy recurring" runs a server action that duplicates every monthly cost into the current month.
                      The Drive link only appears when `driveUrl` is set; target="_blank" opens a new tab and
                      rel="noreferrer" stops the new tab seeing which page opened it. */}
                  <Space style={{ marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor("new")}>Add expense</Button>
                    <Button icon={<SyncOutlined />} loading={pending} onClick={() => run(() => copyRecurring())}>Copy recurring into this month</Button>
                    {driveUrl && <a href={driveUrl} target="_blank" rel="noreferrer"><Button>Open receipts in Drive</Button></a>}
                  </Space>
                  {/* Expenses table. `sorter` lets staff sort by date (`localeCompare` compares two texts);
                      `filters` + `onFilter` add a category filter menu to the column header. The last two
                      columns show tags (monthly / paid / receipt link) and Edit/Delete buttons; Delete asks
                      for confirmation, then calls the `deleteExpense` server action. */}
                  <Table<ExpenseRow> size="small" rowKey="id" dataSource={expenseRows} pagination={{ pageSize: 25 }}
                    columns={[
                      { title: "Date", dataIndex: "date", render: (d: string) => dayjs(d).format("D MMM YYYY"), sorter: (a, b) => a.date.localeCompare(b.date) },
                      { title: "Vendor", dataIndex: "vendor" },
                      { title: "Category", dataIndex: "category", filters: EXPENSE_CATEGORIES.map((c) => ({ text: c, value: c })), onFilter: (v, r) => r.category === v },
                      { title: "Net", dataIndex: "amountNet", align: "right", render: (v: number) => <span className="tnum">{eur(v)}</span> },
                      { title: "VAT", align: "right", render: (_, r) => <span className="tnum">{eur(r.vatAmount)} ({r.vatRate}%)</span> },
                      { title: "", render: (_, r) => <Space>{r.recurring && <Tag>monthly</Tag>}<Tag color={r.status === "paid" ? "green" : "orange"}>{r.status}</Tag>{r.receiptUrl && <a href={r.receiptUrl} target="_blank" rel="noreferrer">receipt</a>}</Space> },
                      { title: "", render: (_, r) => <Space><Button size="small" onClick={() => openEditor(r)}>Edit</Button><Popconfirm title="Delete this expense?" onConfirm={() => run(() => deleteExpense(r.id))}><Button size="small" danger>Delete</Button></Popconfirm></Space> },
                    ]} />
                </>
              ),
            },
            // Tab 2: one row per expense category for the current month: budget (editable), spent, remaining.
            // The budget box is an InputNumber in euros; when it loses focus (`onBlur`) it saves only if the value
            // changed (compared in cents: `Math.round(v * 100) !== r.budget`). `|| 0` treats an empty box as 0.
            // "Remaining" is red if over budget, or "—" when no budget is set (a 0 budget counts as "not set").
            {
              key: "budget",
              label: "Budget vs actual",
              children: (
                <Table size="small" pagination={false} rowKey="category" dataSource={EXPENSE_CATEGORIES.map((c) => ({ category: c, budget: budgetFor(c), actual: spentThisMonth(c) }))}
                  title={() => `This month (${month}). Budgets are per month and category.`}
                  columns={[
                    { title: "Category", dataIndex: "category" },
                    {
                      title: "Budget (€)",
                      render: (_, r) => (
                        <InputNumber size="small" min={0} defaultValue={r.budget / 100} style={{ width: 120 }}
                          onBlur={(e) => { const v = Number(e.target.value || 0); if (Math.round(v * 100) !== r.budget) run(() => saveBudget({ month, category: r.category, amount: v })); }} />
                      ),
                    },
                    { title: "Actual", dataIndex: "actual", align: "right", render: (v: number) => <span className="tnum">{eur(v)}</span> },
                    { title: "Remaining", align: "right", render: (_, r) => (r.budget ? <span className="tnum" style={{ color: r.budget - r.actual < 0 ? "#b91c1c" : "#0c8265" }}>{eur(r.budget - r.actual)}</span> : "—") },
                  ]} />
              ),
            },
            // Tab 3: VAT per quarter: VAT charged on sales (output) minus VAT paid on expenses (input) = net position.
            // A positive number is owed to the tax office (AED); a negative one can be recovered.
            {
              key: "vat",
              label: "VAT summary",
              children: (
                <>
                  <Table size="small" pagination={false} rowKey="quarter" dataSource={summary.vat}
                    columns={[
                      { title: "Quarter", dataIndex: "quarter" },
                      { title: "VAT charged (sales)", dataIndex: "output_vat", align: "right", render: (v: number) => <span className="tnum">{eur(v)}</span> },
                      { title: "VAT paid (expenses)", dataIndex: "input_vat", align: "right", render: (v: number) => <span className="tnum">{eur(v)}</span> },
                      { title: "Net position", dataIndex: "payable", align: "right", render: (v: number) => <span className="tnum">{eur(v)} {v >= 0 ? "to pay" : "to recover"}</span> },
                    ]} />
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
                    Indicative only, for planning. Your VAT returns to the AED are prepared by your accountant from the CSV exports.
                  </Typography.Paragraph>
                </>
              ),
            },
            // Tab 4: total net costs per category for the year.
            {
              key: "categories",
              label: "Costs by category",
              children: (
                <Table size="small" pagination={false} rowKey="category" dataSource={summary.byCategory}
                  columns={[{ title: "Category", dataIndex: "category" }, { title: `Net ${year}`, dataIndex: "amount", align: "right", render: (v: number) => <span className="tnum">{eur(v)}</span> }]} />
              ),
            },
          ]}
        />
      </Card>

      {/* The add/edit expense pop-up. It is open whenever `editing` is not null (`!!` makes true/false). The OK button
          calls `form.submit()`, which validates the `rules` and then calls `onFinish` with the field values `v`.
          `destroyOnHidden` throws away the form's inner state when closed. In onFinish we call the `saveExpense`
          server action with: all fields (`...v`), the `id` only when editing an existing row (`undefined` for new),
          and the date converted from a dayjs object to "YYYY-MM-DD" text. If the save worked (`res.ok`) the pop-up
          closes; `return res` hands the result to useAction so it can show the toast. */}
      <Modal open={!!editing} title={editing === "new" ? "New expense" : "Edit expense"} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical"
          onFinish={(v) => run(async () => {
            const res = await saveExpense({ ...v, id: editing !== "new" && editing ? editing.id : undefined, date: (v.date as dayjs.Dayjs).format("YYYY-MM-DD") });
            if (res.ok) setEditing(null);
            return res;
          })}>
          {/* Two fields per row (`span={12}` of 24). Each Form.Item's `name` is the key in `v`; `rules` with
              `required: true` blocks saving while empty. For the Checkbox, `valuePropName="checked"` tells the form
              to read its `checked` property instead of `value`. */}
          <Row gutter={12}>
            <Col span={12}><Form.Item name="date" label="Date" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="vendor" label="Vendor" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="category" label="Category" rules={[{ required: true }]}><Select options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="status" label="Status"><Select options={[{ value: "recorded", label: "Recorded" }, { value: "paid", label: "Paid" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="amountNet" label="Amount excl. VAT (€)" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="vatRate" label="VAT rate"><Select options={VAT_RATES.map((r) => ({ value: r, label: `${r}%` }))} /></Form.Item></Col>
            <Col span={24}><Form.Item name="description" label="Description"><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="receiptUrl" label="Receipt link (Drive)"><Input placeholder="https://drive.fundhub.lu/…" /></Form.Item></Col>
            <Col span={24}><Form.Item name="recurring" valuePropName="checked"><Checkbox>Monthly recurring cost</Checkbox></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </Space>
  );
}
