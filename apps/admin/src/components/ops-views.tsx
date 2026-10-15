"use client";

import { useRef, useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { FilePdfOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { STAFF_ROLES } from "@fundhub/core/enums";
import { createStaff, deleteReport, setReportVisibility, updateStaff, uploadReport } from "@/lib/ops-actions";
import { useAction } from "./use-action";

const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");

// ---------------------------------------------------------------- reports

export type ReportRow = { id: number; slug: string; title: string; period: string; summary: string; visibility: string; fileSize: number; createdAt: string };
export type BuiltIn = { slug: string; title: string; visibility: string };

export function ReportsView({ uploaded, builtIn, websiteUrl }: { uploaded: ReportRow[]; builtIn: BuiltIn[]; websiteUrl: string }) {
  const { run, pending } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [visibility, setVisibility] = useState("private");

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title="Upload a PDF report">
        {/* Native form: the file goes straight to the server action as FormData. */}
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("visibility", visibility);
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
              <input type="file" name="file" accept="application/pdf" required />
              <Button type="primary" htmlType="submit" icon={<UploadOutlined />} loading={pending}>Upload (max 4 MB)</Button>
            </Space>
          </Space>
        </form>
      </Card>
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

export type StaffRow = { id: number; email: string; name: string; role: string; totpEnabled: boolean; active: boolean; lastLoginAt: string | null };

export function StaffView({ staff, meId }: { staff: StaffRow[]; meId: number }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [form] = Form.useForm();

  const withSecret = (email: string, fn: () => Promise<{ ok?: string; error?: string; secret?: string }>) =>
    run(async () => {
      const res = await fn();
      if (res.secret) setSecret({ email, password: res.secret });
      return res;
    });

  return (
    <Card title="Staff" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add staff member</Button>}>
      {secret && (
        <Alert closable onClose={() => setSecret(null)} type="success" showIcon style={{ marginBottom: 16 }}
          message={<>Temporary password for {secret.email}: <Typography.Text code copyable>{secret.password}</Typography.Text></>}
          description="Shown once. Share it through a secure channel; they set up two-factor at first login." />
      )}
      <Typography.Paragraph type="secondary">
        Roles: <b>owner</b> everything · <b>operations</b> moderation, data, email, pipeline · <b>analyst</b> read data, SQL, pipeline · <b>sales</b> email, billing.
      </Typography.Paragraph>
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

export type AuditRow = { id: number; action: string; entity: string; entityId: string | null; changes: Record<string, unknown> | null; staffName: string | null; createdAt: string };

export function AuditView({ rows }: { rows: AuditRow[] }) {
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
