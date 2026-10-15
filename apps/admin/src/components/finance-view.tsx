"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { EXPENSE_CATEGORIES, VAT_RATES } from "@fundhub/core/enums";
import { copyRecurring, deleteExpense, exportCsv, saveBudget, saveExpense } from "@/lib/finance-actions";
import type { getFinanceSummary } from "@/lib/finance";
import { downloadText } from "./download";
import { useAction } from "./use-action";

type Summary = Awaited<ReturnType<typeof getFinanceSummary>>;
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

const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const eur0 = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

const download = (name: string, csv: string) => downloadText(name, csv, "text/csv");

export function FinanceView({ year, summary, expenseRows, driveUrl }: { year: number; summary: Summary; expenseRows: ExpenseRow[]; driveUrl: string | null }) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<ExpenseRow | "new" | null>(null);
  const [form] = Form.useForm();
  const revenue = summary.monthly.reduce((s, m) => s + m.revenue, 0);
  const costs = summary.monthly.reduce((s, m) => s + m.costs, 0);
  const month = dayjs().format("YYYY-MM");
  const spentThisMonth = (cat: string) => expenseRows.filter((e) => e.category === cat && e.date.startsWith(month)).reduce((s, e) => s + e.amountNet, 0);
  const budgetFor = (cat: string) => summary.budgets.find((b) => b.month === month && b.category === cat)?.amount ?? 0;

  const openEditor = (row: ExpenseRow | "new") => {
    setEditing(row);
    form.setFieldsValue(
      row === "new"
        ? { date: dayjs(), vatRate: 17, category: "Software & SaaS", status: "recorded", recurring: false }
        : { ...row, date: dayjs(row.date), amountNet: row.amountNet / 100 },
    );
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space wrap size="large" align="center">
        <Select value={year} onChange={(y) => (window.location.search = `?year=${y}`)} options={[0, 1, 2].map((d) => ({ value: dayjs().year() - d, label: String(dayjs().year() - d) }))} />
        <Card size="small"><Statistic title={`Revenue ${year} (net, paid)`} value={eur0(revenue)} /></Card>
        <Card size="small"><Statistic title={`Costs ${year} (net)`} value={eur0(costs)} /></Card>
        <Card size="small"><Statistic title="Result" value={eur0(revenue - costs)} valueStyle={{ color: revenue - costs < 0 ? "#b91c1c" : "#0c8265" }} /></Card>
        <Card size="small"><Statistic title="MRR (Pro)" value={eur0(summary.mrr)} /></Card>
        <Card size="small"><Statistic title="Outstanding invoices" value={eur0(summary.outstanding)} /></Card>
      </Space>

      <Card
        title="Profit & loss"
        extra={
          <Space>
            <Button icon={<DownloadOutlined />} onClick={async () => download(`fundhub-revenue-${year}.csv`, await exportCsv("revenue", year))}>Revenue CSV</Button>
            <Button icon={<DownloadOutlined />} onClick={async () => download(`fundhub-expenses-${year}.csv`, await exportCsv("expenses", year))}>Expenses CSV</Button>
          </Space>
        }
      >
        <Row gutter={16}>
          <Col xs={24} lg={14}>
            <Typography.Text type="secondary">Monthly result (revenue minus costs)</Typography.Text>
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

      <Card>
        <Tabs
          items={[
            {
              key: "expenses",
              label: `Expenses (${expenseRows.length})`,
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor("new")}>Add expense</Button>
                    <Button icon={<SyncOutlined />} loading={pending} onClick={() => run(() => copyRecurring())}>Copy recurring into this month</Button>
                    {driveUrl && <a href={driveUrl} target="_blank" rel="noreferrer"><Button>Open receipts in Drive</Button></a>}
                  </Space>
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

      <Modal open={!!editing} title={editing === "new" ? "New expense" : "Edit expense"} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical"
          onFinish={(v) => run(async () => {
            const res = await saveExpense({ ...v, id: editing !== "new" && editing ? editing.id : undefined, date: (v.date as dayjs.Dayjs).format("YYYY-MM-DD") });
            if (res.ok) setEditing(null);
            return res;
          })}>
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
