"use client";

import { useState } from "react";
import { Alert, Button, Card, Drawer, Input, Popconfirm, Select, Space, Table, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { GDPR_REQUEST_STATUSES } from "@fundhub/core/enums";
import { erasePersonalData, exportPersonalData, updateGdprRequest } from "@/lib/gdpr-actions";
import { downloadText } from "./download";
import { useAction } from "./use-action";

export type GdprRow = { id: number; email: string; name: string; type: string; details: string; status: string; dueAt: string; resolution: string; createdAt: string };
const STATUS_COLOR: Record<string, string> = { received: "orange", verifying: "blue", completed: "green", rejected: "default" };

export function GdprView({ rows }: { rows: GdprRow[] }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState<GdprRow | null>(null);
  const [resolution, setResolution] = useState("");

  const exportFor = async (email: string) => {
    downloadText(`fundhub-data-${email}.json`, await exportPersonalData(email), "application/json");
  };

  return (
    <Card title="GDPR requests" extra={<Typography.Text type="secondary">Answer within one month (Art. 12(3) GDPR)</Typography.Text>}>
      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="Verify the requester owns the email (reply to the confirmation email) before exporting or erasing. Erasure here covers FundHub's database; also remove the person from the CRM (Twenty), newsletter (Listmonk) and Stripe."
      />
      <Table<GdprRow>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 25 }}
        columns={[
          { title: "Ref", dataIndex: "id", render: (id: number) => `GDPR-${id}` },
          { title: "Email", dataIndex: "email" },
          { title: "Type", dataIndex: "type", render: (t: string) => <Tag>{t}</Tag> },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
          {
            title: "Due",
            dataIndex: "dueAt",
            render: (d: string, r) => {
              const days = dayjs(d).diff(dayjs(), "day");
              const open = r.status === "received" || r.status === "verifying";
              return <span style={{ color: open && days < 7 ? "#b91c1c" : undefined }}>{dayjs(d).format("D MMM YYYY")}{open ? ` (${days}d)` : ""}</span>;
            },
          },
          { title: "", render: (_, r) => <Button size="small" onClick={() => { setOpen(r); setResolution(r.resolution); }}>Open</Button> },
        ]}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} width={520} title={open ? `GDPR-${open.id} · ${open.type}` : ""}>
        {open && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text>{open.name || "(no name)"} · {open.email}</Typography.Text>
            {open.details && <Typography.Paragraph type="secondary">“{open.details}”</Typography.Paragraph>}
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={() => exportFor(open.email)}>Export all data (JSON)</Button>
              <Popconfirm title="Erase this person's data? This can't be undone." onConfirm={() => run(() => erasePersonalData(open.email))}>
                <Button danger loading={pending}>Erase / anonymise</Button>
              </Popconfirm>
            </Space>
            <Typography.Text strong style={{ marginTop: 12 }}>Status</Typography.Text>
            <Select value={open.status} style={{ width: 200 }} onChange={(status) => { run(() => updateGdprRequest({ id: open.id, status, resolution })); setOpen({ ...open, status }); }}
              options={GDPR_REQUEST_STATUSES.map((s) => ({ value: s, label: s }))} />
            <Typography.Text strong>Resolution notes (kept as evidence)</Typography.Text>
            <Input.TextArea rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            <Button onClick={() => run(() => updateGdprRequest({ id: open.id, status: open.status, resolution }))}>Save notes</Button>
          </Space>
        )}
      </Drawer>
    </Card>
  );
}
