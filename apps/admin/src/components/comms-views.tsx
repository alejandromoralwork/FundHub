"use client";
/**
 * FILE: apps/admin/src/components/comms-views.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Two Console screens for communication.
 *   1. `InboxView` — every form sent from the website (quote requests, advisory, data, awards, provider
 *      contact). Staff filter the list, open one in a side panel, change its status, assign it to themselves,
 *      push it to the CRM, keep internal notes and reply by email.
 *   2. `EmailView` — write and send an email to one person or to a whole "segment" (a group of users), and
 *      see the log of every email sent with its delivery status.
 * WHERE IT RUNS: in the browser (`"use client"`), because of clickable buttons, a side drawer, typed text and
 *   other state. Saving, sending and counting happen on the server via server actions in
 *   `@/lib/email-actions`.
 * FRAMEWORK NOTES:
 *   - React component = function returning JSX; "props" are its inputs; `useState` remembers values between
 *     redraws (changing one with its setter redraws the component).
 *   - Ant Design (antd): `Table` (rows + column definitions), `Drawer` (panel sliding in from the side),
 *     `Descriptions` (a label/value list), `Form` (fields + validation, `onFinish` gets the values),
 *     `Radio.Group`, `Select` (drop-down), `Badge` (coloured dot with text), `Tag`, `Space`, `Card`.
 *   - Server actions: async functions that run on the server; the browser calls them like normal functions.
 *     Our `useAction` hook runs them, shows a green/red pop-up message and refreshes the page data.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - exported type aliases for table rows; `string[]` = array of text; `string | null`; optional `type?: string`;
 *   - `Record<K, V>` lookup tables, including one whose values must be one of a few exact strings;
 *   - generics `useState<RequestRow | null>(null)`, `Table<RequestRow>`;
 *   - arrow functions, async/await, `!!x` (turn any value into true/false), `??`, `?.`, `&&`, ternaries,
 *     spread `{ ...open, status }`, destructuring `([value, label]) => …`, template strings.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@fundhub/…` = our shared packages; `@/…` = this app's src folder; `./…` = same folder.

// React hook for remembering values (which request is open, typed notes, etc.).
import { useState } from "react";
// antd UI components (see FRAMEWORK NOTES).
import { Alert, Badge, Button, Card, Descriptions, Drawer, Form, Input, Radio, Select, Space, Table, Tag, Typography } from "antd";
// Envelope icon for the "Send" buttons.
import { MailOutlined } from "@ant-design/icons";
// Date formatting library.
import dayjs from "dayjs";
// The allowed request statuses (open, in_progress, responded, closed), shared across the project.
import { RFI_STATUSES } from "@fundhub/core/enums";
// Server actions: compose/send an email, count a segment's recipients, reply to a request, send a request to
// the CRM, and update a request (status, owner, notes).
import { composeEmail, countSegment, replyToRequest, sendToCrm, updateRequest } from "@/lib/email-actions";
// `SEGMENTS`: the list of recipient groups (code → label); `Segment`: the type of a segment code.
import { SEGMENTS, type Segment } from "@/lib/segments";
// Our hook that runs a server action with feedback and a page refresh.
import { useAction } from "./use-action";

/**
 * Kind: constant holding an arrow function.
 * @param d  `string | null` — a timestamp as text, or null.
 * @returns  `string`, e.g. "3 Mar 2026 14:05" (24-hour clock), or "—" when there is no date.
 */
const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
/** Kind: constant lookup table. Human names for each type of website form (e.g. "rfi" → "Quote request"). */
const TYPE_LABEL: Record<string, string> = { rfi: "Quote request", advisory: "Advisory", data: "Data services", awards: "Awards", claim: "Provider contact" };
/** Kind: constant lookup table. Tag colour per request status: new ones orange, answered ones green. */
const STATUS_COLOR: Record<string, string> = { open: "orange", in_progress: "blue", responded: "green", closed: "default" };

// ---------------------------------------------------------------- inbox

/**
 * Kind: type alias (exported so the server page that loads the rows uses the same shape).
 * One website form submission, as shown in the inbox. Fields: database id, form type, who sent it (name,
 * email, company), fund details (structure and assets-under-management band), the services they ticked
 * (`string[]` = list of texts), their message, workflow status, staff-only notes, the CRM reference once
 * pushed (null before), the staff member it is assigned to (null = nobody), the provider it is about (if
 * any), and when it arrived.
 */
export type RequestRow = {
  id: number;
  requestType: string;
  contactName: string;
  email: string;
  company: string;
  fundStructure: string;
  aumBand: string;
  servicesNeeded: string[];
  message: string;
  status: string;
  internalNotes: string;
  crmRef: string | null;
  assignedName: string | null;
  providerName: string | null;
  createdAt: string;
};

/**
 * Kind: React component (exported; used by the Inbox page).
 * @param rows     `RequestRow[]` — the submissions to list (already filtered by the server).
 * @param filters  `{ type?: string; status?: string }` — the filters currently in the page URL; both optional
 *                 (`?`), so either may be missing.
 * @returns        JSX: a card with filter drop-downs, the table, and a side drawer for one request.
 */
export function InboxView({ rows, filters }: { rows: RequestRow[]; filters: { type?: string; status?: string } }) {
  // The request currently shown in the drawer, or `null` when the drawer is closed.
  const [open, setOpen] = useState<RequestRow | null>(null);
  // `run` calls a server action with feedback; `pending` is true while one is running.
  const { run, pending } = useAction();
  // The text typed in the "Internal notes" and "Reply by email" boxes. `useState("")` starts them empty.
  const [notes, setNotes] = useState("");
  const [reply, setReply] = useState("");

  /**
   * Kind: arrow function.
   * Changes one filter by editing the page address's query string (the part after "?", e.g. "?status=open").
   * @param k  `string` — the filter name ("type" or "status").
   * @param v  optional `string` — the new value; missing/undefined means "remove this filter".
   * Setting `window.location.search` makes the browser load the new address, so the server re-runs the page
   * with the new filters. (`window` is the browser's global object.)
   */
  const setFilter = (k: string, v?: string) => {
    // `URLSearchParams` is a built-in browser helper for reading/editing "?a=1&b=2" text.
    const qs = new URLSearchParams(window.location.search);
    if (v) qs.set(k, v);
    else qs.delete(k);
    window.location.search = qs.toString();
  };

  return (
    // The card's `extra` slot (top-right corner) holds the two filter drop-downs.
    <Card
      title="Inbox: form submissions"
      extra={
        <Space>
          {/* `allowClear` adds an × that clears the choice (giving `undefined`, which removes the filter).
              `Object.entries(TYPE_LABEL)` turns the lookup table into `[key, value]` pairs; the arrow
              function destructures each pair into `value` and `label` for the drop-down options. */}
          <Select allowClear placeholder="Type" style={{ width: 150 }} value={filters.type} onChange={(v) => setFilter("type", v)}
            options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select allowClear placeholder="Status" style={{ width: 140 }} value={filters.status} onChange={(v) => setFilter("status", v)}
            options={RFI_STATUSES.map((s) => ({ value: s, label: s }))} />
        </Space>
      }
    >
      {/* The list. `Table<RequestRow>` tells TypeScript the shape of a row; `rowKey="id"` gives React a unique
          key per row; 25 rows per page. */}
      <Table<RequestRow>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 25 }}

        columns={[
          // Each column: `title` = header, `dataIndex` = field to show, `render` = custom cell markup.
          { title: "Received", dataIndex: "createdAt", render: fmt, width: 150 },
          // `TYPE_LABEL[t] ?? t`: use the friendly name, or the raw code if the table has no entry.
          { title: "Type", dataIndex: "requestType", render: (t: string) => <Tag>{TYPE_LABEL[t] ?? t}</Tag> },
          { title: "From", render: (_, r) => <span>{r.contactName} <Typography.Text type="secondary">· {r.company}</Typography.Text></span> },
          // "About": the provider's name if the form was about one, otherwise the first two services
          // (`.slice(0, 2)` = items 0 and 1; `.join(", ")` glues them into one text).
          { title: "About", render: (_, r) => r.providerName ?? r.servicesNeeded.slice(0, 2).join(", ") },
          // `.replace("_", " ")` shows "in_progress" as "in progress".
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s.replace("_", " ")}</Tag> },
          { title: "Owner", dataIndex: "assignedName", render: (n: string | null) => n ?? <Typography.Text type="secondary">unassigned</Typography.Text> },
          {
            title: "",
            // "Open" puts this row into the drawer, loads its saved notes into the notes box, and empties
            // the reply box. Several statements in an arrow function need `{ …; …; }`.
            render: (_, r) => (
              <Button size="small" onClick={() => { setOpen(r); setNotes(r.internalNotes); setReply(""); }}>
                Open
              </Button>
            ),
          },
        ]}
      />
      {/* The side panel. `!!open` turns the row-or-null into true/false (visible or not). Closing sets it
          back to null. The title is e.g. "Quote request #42" (empty while closed). */}
      <Drawer open={!!open} onClose={() => setOpen(null)} width={560} title={open ? `${TYPE_LABEL[open.requestType]} #${open.id}` : ""}>
        {/* `open && (…)`: only draw the contents when a request is selected (so `open.…` is safe to read). */}
        {open && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            {/* A bordered, one-column label/value list of the request's details. */}
            <Descriptions size="small" column={1} bordered>
              {/* `mailto:` links open the user's email program. */}
              <Descriptions.Item label="Contact">{open.contactName} · <a href={`mailto:${open.email}`}>{open.email}</a></Descriptions.Item>
              <Descriptions.Item label="Company">{open.company}</Descriptions.Item>
              {/* Optional lines appear only when the form had that information. */}
              {open.fundStructure && <Descriptions.Item label="Fund">{open.fundStructure} · {open.aumBand}</Descriptions.Item>}
              {open.providerName && <Descriptions.Item label="Provider">{open.providerName}</Descriptions.Item>}
              {/* One tag per service. Items drawn from `.map` need a unique `key` so React can track them. */}
              <Descriptions.Item label="Interested in">{open.servicesNeeded.map((s) => <Tag key={s}>{s}</Tag>)}</Descriptions.Item>
              {/* `whiteSpace: "pre-wrap"` keeps the sender's line breaks. */}
              {open.message && <Descriptions.Item label="Message"><span style={{ whiteSpace: "pre-wrap" }}>{open.message}</span></Descriptions.Item>}
            </Descriptions>
            <Space wrap>
              {/* Changing the status saves it on the server, and also updates the local copy at once
                  (`{ ...open, status }` = a copy of the row with the new status) so the drawer shows it. */}
              <Select value={open.status} style={{ width: 160 }} onChange={(status) => { run(() => updateRequest({ id: open.id, status })); setOpen({ ...open, status }); }}
                options={RFI_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
              <Button onClick={() => run(() => updateRequest({ id: open.id, assignToMe: true }))}>Assign to me</Button>
              {/* Disabled once it already has a CRM reference, so it is not pushed twice. */}
              <Button disabled={!!open.crmRef} onClick={() => run(() => sendToCrm(open.id))}>{open.crmRef ? "In CRM" : "Send to CRM"}</Button>
            </Space>
            <div>
              <Typography.Text strong>Internal notes</Typography.Text>
              {/* A "controlled" text box: it shows the `notes` state, and every keystroke (`onChange`) stores
                  the new text (`e.target.value`) back into that state. */}
              <Input.TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Button size="small" style={{ marginTop: 6 }} onClick={() => run(() => updateRequest({ id: open.id, internalNotes: notes }))}>Save notes</Button>
            </div>
            <div>
              <Typography.Text strong>Reply by email</Typography.Text>
              <Input.TextArea rows={6} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Hi ${open.contactName}, thank you for your request…`} />
              {/* Sends the reply through a server action. The subject is built from the form type;
                  `?.toLowerCase()` only lower-cases if a label exists (optional chaining). If the send
                  succeeded, the reply box is emptied. Returning `res` lets `run` show the message. */}
              <Button type="primary" icon={<MailOutlined />} loading={pending} style={{ marginTop: 6 }}
                onClick={() => run(async () => {
                  const res = await replyToRequest({ id: open.id, subject: `Re: your FundHub ${TYPE_LABEL[open.requestType]?.toLowerCase()} request`, body: reply });
                  if (res.ok) setReply("");
                  return res;
                })}>
                Send reply
              </Button>
            </div>
          </Space>
        )}
      </Drawer>
    </Card>
  );
}

// ---------------------------------------------------------------- email

/**
 * Kind: type alias (exported). One line of the sent-email log: recipient address and optional name, subject,
 * which email template was used, delivery status (and error text if it failed), who sent it (null = sent
 * automatically by the system) and when.
 */
export type EmailRow = { id: number; toEmail: string; toName: string | null; subject: string; template: string; status: string; error: string | null; sentByName: string | null; createdAt: string };

/**
 * Kind: constant lookup table.
 * Maps each delivery status to one of antd `Badge`'s five dot styles. The value type is a union of exact
 * strings, so TypeScript rejects any value antd would not understand.
 */
const EMAIL_STATUS: Record<string, "success" | "processing" | "error" | "default" | "warning"> = {
  queued: "processing", sent: "success", delivered: "success", bounced: "error", complained: "warning", failed: "error",
};

/**
 * Kind: React component (exported; used by the Email page).
 * @param log               `EmailRow[]` — recently sent emails.
 * @param resendConfigured  `boolean` — is the Resend (email-sending service) key set? If not, emails are only
 *                          logged, and a warning says so.
 * @returns                 JSX: an optional warning, the compose form and the log table.
 */
export function EmailView({ log, resendConfigured }: { log: EmailRow[]; resendConfigured: boolean }) {
  const { run, pending } = useAction();
  // A form controller, so code can reset fields after sending.
  const [form] = Form.useForm();
  // Send to one person or to a segment; this choice switches which fields are shown.
  const [mode, setMode] = useState<"single" | "segment">("single");
  // How many people are in the chosen segment, or null before one is chosen.
  const [count, setCount] = useState<number | null>(null);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* Warning shown only when Resend is not configured (`!` = not). */}
      {!resendConfigured && (
        <Alert showIcon type="warning" message="RESEND_API_KEY is not set: emails are logged and printed to the server console instead of being sent." />
      )}
      <Card title="Compose">
        {/* On a valid submit, antd calls `onFinish` with all field values `v`. We add the current `mode`
            (spread copies `v`'s fields, then adds `mode`), call the `composeEmail` server action, and on
            success clear the text fields (the list names which ones) ready for the next email. */}
        <Form form={form} layout="vertical" initialValues={{ mode: "single" }}
          onFinish={(v) => run(async () => {
            const res = await composeEmail({ ...v, mode });
            if (res.ok) form.resetFields(["subject", "body", "ctaLabel", "ctaUrl", "to", "toName"]);
            return res;
          })}>
          <Form.Item label="Send to">
            {/* Two toggle buttons (`optionType="button"`). Picking one stores it in the `mode` state. */}
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} optionType="button"
              options={[{ value: "single", label: "One person" }, { value: "segment", label: "Segment" }]} />
          </Form.Item>
          {/* Ternary in JSX: one person → email + name fields; segment → a segment drop-down. */}
          {mode === "single" ? (
            // `Space.Compact block` joins the two inputs into one full-width group; `flex: 2` / `flex: 1`
            // make the email box twice as wide as the name box.
            <Space.Compact block>
              <Form.Item name="to" rules={[{ required: true, type: "email" }]} style={{ flex: 2 }}><Input placeholder="email@company.lu" /></Form.Item>
              <Form.Item name="toName" style={{ flex: 1 }}><Input placeholder="Name (optional)" /></Form.Item>
            </Space.Compact>
          ) : (
            // The hint under the drop-down shows the recipient count once it is known.
            <Form.Item name="segment" rules={[{ required: true }]} extra={count !== null ? `${count} recipient(s)` : undefined}>
              {/* When a segment is picked, ask the server (`countSegment` server action) how many people
                  are in it; `await` waits for the number, then it is stored in `count`. */}
              <Select placeholder="Choose a segment" options={Object.entries(SEGMENTS).map(([value, label]) => ({ value, label }))}
                onChange={async (s: Segment) => setCount(await countSegment(s))} />
            </Form.Item>
          )}
          <Form.Item name="subject" label="Subject" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="Message" rules={[{ required: true }]} extra="Blank lines start new paragraphs. Recipients' first names are added automatically.">
            <Input.TextArea rows={8} />
          </Form.Item>
          {/* Optional call-to-action button in the email: its label and the web address it links to. */}
          <Space.Compact block>
            <Form.Item name="ctaLabel" style={{ flex: 1 }}><Input placeholder="Button label (optional)" /></Form.Item>
            <Form.Item name="ctaUrl" style={{ flex: 2 }}><Input placeholder="https://fundhub.lu/…" /></Form.Item>
          </Space.Compact>
          {/* `htmlType="submit"` submits the antd Form, which validates then calls `onFinish`. */}
          <Button type="primary" htmlType="submit" loading={pending} icon={<MailOutlined />}>Send</Button>
        </Form>
      </Card>
      {/* The log. Resend (the email service) calls our webhook (a URL it notifies) when an email is
          delivered or bounces, which updates the statuses shown here. */}
      <Card title="Sent emails" extra={<Typography.Text type="secondary">Delivery status updates via the Resend webhook</Typography.Text>}>
        <Table<EmailRow>
          size="small" rowKey="id" dataSource={log} pagination={{ pageSize: 25 }}
          columns={[
            { title: "When", dataIndex: "createdAt", render: fmt, width: 150 },
            // Shows "Name <email>" when a name is known, otherwise just the email.
            { title: "To", render: (_, e) => e.toName ? `${e.toName} <${e.toEmail}>` : e.toEmail },
            { title: "Subject", dataIndex: "subject" },
            { title: "Template", dataIndex: "template", render: (t: string) => <Tag>{t}</Tag> },
            // A coloured dot plus the status word; hovering shows the error text if there is one
            // (`?? undefined` turns null into "no tooltip", which is what antd expects).
            { title: "Status", render: (_, e) => <Badge status={EMAIL_STATUS[e.status] ?? "default"} text={e.status} title={e.error ?? undefined} /> },
            { title: "By", dataIndex: "sentByName", render: (n: string | null) => n ?? <Typography.Text type="secondary">system</Typography.Text> },
          ]}
        />
      </Card>
    </Space>
  );
}
