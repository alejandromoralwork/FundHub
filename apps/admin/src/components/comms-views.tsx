"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, Descriptions, Drawer, Form, Input, Radio, Select, Space, Table, Tag, Typography } from "antd";
import { MailOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { RFI_STATUSES } from "@fundhub/core/enums";
import { composeEmail, countSegment, replyToRequest, updateRequest } from "@/lib/email-actions";
import { SEGMENTS, type Segment } from "@/lib/segments";
import { useAction } from "./use-action";

const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
const TYPE_LABEL: Record<string, string> = { rfi: "Quote request", advisory: "Advisory", data: "Data services", awards: "Awards", claim: "Provider contact" };
const STATUS_COLOR: Record<string, string> = { open: "orange", in_progress: "blue", responded: "green", closed: "default" };

// ---------------------------------------------------------------- inbox

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
  assignedName: string | null;
  providerName: string | null;
  createdAt: string;
};

export function InboxView({ rows, filters }: { rows: RequestRow[]; filters: { type?: string; status?: string } }) {
  const [open, setOpen] = useState<RequestRow | null>(null);
  const { run, pending } = useAction();
  const [notes, setNotes] = useState("");
  const [reply, setReply] = useState("");

  const setFilter = (k: string, v?: string) => {
    const qs = new URLSearchParams(window.location.search);
    if (v) qs.set(k, v);
    else qs.delete(k);
    window.location.search = qs.toString();
  };

  return (
    <Card
      title="Inbox: form submissions"
      extra={
        <Space>
          <Select allowClear placeholder="Type" style={{ width: 150 }} value={filters.type} onChange={(v) => setFilter("type", v)}
            options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select allowClear placeholder="Status" style={{ width: 140 }} value={filters.status} onChange={(v) => setFilter("status", v)}
            options={RFI_STATUSES.map((s) => ({ value: s, label: s }))} />
        </Space>
      }
    >
      <Table<RequestRow>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 25 }}

        columns={[
          { title: "Received", dataIndex: "createdAt", render: fmt, width: 150 },
          { title: "Type", dataIndex: "requestType", render: (t: string) => <Tag>{TYPE_LABEL[t] ?? t}</Tag> },
          { title: "From", render: (_, r) => <span>{r.contactName} <Typography.Text type="secondary">· {r.company}</Typography.Text></span> },
          { title: "About", render: (_, r) => r.providerName ?? r.servicesNeeded.slice(0, 2).join(", ") },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s.replace("_", " ")}</Tag> },
          { title: "Owner", dataIndex: "assignedName", render: (n: string | null) => n ?? <Typography.Text type="secondary">unassigned</Typography.Text> },
          {
            title: "",
            render: (_, r) => (
              <Button size="small" onClick={() => { setOpen(r); setNotes(r.internalNotes); setReply(""); }}>
                Open
              </Button>
            ),
          },
        ]}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} width={560} title={open ? `${TYPE_LABEL[open.requestType]} #${open.id}` : ""}>
        {open && (
          <Space direction="vertical" style={{ width: "100%" }} size="middle">
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Contact">{open.contactName} · <a href={`mailto:${open.email}`}>{open.email}</a></Descriptions.Item>
              <Descriptions.Item label="Company">{open.company}</Descriptions.Item>
              {open.fundStructure && <Descriptions.Item label="Fund">{open.fundStructure} · {open.aumBand}</Descriptions.Item>}
              {open.providerName && <Descriptions.Item label="Provider">{open.providerName}</Descriptions.Item>}
              <Descriptions.Item label="Interested in">{open.servicesNeeded.map((s) => <Tag key={s}>{s}</Tag>)}</Descriptions.Item>
              {open.message && <Descriptions.Item label="Message"><span style={{ whiteSpace: "pre-wrap" }}>{open.message}</span></Descriptions.Item>}
            </Descriptions>
            <Space wrap>
              <Select value={open.status} style={{ width: 160 }} onChange={(status) => { run(() => updateRequest({ id: open.id, status })); setOpen({ ...open, status }); }}
                options={RFI_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
              <Button onClick={() => run(() => updateRequest({ id: open.id, assignToMe: true }))}>Assign to me</Button>
            </Space>
            <div>
              <Typography.Text strong>Internal notes</Typography.Text>
              <Input.TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <Button size="small" style={{ marginTop: 6 }} onClick={() => run(() => updateRequest({ id: open.id, internalNotes: notes }))}>Save notes</Button>
            </div>
            <div>
              <Typography.Text strong>Reply by email</Typography.Text>
              <Input.TextArea rows={6} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Hi ${open.contactName}, thank you for your request…`} />
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

export type EmailRow = { id: number; toEmail: string; toName: string | null; subject: string; template: string; status: string; error: string | null; sentByName: string | null; createdAt: string };

const EMAIL_STATUS: Record<string, "success" | "processing" | "error" | "default" | "warning"> = {
  queued: "processing", sent: "success", delivered: "success", bounced: "error", complained: "warning", failed: "error",
};

export function EmailView({ log, resendConfigured }: { log: EmailRow[]; resendConfigured: boolean }) {
  const { run, pending } = useAction();
  const [form] = Form.useForm();
  const [mode, setMode] = useState<"single" | "segment">("single");
  const [count, setCount] = useState<number | null>(null);

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {!resendConfigured && (
        <Alert showIcon type="warning" message="RESEND_API_KEY is not set: emails are logged and printed to the server console instead of being sent." />
      )}
      <Card title="Compose">
        <Form form={form} layout="vertical" initialValues={{ mode: "single" }}
          onFinish={(v) => run(async () => {
            const res = await composeEmail({ ...v, mode });
            if (res.ok) form.resetFields(["subject", "body", "ctaLabel", "ctaUrl", "to", "toName"]);
            return res;
          })}>
          <Form.Item label="Send to">
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} optionType="button"
              options={[{ value: "single", label: "One person" }, { value: "segment", label: "Segment" }]} />
          </Form.Item>
          {mode === "single" ? (
            <Space.Compact block>
              <Form.Item name="to" rules={[{ required: true, type: "email" }]} style={{ flex: 2 }}><Input placeholder="email@company.lu" /></Form.Item>
              <Form.Item name="toName" style={{ flex: 1 }}><Input placeholder="Name (optional)" /></Form.Item>
            </Space.Compact>
          ) : (
            <Form.Item name="segment" rules={[{ required: true }]} extra={count !== null ? `${count} recipient(s)` : undefined}>
              <Select placeholder="Choose a segment" options={Object.entries(SEGMENTS).map(([value, label]) => ({ value, label }))}
                onChange={async (s: Segment) => setCount(await countSegment(s))} />
            </Form.Item>
          )}
          <Form.Item name="subject" label="Subject" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="body" label="Message" rules={[{ required: true }]} extra="Blank lines start new paragraphs. Recipients' first names are added automatically.">
            <Input.TextArea rows={8} />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="ctaLabel" style={{ flex: 1 }}><Input placeholder="Button label (optional)" /></Form.Item>
            <Form.Item name="ctaUrl" style={{ flex: 2 }}><Input placeholder="https://fundhub.lu/…" /></Form.Item>
          </Space.Compact>
          <Button type="primary" htmlType="submit" loading={pending} icon={<MailOutlined />}>Send</Button>
        </Form>
      </Card>
      <Card title="Sent emails" extra={<Typography.Text type="secondary">Delivery status updates via the Resend webhook</Typography.Text>}>
        <Table<EmailRow>
          size="small" rowKey="id" dataSource={log} pagination={{ pageSize: 25 }}
          columns={[
            { title: "When", dataIndex: "createdAt", render: fmt, width: 150 },
            { title: "To", render: (_, e) => e.toName ? `${e.toName} <${e.toEmail}>` : e.toEmail },
            { title: "Subject", dataIndex: "subject" },
            { title: "Template", dataIndex: "template", render: (t: string) => <Tag>{t}</Tag> },
            { title: "Status", render: (_, e) => <Badge status={EMAIL_STATUS[e.status] ?? "default"} text={e.status} title={e.error ?? undefined} /> },
            { title: "By", dataIndex: "sentByName", render: (n: string | null) => n ?? <Typography.Text type="secondary">system</Typography.Text> },
          ]}
        />
      </Card>
    </Space>
  );
}
