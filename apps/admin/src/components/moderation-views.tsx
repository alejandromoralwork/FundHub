"use client";

import Link from "next/link";
import { Alert, Button, Card, Descriptions, Empty, Form, InputNumber, Popconfirm, Rate, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { PROVIDER_TYPES } from "@fundhub/core/enums";
import { TAXONOMY } from "@fundhub/core/taxonomy";
import {
  approveClaim,
  approveNewListing,
  approveReview,
  rejectClaim,
  rejectReview,
  sendReviewVerification,
} from "@/lib/moderation-actions";
import { useAction } from "./use-action";

const fmt = (d: string | Date | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
const domain = (email: string) => email.split("@")[1] ?? "";
const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------- claims

export type ClaimRow = {
  id: number;
  status: string;
  jobTitle: string;
  message: string;
  proposedName: string | null;
  proposedCategory: string | null;
  proposedWebsite: string | null;
  createdAt: string;
  reviewedAt: string | null;
  providerId: number | null;
  providerName: string | null;
  providerSlug: string | null;
  providerWebsite: string | null;
  userName: string;
  userEmail: string;
};

function NewListingForm({ claim }: { claim: ClaimRow }) {
  const { run, pending } = useAction();
  return (
    <Form
      layout="inline"
      initialValues={{ category: claim.proposedCategory ?? undefined, providerType: "Boutique" }}
      onFinish={(v) => run(() => approveNewListing({ ...v, claimId: claim.id }))}
      style={{ rowGap: 8 }}
    >
      <Form.Item name="category" rules={[{ required: true }]}>
        <Select style={{ width: 240 }} placeholder="Category" options={TAXONOMY.map((c) => ({ value: c.slug, label: c.label }))} />
      </Form.Item>
      <Form.Item name="providerType" rules={[{ required: true }]}>
        <Select style={{ width: 130 }} options={PROVIDER_TYPES.map((t) => ({ value: t, label: t }))} />
      </Form.Item>
      <Form.Item name="headcount" rules={[{ required: true, message: "Headcount" }]}>
        <InputNumber min={1} placeholder="Headcount" />
      </Form.Item>
      <Form.Item name="priceMin" rules={[{ required: true, message: "Min fee" }]}>
        <InputNumber min={1} placeholder="Fee min €/qtr" style={{ width: 130 }} />
      </Form.Item>
      <Form.Item name="priceMax" rules={[{ required: true, message: "Max fee" }]}>
        <InputNumber min={1} placeholder="Fee max €/qtr" style={{ width: 130 }} />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={pending}>
        Create listing & approve
      </Button>
    </Form>
  );
}

export function ClaimsView({ pending, recent }: { pending: ClaimRow[]; recent: ClaimRow[] }) {
  const { run, pending: busy } = useAction();
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title={`Company claims to review (${pending.length})`}>
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message="Approve only when you're confident the person represents the company: matching email domain, LinkedIn, or a call to the company's switchboard."
        />
        {pending.length === 0 ? (
          <Empty description="Nothing to review" />
        ) : (
          pending.map((c) => {
            const site = hostOf(c.providerWebsite ?? c.proposedWebsite);
            const match = !!site && domain(c.userEmail).endsWith(site);
            return (
              <Card key={c.id} type="inner" size="small" style={{ marginBottom: 12 }}
                title={c.providerName ? <Link href={`/db/providers/${c.providerId}`}>{c.providerName}</Link> : <span>New listing: {c.proposedName}</span>}
                extra={<Typography.Text type="secondary">{fmt(c.createdAt)}</Typography.Text>}
              >
                <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                  <Descriptions.Item label="Requested by">{c.userName} · {c.jobTitle}</Descriptions.Item>
                  <Descriptions.Item label="Email">
                    <a href={`mailto:${c.userEmail}`}>{c.userEmail}</a>{" "}
                    {site && (match ? <Tag color="green">domain matches {site}</Tag> : <Tag color="orange">domain ≠ {site}</Tag>)}
                  </Descriptions.Item>
                  {c.proposedWebsite && <Descriptions.Item label="Website"><a href={c.proposedWebsite} target="_blank" rel="noreferrer">{c.proposedWebsite}</a></Descriptions.Item>}
                  {c.message && <Descriptions.Item label="Message" span={2}>“{c.message}”</Descriptions.Item>}
                </Descriptions>
                <div style={{ marginTop: 12 }}>
                  {c.providerId ? (
                    <Space>
                      <Popconfirm title="Grant edit rights and email the user?" onConfirm={() => run(() => approveClaim(c.id))}>
                        <Button type="primary" loading={busy}>Approve</Button>
                      </Popconfirm>
                      <Popconfirm title="Reject and notify the user?" onConfirm={() => run(() => rejectClaim(c.id))}>
                        <Button danger>Reject</Button>
                      </Popconfirm>
                    </Space>
                  ) : (
                    <Space direction="vertical">
                      <NewListingForm claim={c} />
                      <Popconfirm title="Reject and notify the user?" onConfirm={() => run(() => rejectClaim(c.id))}>
                        <Button danger size="small">Reject</Button>
                      </Popconfirm>
                    </Space>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </Card>
      <Card title="Recently reviewed">
        <Table<ClaimRow>
          size="small"
          rowKey="id"
          dataSource={recent}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Company", render: (_, c) => c.providerName ?? c.proposedName },
            { title: "User", render: (_, c) => `${c.userName} <${c.userEmail}>` },
            { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "approved" ? "green" : "red"}>{s}</Tag> },
            { title: "Reviewed", dataIndex: "reviewedAt", render: fmt },
          ]}
        />
      </Card>
    </Space>
  );
}

// ---------------------------------------------------------------- reviews

export type ReviewRow = {
  id: number;
  providerId: number;
  providerName: string;
  providerSlug: string;
  reviewerName: string;
  reviewerEmail: string;
  reviewerCompany: string;
  reviewerRole: string;
  relationship: string;
  clientSince: number | null;
  fundStructure: string;
  overall: number;
  serviceQuality: number;
  responsiveness: number;
  pricingTransparency: number;
  technology: number;
  title: string;
  body: string;
  evidence: string;
  flags: string[];
  status: string;
  createdAt: string;
  loggedIn: boolean;
  verificationSent: boolean;
};

export function ReviewsView({ pending, recent, websiteUrl }: { pending: ReviewRow[]; recent: ReviewRow[]; websiteUrl: string }) {
  const { run, pending: busy } = useAction();
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card title={`Client reviews to verify (${pending.length})`}>
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message="Process: 1) send the verification email, 2) when the reviewer confirms (reply or call), publish. Reviewer identity is never shown publicly."
        />
        {pending.length === 0 ? (
          <Empty description="Nothing to verify" />
        ) : (
          pending.map((r) => (
            <Card key={r.id} type="inner" size="small" style={{ marginBottom: 12 }}
              title={<Space><Rate disabled value={r.overall} style={{ fontSize: 14 }} /><span>“{r.title}”</span></Space>}
              extra={<a href={`${websiteUrl}/providers/${r.providerSlug}`} target="_blank" rel="noreferrer">{r.providerName}</a>}
            >
              <Descriptions size="small" column={{ xs: 1, md: 2 }}>
                <Descriptions.Item label="Reviewer">{r.reviewerName} · {r.reviewerRole}, {r.reviewerCompany}</Descriptions.Item>
                <Descriptions.Item label="Email">
                  <a href={`mailto:${r.reviewerEmail}`}>{r.reviewerEmail}</a> {r.loggedIn && <Tag color="blue">logged-in account</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="Relationship">{r.relationship}{r.clientSince ? ` since ${r.clientSince}` : ""}{r.fundStructure ? ` · ${r.fundStructure}` : ""}</Descriptions.Item>
                <Descriptions.Item label="Evidence">{r.evidence}</Descriptions.Item>
                <Descriptions.Item label="Scores" span={2}>
                  Service {r.serviceQuality} · Responsiveness {r.responsiveness} · Pricing transparency {r.pricingTransparency} · Technology {r.technology}
                </Descriptions.Item>
              </Descriptions>
              {r.flags.map((f) => <Alert key={f} type="warning" showIcon message={f} style={{ marginTop: 6 }} />)}
              <Typography.Paragraph style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{r.body}</Typography.Paragraph>
              <Space>
                <Button onClick={() => run(() => sendReviewVerification(r.id))} loading={busy}>
                  {r.verificationSent ? "Resend verification email" : "1. Send verification email"}
                </Button>
                <Popconfirm title="Publish anonymously and update the peer score?" onConfirm={() => run(() => approveReview(r.id))}>
                  <Button type="primary">2. Verified: publish</Button>
                </Popconfirm>
                <Popconfirm title="Reject this review?" onConfirm={() => run(() => rejectReview(r.id))}>
                  <Button danger>Reject</Button>
                </Popconfirm>
              </Space>
            </Card>
          ))
        )}
      </Card>
      <Card title="Recently handled">
        <Table<ReviewRow>
          size="small"
          rowKey="id"
          dataSource={recent}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Provider", dataIndex: "providerName" },
            { title: "Title", dataIndex: "title" },
            { title: "Score", dataIndex: "overall" },
            { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={s === "approved" ? "green" : "red"}>{s}</Tag> },
            { title: "Submitted", dataIndex: "createdAt", render: fmt },
          ]}
        />
      </Card>
    </Space>
  );
}

// ---------------------------------------------------------------- self-edits

export type EditRow = { id: number; providerName: string; providerId: number; userName: string | null; changes: Record<string, { from: unknown; to: unknown }>; createdAt: string };

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "—" : String(v));

export function EditsView({ edits }: { edits: EditRow[] }) {
  return (
    <Card title="Provider self-edits" extra={<Typography.Text type="secondary">Live immediately; review for abuse</Typography.Text>}>
      <Table<EditRow>
        size="small"
        rowKey="id"
        dataSource={edits}
        pagination={{ pageSize: 20 }}
        expandable={{
          expandedRowRender: (e) => (
            <Table
              size="small"
              pagination={false}
              rowKey="field"
              dataSource={Object.entries(e.changes).map(([field, c]) => ({ field, from: show(c.from), to: show(c.to) }))}
              columns={[
                { title: "Field", dataIndex: "field", render: (f: string) => <span className="mono">{f}</span> },
                { title: "Before", dataIndex: "from", render: (v: string) => <Typography.Text delete type="secondary">{v}</Typography.Text> },
                { title: "After", dataIndex: "to" },
              ]}
            />
          ),
        }}
        columns={[
          { title: "When", dataIndex: "createdAt", render: fmt },
          { title: "Provider", render: (_, e) => <Link href={`/db/providers/${e.providerId}`}>{e.providerName}</Link> },
          { title: "By", dataIndex: "userName" },
          { title: "Fields", render: (_, e) => Object.keys(e.changes).map((k) => <Tag key={k}>{k}</Tag>) },
        ]}
      />
    </Card>
  );
}
