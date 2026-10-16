"use client";

import { useState } from "react";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { FilePdfOutlined, LinkOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { PRO_TIERS } from "@fundhub/core/enums";
import { createCustomer, createInvoice, createSubscription, sendInvoiceReminder, syncFromStripe } from "@/lib/billing-actions";
import { useAction } from "./use-action";

const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY") : "—");
const TIER_LABEL: Record<string, string> = { boutique: "Pro · Boutique", mid_market: "Pro · Mid-Market", institutional: "Pro · Institutional", data_member: "Data Intelligence member" };
const SUB_COLOR: Record<string, string> = { active: "green", trialing: "blue", past_due: "orange", unpaid: "red", canceled: "default", incomplete: "orange" };
const INV_COLOR: Record<string, string> = { paid: "green", open: "orange", draft: "default", void: "default", uncollectible: "red" };

export type CustomerRow = { id: number; stripeCustomerId: string; name: string; email: string; vatNumber: string | null; providerName: string | null; createdAt: string };
export type SubRow = { id: number; stripeSubscriptionId: string; customerName: string; tier: string | null; status: string; amount: number; interval: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
export type InvoiceRow = { id: number; number: string | null; customerName: string; description: string | null; status: string; amountDue: number; amountPaid: number; hostedInvoiceUrl: string | null; invoicePdf: string | null; dueDate: string | null; createdAt: string };

export function BillingView({
  configured,
  pricesConfigured,
  customers,
  subs,
  invoices,
  providers,
  stripeMode,
}: {
  configured: boolean;
  pricesConfigured: Record<string, boolean>;
  customers: CustomerRow[];
  subs: SubRow[];
  invoices: InvoiceRow[];
  providers: { id: number; name: string }[];
  stripeMode: "test" | "live" | null;
}) {
  const { run, pending } = useAction();
  const [modal, setModal] = useState<"customer" | "subscription" | "invoice" | null>(null);
  const [form] = Form.useForm();
  const customerOptions = customers.map((c) => ({ value: c.id, label: `${c.name} (${c.email})` }));
  const mrr = subs.filter((s) => ["active", "trialing", "past_due"].includes(s.status)).reduce((sum, s) => sum + (s.interval === "quarter" ? s.amount / 3 : s.interval === "year" ? s.amount / 12 : s.amount), 0);
  const outstanding = invoices.filter((i) => i.status === "open").reduce((sum, i) => sum + i.amountDue - i.amountPaid, 0);

  const submit = (fn: (v: Record<string, unknown>) => Promise<{ ok?: string; error?: string }>) => (v: Record<string, unknown>) =>
    run(async () => {
      const res = await fn(v);
      if (res.ok) {
        setModal(null);
        form.resetFields();
      }
      return res;
    });

  if (!configured) {
    return (
      <Card title="Billing & invoices">
        <Alert
          type="info"
          showIcon
          message="Connect Stripe to start invoicing"
          description={
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Create a Stripe account (EU entity) and enable Stripe Tax for Luxembourg VAT.</li>
              <li>Create a product “FundHub Pro” with three prices billed every 3 months: Boutique, Mid-Market, Institutional.</li>
              <li>Set STRIPE_SECRET_KEY, STRIPE_PRICE_BOUTIQUE, STRIPE_PRICE_MID_MARKET, STRIPE_PRICE_INSTITUTIONAL (and STRIPE_TAX=on) on the admin project.</li>
              <li>Add a webhook to https://fundhub.lu/admin/api/webhooks/stripe for customer.subscription.* and invoice.* events, and set STRIPE_WEBHOOK_SECRET.</li>
            </ol>
          }
        />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Space wrap size="large">
        <Card size="small"><Statistic title="MRR (Pro)" value={eur(mrr)} /></Card>
        <Card size="small"><Statistic title="Outstanding invoices" value={eur(outstanding)} valueStyle={{ color: outstanding ? "#b45309" : undefined }} /></Card>
        <Card size="small"><Statistic title="Customers" value={customers.length} /></Card>
        {stripeMode && <Tag color={stripeMode === "live" ? "red" : "blue"}>Stripe {stripeMode} mode</Tag>}
      </Space>

      <Card
        title="Billing & invoices"
        extra={
          <Space>
            <Button icon={<SyncOutlined />} loading={pending} onClick={() => run(() => syncFromStripe())}>Sync from Stripe</Button>
            <Button icon={<PlusOutlined />} onClick={() => setModal("customer")}>Customer</Button>
            <Button icon={<PlusOutlined />} onClick={() => setModal("subscription")} disabled={!customers.length}>Pro subscription</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal("invoice")} disabled={!customers.length}>Advisory invoice</Button>
          </Space>
        }
      >
        <Tabs
          items={[
            {
              key: "invoices",
              label: `Invoices (${invoices.length})`,
              children: (
                <Table<InvoiceRow> size="small" rowKey="id" dataSource={invoices} pagination={{ pageSize: 20 }}
                  columns={[
                    { title: "Number", dataIndex: "number", render: (n: string | null) => <span className="mono">{n ?? "draft"}</span> },
                    { title: "Customer", dataIndex: "customerName" },
                    { title: "Description", dataIndex: "description", ellipsis: true },
                    { title: "Amount", align: "right", render: (_, i) => <span className="tnum">{eur(i.amountDue)}</span> },
                    { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={INV_COLOR[s]}>{s}</Tag> },
                    { title: "Due", dataIndex: "dueDate", render: fmt },
                    {
                      title: "",
                      render: (_, i) => (
                        <Space>
                          {i.hostedInvoiceUrl && <a href={i.hostedInvoiceUrl} target="_blank" rel="noreferrer"><LinkOutlined /></a>}
                          {i.invoicePdf && <a href={i.invoicePdf} target="_blank" rel="noreferrer"><FilePdfOutlined /></a>}
                          {i.status === "open" && <Button size="small" onClick={() => run(() => sendInvoiceReminder(i.id))}>Remind</Button>}
                        </Space>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: "subs",
              label: `Subscriptions (${subs.length})`,
              children: (
                <Table<SubRow> size="small" rowKey="id" dataSource={subs}
                  columns={[
                    { title: "Customer", dataIndex: "customerName" },
                    { title: "Plan", dataIndex: "tier", render: (t: string | null) => (t ? TIER_LABEL[t] : "Custom") },
                    { title: "Amount", align: "right", render: (_, s) => <span className="tnum">{eur(s.amount)} / {s.interval}</span> },
                    { title: "Status", dataIndex: "status", render: (s: string, r) => <Space><Tag color={SUB_COLOR[s]}>{s}</Tag>{r.cancelAtPeriodEnd && <Tag>cancels at period end</Tag>}</Space> },
                    { title: "Renews", dataIndex: "currentPeriodEnd", render: fmt },
                  ]}
                />
              ),
            },
            {
              key: "customers",
              label: `Customers (${customers.length})`,
              children: (
                <Table<CustomerRow> size="small" rowKey="id" dataSource={customers}
                  columns={[
                    { title: "Name", dataIndex: "name" },
                    { title: "Billing email", dataIndex: "email" },
                    { title: "Provider", dataIndex: "providerName", render: (n: string | null) => n ?? "—" },
                    { title: "VAT", dataIndex: "vatNumber", render: (v: string | null) => v ?? "—" },
                    { title: "Stripe", dataIndex: "stripeCustomerId", render: (id: string) => <span className="mono">{id}</span> },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal open={modal === "customer"} title="New billing customer" onCancel={() => setModal(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit(createCustomer)}>
          <Form.Item name="providerId" label="Provider (optional)">
            <Select allowClear showSearch optionFilterProp="label" options={providers.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => { const p = providers.find((x) => x.id === id); if (p) form.setFieldValue("name", p.name); }} />
          </Form.Item>
          <Form.Item name="name" label="Legal name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Billing email" rules={[{ required: true, type: "email" }]}><Input /></Form.Item>
          <Form.Item name="vatNumber" label="EU VAT number (optional)" extra="e.g. LU12345678"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal open={modal === "subscription"} title="New Pro subscription (billed quarterly)" onCancel={() => setModal(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit(createSubscription)}>
          <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={customerOptions} /></Form.Item>
          <Form.Item name="tier" label="Tier" rules={[{ required: true }]}>
            <Select options={PRO_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t], disabled: !pricesConfigured[t] }))} />
          </Form.Item>
          <Typography.Text type="secondary">Stripe emails a quarterly invoice payable within 30 days.</Typography.Text>
        </Form>
      </Modal>

      <Modal open={modal === "invoice"} title="New advisory invoice" onCancel={() => setModal(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ daysUntilDue: 30 }} onFinish={submit(createInvoice)}>
          <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={customerOptions} /></Form.Item>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="e.g. Independent fee audit, RAIF administration proposals (flat fee)" />
          </Form.Item>
          <Space>
            <Form.Item name="amount" label="Amount (EUR, excl. VAT)" rules={[{ required: true }]}><InputNumber min={1} style={{ width: 180 }} /></Form.Item>
            <Form.Item name="daysUntilDue" label="Payment terms (days)"><InputNumber min={1} max={120} /></Form.Item>
          </Space>
          <Typography.Text type="secondary">The invoice is finalized and emailed by Stripe with a payment link.</Typography.Text>
        </Form>
      </Modal>
    </Space>
  );
}
