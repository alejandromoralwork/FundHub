"use client";

/**
 * FILE: apps/admin/src/components/ops-views.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Three "operations" screens of the Console:
 *   - `ReportsView`: upload PDF market reports for the website's Data Intelligence section, and list all reports
 *     (built-in live ones and uploaded ones) with buttons to switch public/private or delete.
 *   - `StaffView`: manage Console staff accounts: add people, change role, deactivate, reset password or 2FA.
 *   - `AuditView`: the audit log of every change staff made, newest first, with the details expandable.
 * WHERE IT RUNS: in the browser ("use client"): forms, pop-ups, switches and local state. Data is loaded by the
 *   server pages and passed in as props; every change goes through server actions in "@/lib/ops-actions".
 * FRAMEWORK NOTES:
 *   - `useRef` is a React hook that holds a reference to a real HTML element (here the upload <form>) so code can
 *     call its methods, e.g. `.reset()`. Unlike state, changing a ref does not redraw the screen.
 *   - A file upload uses a native HTML <form> and `FormData` (the browser's bundle of form fields, including the
 *     file) passed straight to a server action.
 *   - antd parts: Space.Compact (inputs glued together), Switch (on/off toggle), Modal + Form (pop-up form with
 *     `Form.useForm()` handle), Table `expandable` (rows that open to show more), Alert `closable`.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - object type aliases; unions like `string | null`; `Record<string, unknown> | null`.
 *   - generics `useRef<HTMLFormElement>(null)` and `useState<{ email: string; password: string } | null>`.
 *   - function-typed parameters `fn: () => Promise<{ ok?: string; … }>`; spread `[...a, ...b]`, `{ ...b, id: 0 }`;
 *     `new Set(list)` (removes duplicates); optional chaining `formRef.current?.reset()`.
 */

// `import { a } from "b"` brings named things from "b"; `import X from "b"` its default export.
// Plain names = npm libraries; `@fundhub/…` = our shared packages; `@/…` = this app's src; `./…` = this folder.
// React hooks: `useRef` (handle to the upload form) and `useState` (local values).
import { useRef, useState } from "react";
// Ant Design UI components.
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
// Icons: PDF file, plus sign, upload arrow.
import { FilePdfOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
// Date formatting library.
import dayjs from "dayjs";
// The allowed staff roles (owner, operations, analyst, sales), shared with the server's permission checks.
import { STAFF_ROLES } from "@fundhub/core/enums";
// Server actions for staff accounts and reports.
import { createStaff, deleteReport, setReportVisibility, updateStaff, uploadReport } from "@/lib/ops-actions";
// Hook: run a server action, show a toast, refresh the page data.
import { useAction } from "./use-action";

/** Kind: arrow function. Formats date text as "18 Oct 2026 14:05", or "—" for `null` (e.g. never logged in). */
const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");

// ---------------------------------------------------------------- reports

/**
 * Kind: type alias. An uploaded PDF report: `slug` (its URL name), title, period (e.g. "Q4 2026"), short summary,
 * `visibility` ("public" or "private"), `fileSize` in bytes and upload date.
 */
export type ReportRow = { id: number; slug: string; title: string; period: string; summary: string; visibility: string; fileSize: number; createdAt: string };
/** Kind: type alias. A built-in report that the website generates live from data (no uploaded file). */
export type BuiltIn = { slug: string; title: string; visibility: string };

/**
 * Kind: React component.
 * @param uploaded    type `ReportRow[]` — reports uploaded as PDFs.
 * @param builtIn     type `BuiltIn[]` — the always-present, live-generated reports.
 * @param websiteUrl  type `string` — public website address, used to link to each report page.
 * @returns JSX: an upload card and a table of all reports.
 */
export function ReportsView({ uploaded, builtIn, websiteUrl }: { uploaded: ReportRow[]; builtIn: BuiltIn[]; websiteUrl: string }) {
  const { run, pending } = useAction();
  // A handle to the <form> element below; starts as `null` until React has drawn the form.
  const formRef = useRef<HTMLFormElement>(null);
  // The chosen visibility for the next upload; antd's Select is not a native input, so we keep it in state.
  const [visibility, setVisibility] = useState("private");

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="Upload a PDF report">
        {/* Native form: the file goes straight to the server action as FormData. */}
        <form
          ref={formRef}
          onSubmit={(e) => {
            // Stop the browser's own page-reloading submit; we send the data ourselves instead.
            e.preventDefault();
            // Collect every named field of this form (title, period, summary, file) into a FormData bundle.
            const fd = new FormData(e.currentTarget);
            // Add the visibility from state, since the antd Select has no `name` field in the form.
            fd.set("visibility", visibility);
            // Call the upload server action; on success clear the form (`?.` = only if the form exists).
            // Returning `res` lets useAction show the success/error toast.
            run(async () => {
              const res = await uploadReport(fd);
              if (res.ok) formRef.current?.reset();
              return res;
            });
          }}
        >
          <Space direction="vertical" style={{ width: "100%", maxWidth: 640 }}>
            <Space.Compact block>
              <Input name="title" placeholder="Title, e.g. Depositary Fees Deep-Dive" required />
              <Input name="period" placeholder="Period, e.g. Q4 2026" style={{ maxWidth: 160 }} required />
            </Space.Compact>
            <Input.TextArea name="summary" rows={2} placeholder="Short summary shown on the website" />
            <Space wrap>
              <Select value={visibility} onChange={setVisibility} style={{ width: 300 }}
                options={[{ value: "public", label: "Public: anyone can download" }, { value: "private", label: "Private: approved provider accounts" }]} />
              {/* A plain browser file picker limited to PDFs (`accept`). */}
              <input type="file" name="file" accept="application/pdf" required />
              <Button type="primary" htmlType="submit" icon={<UploadOutlined />} loading={pending}>Upload (max 4 MB)</Button>
            </Space>
          </Space>
        </form>
      </Card>
      {/* One table for both kinds of report. `dataSource` joins two arrays with spread (`[...a, ...b]`): built-in
          reports get filler values (id 0, no file, "Generated live") so they have the same shape as uploaded ones.
          The last column only shows buttons for uploaded reports (`r.id ? … : null`, as built-ins have id 0):
          toggle public/private, or delete after confirmation. Size is shown in KB (bytes / 1024). */}
      <Card title="Reports on the website">
        <Table
          size="small"
          rowKey="slug"
          pagination={false}
          dataSource={[
            ...builtIn.map((b) => ({ ...b, id: 0, kind: "Generated live", period: "current quarter", fileSize: 0, createdAt: null })),
            ...uploaded.map((u) => ({ ...u, kind: "Uploaded" })),
          ]}
          columns={[
            { title: "Title", render: (_, r) => <a href={`${websiteUrl}/data-intelligence/reports/${r.slug}`} target="_blank" rel="noreferrer"><FilePdfOutlined /> {r.title}</a> },
            { title: "Period", dataIndex: "period" },
            { title: "Type", dataIndex: "kind", render: (k: string) => <Tag>{k}</Tag> },
            { title: "Visibility", dataIndex: "visibility", render: (v: string) => <Tag color={v === "public" ? "green" : "geekblue"}>{v}</Tag> },
            { title: "Size", dataIndex: "fileSize", render: (n: number) => (n ? `${Math.round(n / 1024)} KB` : "—") },
            {
              title: "",
              render: (_, r) =>
                r.id ? (
                  <Space>
                    <Button size="small" onClick={() => run(() => setReportVisibility(r.id, r.visibility === "public" ? "private" : "public"))}>
                      Make {r.visibility === "public" ? "private" : "public"}
                    </Button>
                    <Popconfirm title="Delete this report?" onConfirm={() => run(() => deleteReport(r.id))}>
                      <Button size="small" danger>Delete</Button>
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>
    </Space>
  );
}

// ---------------------------------------------------------------- staff

/**
 * Kind: type alias. One staff account: role, whether two-factor (TOTP = time-based one-time password) is set up,
 * whether the account is active, and the last login time (`null` = never).
 */
export type StaffRow = { id: number; email: string; name: string; role: string; totpEnabled: boolean; active: boolean; lastLoginAt: string | null };

/**
 * Kind: React component.
 * @param staff  type `StaffRow[]` — all staff accounts.
 * @param meId   type `number` — id of the staff member viewing the page; their own role and active switch are
 *               disabled so nobody can lock themselves out or demote themselves by accident.
 * @returns JSX: a card with a one-time password banner (when relevant), a roles legend, the staff table and an
 *          "add staff member" pop-up.
 */
export function StaffView({ staff, meId }: { staff: StaffRow[]; meId: number }) {
  const { run, pending } = useAction();
  // Whether the "Add staff member" pop-up is open.
  const [open, setOpen] = useState(false);
  // A freshly generated temporary password to show once, with whose it is; `null` when nothing to show.
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  // Handle to the add-staff form (to submit and clear it from code).
  const [form] = Form.useForm();

  /**
   * Kind: arrow function.
   * Like `run`, but for actions that may return a new temporary password in `res.secret` (creating a user or
   * resetting a password). If one comes back, it is stored so the green banner shows it.
   * @param email  type `string` — whose password it is (shown in the banner).
   * @param fn     a function returning a Promise of `{ ok?, error?, secret? }` — the server action call.
   */
  const withSecret = (email: string, fn: () => Promise<{ ok?: string; error?: string; secret?: string }>) =>
    run(async () => {
      const res = await fn();
      if (res.secret) setSecret({ email, password: res.secret });
      return res;
    });

  // The "Add staff member" button sits in the Card's top-right `extra` slot and opens the pop-up.
  return (
    <Card title="Staff" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add staff member</Button>}>
      {/* The temporary password banner: closable (closing clears `secret`), with a copy button on the password.
          `<>…</>` is a fragment that groups text and an element without an extra HTML wrapper. */}
      {secret && (
        <Alert closable onClose={() => setSecret(null)} type="success" showIcon style={{ marginBottom: 16 }}
          message={<>Temporary password for {secret.email}: <Typography.Text code copyable>{secret.password}</Typography.Text></>}
          description="Shown once. Share it through a secure channel; they set up two-factor at first login." />
      )}
      <Typography.Paragraph type="secondary">
        Roles: <b>owner</b> everything · <b>operations</b> moderation, data, email, pipeline · <b>analyst</b> read data, SQL, pipeline · <b>sales</b> email, billing.
      </Typography.Paragraph>
      {/* Staff table. Changing the Role dropdown or the Active switch immediately calls the `updateStaff` server
          action with just the changed field (`{ role }` is shorthand for `{ role: role }`). Both are disabled on
          your own row (`s.id === meId`). The last column resets a password (new temporary one shown via
          withSecret) or resets 2FA, each after confirmation. */}
      <Table<StaffRow> size="small" rowKey="id" dataSource={staff} pagination={false}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Email", dataIndex: "email" },
          { title: "Role", render: (_, s) => <Select size="small" value={s.role} style={{ width: 130 }} disabled={s.id === meId} onChange={(role) => run(() => updateStaff(s.id, { role }))} options={STAFF_ROLES.map((r) => ({ value: r, label: r }))} /> },
          { title: "2FA", dataIndex: "totpEnabled", render: (v: boolean) => (v ? <Tag color="green">enabled</Tag> : <Tag color="orange">pending</Tag>) },
          { title: "Active", render: (_, s) => <Switch size="small" checked={s.active} disabled={s.id === meId} onChange={(active) => run(() => updateStaff(s.id, { active }))} /> },
          { title: "Last login", dataIndex: "lastLoginAt", render: fmt },
          {
            title: "",
            render: (_, s) => (
              <Space>
                <Popconfirm title="Reset password and sign them out?" onConfirm={() => withSecret(s.email, () => updateStaff(s.id, { resetPassword: true }))}>
                  <Button size="small">Reset password</Button>
                </Popconfirm>
                <Popconfirm title="Reset 2FA? They'll enrol again at next login." onConfirm={() => run(() => updateStaff(s.id, { resetMfa: true }))}>
                  <Button size="small">Reset 2FA</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {/* Add-staff pop-up. OK submits the form; after validation `onFinish(v)` calls `createStaff(v)` through
          withSecret (so the new person's temporary password is shown), then closes and clears the form on success.
          The email field's rule `type: "email"` also checks it looks like an email address. */}
      <Modal open={open} title="Add staff member" onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={pending} destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ role: "operations" }}
          onFinish={(v) => withSecret(v.email, async () => {
            const res = await createStaff(v);
            if (res.ok) { setOpen(false); form.resetFields(); }
            return res;
          })}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}><Input /></Form.Item>
          <Form.Item name="role" label="Role"><Select options={STAFF_ROLES.map((r) => ({ value: r, label: r }))} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------- audit

/**
 * Kind: type alias. One audit-log entry: what was done (`action`), to which kind of record (`entity`) and which
 * one (`entityId`), the details (`changes`, any JSON-like object, or `null`), who did it and when.
 */
export type AuditRow = { id: number; action: string; entity: string; entityId: string | null; changes: Record<string, unknown> | null; staffName: string | null; createdAt: string };

/**
 * Kind: React component.
 * @param rows  type `AuditRow[]` — audit entries, newest first.
 * @returns JSX: a filterable table; rows with details expand to show them as formatted JSON.
 */
export function AuditView({ rows }: { rows: AuditRow[] }) {
  // `JSON.stringify(value, null, 2)` turns the details object into readable text indented by 2 spaces.
  // `rowExpandable` hides the expand arrow when there are no details (`!!` = to true/false).
  // Column filters: `new Set(list)` keeps each distinct action/entity once; `[...set]` turns it back into an
  // array, and `.map` makes a `{ text, value }` filter option for each. `onFilter` keeps rows that match.
  return (
    <Card title="Audit log" extra={<Typography.Text type="secondary">Every staff write, newest first</Typography.Text>}>
      <Table<AuditRow> size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 50 }}
        expandable={{ expandedRowRender: (r) => <pre className="mono" style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(r.changes, null, 2)}</pre>, rowExpandable: (r) => !!r.changes }}
        columns={[
          { title: "When", dataIndex: "createdAt", render: fmt, width: 160 },
          { title: "Staff", dataIndex: "staffName" },
          { title: "Action", dataIndex: "action", render: (a: string) => <Tag>{a}</Tag>, filters: [...new Set(rows.map((r) => r.action))].map((a) => ({ text: a, value: a })), onFilter: (v, r) => r.action === v },
          { title: "Entity", render: (_, r) => <span className="mono">{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</span>, filters: [...new Set(rows.map((r) => r.entity))].map((e) => ({ text: e, value: e })), onFilter: (v, r) => r.entity === v },
        ]}
      />
    </Card>
  );
}
