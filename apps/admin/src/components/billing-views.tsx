"use client";
/**
 * FILE: apps/admin/src/components/billing-views.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's "Billing & invoices" screen. It shows headline numbers (monthly recurring
 *   revenue, money still owed, number of customers), three tabs listing invoices, Pro subscriptions and
 *   billing customers (all mirrored from Stripe, our payment provider), and pop-up forms to create a customer,
 *   a Pro subscription or a one-off advisory invoice. If Stripe is not set up yet it shows setup steps instead.
 * WHERE IT RUNS: in the browser (`"use client"`), because it has clickable buttons, pop-up dialogs and forms
 *   that keep state. Creating things in Stripe happens on the server through server actions in
 *   `@/lib/billing-actions`, which the buttons call.
 * FRAMEWORK NOTES:
 *   - React component = a function returning JSX (HTML-like markup); "props" are its inputs.
 *   - React "state" (`useState`) is a value the component remembers between redraws; changing it with the
 *     setter function makes React redraw the component.
 *   - Ant Design (antd) pieces used: `Table` (rows from `dataSource`, columns from a `columns` array), `Tabs`,
 *     `Modal` (pop-up dialog), `Form` (fields with validation; `onFinish` runs with the values when valid),
 *     `Statistic` (big number with a title), `Tag` (small coloured label), `Space` (lays children out with gaps).
 *   - Server actions: async functions that run on the server; calling them from the browser sends a network
 *     request behind the scenes. Our `useAction` hook wraps them to show a pop-up message and refresh the page.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - exported type aliases describing a table row (`export type CustomerRow = { … }`);
 *   - `string | null` (text or "no value"); string-literal unions `"test" | "live" | null`;
 *   - `Record<string, string>` = an object used as a lookup table from text keys to text values;
 *   - generics: `useState<…>(…)`, `Table<InvoiceRow>` (tells the table what one row looks like);
 *   - arrow functions, a function that returns a function (`submit`), `async/await`, `?? "—"` (nullish
 *     coalescing: use the right side when the left is null/undefined), `&&` to show something conditionally.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@fundhub/…` = our shared packages; `@/…` = this app's src folder; `./…` = same folder.

// `useState`: React hook for remembering a value (here: which pop-up is open).
import { useState } from "react";
// antd UI components used on this screen (see FRAMEWORK NOTES).
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
// Small icons from Ant Design's icon set: PDF file, link, plus sign, and the circular "sync" arrows.
import { FilePdfOutlined, LinkOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
// dayjs: a small date library used to format dates.
import dayjs from "dayjs";
// The list of Pro tier codes (e.g. "boutique"), defined once in our shared core package.
import { PRO_TIERS } from "@fundhub/core/enums";
// Server actions (they run on the server and talk to Stripe and our database).
import { createCustomer, createInvoice, createSubscription, sendInvoiceReminder, syncFromStripe } from "@/lib/billing-actions";
// Our custom hook: runs a server action, shows its success/error message and refreshes the page data.
import { useAction } from "./use-action";

/**
 * Kind: constant holding an arrow function.
 * @param cents  type `number` — an amount in euro cents (money is stored in whole cents to avoid rounding).
 * @returns      `string` like "€1,250.00": divided by 100 and always shown with exactly two decimals.
 */
const eur = (cents: number) => `€${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/**
 * Kind: constant holding an arrow function.
 * @param d  type `string | null` — a date as text, or `null` if there is none.
 * @returns  `string`: e.g. "3 Mar 2026", or a dash "—" when there is no date (ternary `d ? … : …`).
 */
const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY") : "—");
/** Kind: constant lookup table. Turns a tier code into the name staff see, e.g. "boutique" → "Pro · Boutique". */
const TIER_LABEL: Record<string, string> = { boutique: "Pro · Boutique", mid_market: "Pro · Mid-Market", institutional: "Pro · Institutional", data_member: "Data Intelligence member" };
/** Kind: constant lookup table. Tag colour for each Stripe subscription status (e.g. late payers are orange). */
const SUB_COLOR: Record<string, string> = { active: "green", trialing: "blue", past_due: "orange", unpaid: "red", canceled: "default", incomplete: "orange" };
/** Kind: constant lookup table. Tag colour for each Stripe invoice status. */
const INV_COLOR: Record<string, string> = { paid: "green", open: "orange", draft: "default", void: "default", uncollectible: "red" };

/**
 * Kind: type alias (exported so the server page that loads the data can use the same shape).
 * One billing customer: our row id, Stripe's customer id ("cus_…"), legal name, billing email, optional EU
 * VAT number, the linked provider's name if any, and when it was created (dates arrive as text).
 */
export type CustomerRow = { id: number; stripeCustomerId: string; name: string; email: string; vatNumber: string | null; providerName: string | null; createdAt: string };
/**
 * Kind: type alias. One subscription: Stripe's id ("sub_…"), customer, Pro tier (null = a custom plan),
 * Stripe status, price in cents, billing interval ("month", "quarter" or "year"), when the current period ends,
 * and whether the customer has asked to cancel when it ends.
 */
export type SubRow = { id: number; stripeSubscriptionId: string; customerName: string; tier: string | null; status: string; amount: number; interval: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean };
/**
 * Kind: type alias. One invoice: number (null while still a draft), customer, description, status, amount due
 * and amount paid (cents), Stripe's online payment page and PDF links, due date and creation date.
 */
export type InvoiceRow = { id: number; number: string | null; customerName: string; description: string | null; status: string; amountDue: number; amountPaid: number; hostedInvoiceUrl: string | null; invoicePdf: string | null; dueDate: string | null; createdAt: string };

/**
 * Kind: React component (exported; used by the Billing page).
 * Props (destructured from one object; their types are listed after the `:`):
 * @param configured        `boolean` — is a Stripe secret key set? If not, only setup steps are shown.
 * @param pricesConfigured  `Record<string, boolean>` — for each tier code, is its Stripe price id set?
 *                          Tiers without a price are greyed out in the subscription form.
 * @param customers         `CustomerRow[]` — array (`[]`) of billing customers.
 * @param subs              `SubRow[]` — subscriptions.
 * @param invoices          `InvoiceRow[]` — invoices.
 * @param providers         `{ id: number; name: string }[]` — providers to optionally link a customer to.
 * @param stripeMode        `"test" | "live" | null` — which Stripe mode the key belongs to, shown as a tag
 *                          so nobody mistakes test data for real money.
 * @returns                 JSX for the whole billing screen.
 */
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
  // Object destructuring: take `run` (call a server action with feedback) and `pending` (true while one is
  // running) from our `useAction` hook.
  const { run, pending } = useAction();
  // Which pop-up is open: one of three names, or `null` for none. `useState` returns [current value, setter].
  // The generic `<…>` lists the allowed values; `null` is the starting value.
  const [modal, setModal] = useState<"customer" | "subscription" | "invoice" | null>(null);
  // `Form.useForm()` creates a form "controller" that lets code submit or reset the form. One controller is
  // shared by all three pop-ups; only one is ever open at a time (and `destroyOnHidden` rebuilds it each time).
  const [form] = Form.useForm();
  // Options for the "Customer" drop-downs: `.map` turns each customer into `{ value, label }`, e.g.
  // label "Acme SA (billing@acme.lu)".
  const customerOptions = customers.map((c) => ({ value: c.id, label: `${c.name} (${c.email})` }));
  // MRR = Monthly Recurring Revenue. `.filter` keeps only subscriptions that still bring in money
  // (`.includes` checks the status is one of the three listed). `.reduce` then adds them up, starting from 0,
  // converting each price to a monthly figure: quarterly ÷ 3, yearly ÷ 12, otherwise (monthly) as is.
  // The nested ternary `a ? x : b ? y : z` reads as "if a then x, else if b then y, else z".
  const mrr = subs.filter((s) => ["active", "trialing", "past_due"].includes(s.status)).reduce((sum, s) => sum + (s.interval === "quarter" ? s.amount / 3 : s.interval === "year" ? s.amount / 12 : s.amount), 0);
  // Money still owed: for every "open" (unpaid) invoice, add what is due minus what has been paid already.
  const outstanding = invoices.filter((i) => i.status === "open").reduce((sum, i) => sum + i.amountDue - i.amountPaid, 0);

  /**
   * Kind: function that returns a function (a "factory").
   * @param fn  a server action taking the form's values (`Record<string, unknown>`) and returning
   *            `Promise<{ ok?: string; error?: string }>` (a result that arrives later).
   * @returns   a function suitable for antd's `onFinish`: given the values, it runs `fn` through `run`
   *            (which shows the message and refreshes). If it worked (`res.ok`), it closes the pop-up and
   *            clears the form. It returns `res` so `run` can show the message.
   * Written once so all three pop-up forms behave the same way: `submit(createCustomer)` etc.
   */
  const submit = (fn: (v: Record<string, unknown>) => Promise<{ ok?: string; error?: string }>) => (v: Record<string, unknown>) =>
    run(async () => {
      // `await` waits for the server's answer.
      const res = await fn(v);
      if (res.ok) {
        setModal(null);
        form.resetFields();
      }
      return res;
    });

  // Early return: if Stripe is not connected yet, show the setup checklist and nothing else.
  // (`!configured` means "not configured".)
  if (!configured) {
    return (
      <Card title="Billing & invoices">
        {/* An antd information box; its `description` prop can hold any JSX, here a numbered list (<ol>). */}
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
    // `Space direction="vertical"` stacks its children with large gaps, full width.
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* Headline numbers in a row (`wrap` lets them flow onto a new line on narrow screens). */}
      <Space wrap size="large">
        <Card size="small"><Statistic title="MRR (Pro)" value={eur(mrr)} /></Card>
        {/* Shown in amber when anything is owed; `undefined` means "use the normal colour". */}
        <Card size="small"><Statistic title="Outstanding invoices" value={eur(outstanding)} valueStyle={{ color: outstanding ? "#b45309" : undefined }} /></Card>
        <Card size="small"><Statistic title="Customers" value={customers.length} /></Card>
        {/* `a && <Tag>` shows the tag only when `stripeMode` has a value (not null). Live mode is red as
            a warning that real money is involved. */}
        {stripeMode && <Tag color={stripeMode === "live" ? "red" : "blue"}>Stripe {stripeMode} mode</Tag>}
      </Space>

      {/* The main card. `extra` is antd's slot for content in the top-right corner of the card: the buttons. */}
      <Card
        title="Billing & invoices"
        extra={
          <Space>
            {/* `onClick={() => …}` passes an arrow function that runs on click. Here it runs the
                `syncFromStripe` server action (copy the latest data from Stripe into our database). */}
            <Button icon={<SyncOutlined />} loading={pending} onClick={() => run(() => syncFromStripe())}>Sync from Stripe</Button>
            {/* These buttons only open a pop-up by setting the `modal` state. Subscriptions and invoices
                need a customer first, so they are disabled while the customer list is empty. */}
            <Button icon={<PlusOutlined />} onClick={() => setModal("customer")}>Customer</Button>
            <Button icon={<PlusOutlined />} onClick={() => setModal("subscription")} disabled={!customers.length}>Pro subscription</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal("invoice")} disabled={!customers.length}>Advisory invoice</Button>
          </Space>
        }
      >
        {/* antd `Tabs`: `items` is an array of tabs, each with a unique `key`, a `label` and its `children`
            (the content). Labels are template strings that include the row count. */}
        <Tabs
          items={[
            {
              key: "invoices",
              label: `Invoices (${invoices.length})`,
              children: (
                // `Table<InvoiceRow>` tells TypeScript each row is an InvoiceRow, so `render` functions
                // below know which fields exist. `pageSize: 20` shows 20 rows per page.
                <Table<InvoiceRow> size="small" rowKey="id" dataSource={invoices} pagination={{ pageSize: 20 }}
                  columns={[
                    // Each column: `title` = header, `dataIndex` = which field to show, and optional
                    // `render` = a function that turns the value into custom markup.
                    // Drafts have no number yet, so `n ?? "draft"` shows the word "draft" instead.
                    { title: "Number", dataIndex: "number", render: (n: string | null) => <span className="mono">{n ?? "draft"}</span> },
                    { title: "Customer", dataIndex: "customerName" },
                    // `ellipsis: true` cuts long text with "…" so the row stays on one line.
                    { title: "Description", dataIndex: "description", ellipsis: true },
                    // `render: (_, i)` gets the cell value (unused, `_`) and the whole row `i`.
                    // `className="tnum"` uses equal-width digits so amounts line up.
                    { title: "Amount", align: "right", render: (_, i) => <span className="tnum">{eur(i.amountDue)}</span> },
                    { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={INV_COLOR[s]}>{s}</Tag> },
                    // `render: fmt` passes the date formatter directly (no need to wrap it).
                    { title: "Due", dataIndex: "dueDate", render: fmt },
                    {
                      // An action column with no header: links and a reminder button.
                      title: "",
                      render: (_, i) => (
                        <Space>
                          {/* Each `x && <…>` shows the item only if the link exists / the invoice is open. */}
                          {i.hostedInvoiceUrl && <a href={i.hostedInvoiceUrl} target="_blank" rel="noreferrer"><LinkOutlined /></a>}
                          {i.invoicePdf && <a href={i.invoicePdf} target="_blank" rel="noreferrer"><FilePdfOutlined /></a>}
                          {/* "Remind" calls a server action that emails the customer a payment reminder. */}
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
                    // Look the tier up in TIER_LABEL; no tier means a custom (non-standard) plan.
                    { title: "Plan", dataIndex: "tier", render: (t: string | null) => (t ? TIER_LABEL[t] : "Custom") },
                    { title: "Amount", align: "right", render: (_, s) => <span className="tnum">{eur(s.amount)} / {s.interval}</span> },
                    // `render` also receives the row as `r`, so an extra tag can warn about a pending cancel.
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
                    // `n ?? "—"`: show a dash when the value is null.
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

      {/* Pop-up 1: new billing customer. `open` is true only when the `modal` state says "customer".
          Cancel closes it; OK triggers `form.submit()`, which validates the fields and, if valid, calls
          `onFinish`. `confirmLoading` spins the OK button while the server works. `destroyOnHidden` throws
          the contents away when closed, so the next opening starts clean. */}
      <Modal open={modal === "customer"} title="New billing customer" onCancel={() => setModal(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        {/* `onFinish={submit(createCustomer)}`: on a valid submit, send the values to the server action. */}
        <Form form={form} layout="vertical" onFinish={submit(createCustomer)}>
          {/* Each `Form.Item name="…"` is a field; the name becomes the key in the values sent to the server. */}
          <Form.Item name="providerId" label="Provider (optional)">
            {/* A searchable drop-down of providers (`allowClear` adds an × to empty it). When one is picked,
                `onChange` finds that provider (`.find` returns the first match or undefined) and copies its
                name into the "Legal name" field as a starting point. */}
            <Select allowClear showSearch optionFilterProp="label" options={providers.map((p) => ({ value: p.id, label: p.name }))}
              onChange={(id) => { const p = providers.find((x) => x.id === id); if (p) form.setFieldValue("name", p.name); }} />
          </Form.Item>
          {/* `rules` are antd's validation: `required` must be filled; `type: "email"` must look like an email. */}
          <Form.Item name="name" label="Legal name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Billing email" rules={[{ required: true, type: "email" }]}><Input /></Form.Item>
          <Form.Item name="vatNumber" label="EU VAT number (optional)" extra="e.g. LU12345678"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Pop-up 2: new Pro subscription for an existing customer. */}
      <Modal open={modal === "subscription"} title="New Pro subscription (billed quarterly)" onCancel={() => setModal(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit(createSubscription)}>
          <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={customerOptions} /></Form.Item>
          <Form.Item name="tier" label="Tier" rules={[{ required: true }]}>
            {/* One option per Pro tier; a tier is disabled if its Stripe price has not been configured. */}
            <Select options={PRO_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t], disabled: !pricesConfigured[t] }))} />
          </Form.Item>
          <Typography.Text type="secondary">Stripe emails a quarterly invoice payable within 30 days.</Typography.Text>
        </Form>
      </Modal>

      {/* Pop-up 3: a one-off advisory invoice. `initialValues` pre-fills payment terms with 30 days. */}
      <Modal open={modal === "invoice"} title="New advisory invoice" onCancel={() => setModal(null)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ daysUntilDue: 30 }} onFinish={submit(createInvoice)}>
          <Form.Item name="customerId" label="Customer" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={customerOptions} /></Form.Item>
          <Form.Item name="description" label="Description" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="e.g. Independent fee audit, RAIF administration proposals (flat fee)" />
          </Form.Item>
          {/* Two number fields side by side. The amount is typed in euros (the server converts to cents). */}
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
