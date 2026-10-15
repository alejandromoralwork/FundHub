"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Markdown from "react-markdown";
import { Alert, App, Button, Card, Checkbox, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { CopyOutlined, DownloadOutlined, PlusOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { SOCIAL_LIMITS, SOCIAL_NETWORKS, type SocialNetwork } from "@fundhub/core/enums";
import { TAXONOMY } from "@fundhub/core/taxonomy";
import { aiDraft, createPost, deletePost, generateSocial, savePost, saveSocial, setPostStatus, socialCsv } from "@/lib/content-actions";
import { downloadText } from "./download";
import { useAction } from "./use-action";

const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY") : "—");
const STATUS_COLOR: Record<string, string> = { draft: "default", published: "green", archived: "orange", approved: "blue" };
const NETWORK_LABEL: Record<SocialNetwork, string> = { linkedin: "LinkedIn", x: "X (Twitter)", facebook: "Facebook", instagram: "Instagram" };
const TOPICS = ["Independence", "Fees", "Structuring", "Depositary", "Regulation", "FundHub", "Market data", "Technology"];

// ---------------------------------------------------------------- list

export type PostRow = { id: number; title: string; slug: string; kind: string; status: string; topic: string; aiGenerated: boolean; publishedAt: string | null; updatedAt: string; socialCount: number };

export function ContentList({ rows, providers, aiReady, websiteUrl }: { rows: PostRow[]; providers: { id: number; name: string }[]; aiReady: boolean; websiteUrl: string }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pending, start] = useTransition();
  const [aiOpen, setAiOpen] = useState(false);
  const [form] = Form.useForm();

  const openPost = (fn: () => Promise<{ ok?: string; error?: string; id?: number }>) =>
    start(async () => {
      const res = await fn();
      if (res.error) message.error(res.error);
      else if (res.id) {
        if (res.ok) message.success(res.ok);
        router.push(`/content/${res.id}`);
      }
    });

  return (
    <Card
      title="Content studio: News & Learn"
      extra={
        <Space>
          <Button icon={<PlusOutlined />} loading={pending} onClick={() => openPost(() => createPost("news"))}>
            Write manually
          </Button>
          <Button type="primary" icon={<RobotOutlined />} onClick={() => setAiOpen(true)} disabled={!aiReady}>
            Draft with AI
          </Button>
        </Space>
      }
    >
      {!aiReady && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Set ANTHROPIC_API_KEY on the admin project to enable AI drafts and social versions." />}
      <Table<PostRow>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 25 }}
        columns={[
          { title: "Title", render: (_, r) => <Link href={`/content/${r.id}`}>{r.title}</Link> },
          { title: "Type", dataIndex: "kind", render: (k: string) => <Tag>{k === "news" ? "News" : "Learn"}</Tag>, filters: [{ text: "News", value: "news" }, { text: "Learn", value: "learn" }], onFilter: (v, r) => r.kind === v },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>, filters: ["draft", "published", "archived"].map((s) => ({ text: s, value: s })), onFilter: (v, r) => r.status === v },
          { title: "Topic", dataIndex: "topic" },
          { title: "", render: (_, r) => (r.aiGenerated ? <Tag icon={<RobotOutlined />}>AI draft</Tag> : null) },
          { title: "Social", dataIndex: "socialCount", render: (n: number) => (n ? `${n}/4` : "—") },
          { title: "Published", dataIndex: "publishedAt", render: fmt },
          { title: "", render: (_, r) => (r.status === "published" ? <a href={`${websiteUrl}/news/${r.slug}`} target="_blank" rel="noreferrer">View</a> : null) },
        ]}
      />
      <Modal
        open={aiOpen}
        title="Draft an article with AI"
        okText="Generate draft"
        confirmLoading={pending}
        onCancel={() => setAiOpen(false)}
        onOk={() => form.submit()}
        width={680}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Claude writes a draft using only the facts you give it (plus FundHub data you tick). The draft is never published automatically;
          unverifiable points are marked [CHECK: …] and block publishing until resolved.
        </Typography.Paragraph>
        <Form form={form} layout="vertical" initialValues={{ kind: "news", useMarketStats: false }} onFinish={(v) => openPost(() => aiDraft(v))}>
          <Form.Item name="kind" label="Type">
            <Radio.Group optionType="button" options={[{ value: "news", label: "News" }, { value: "learn", label: "Learn (guide)" }]} />
          </Form.Item>
          <Form.Item name="brief" label="What should the article cover?" rules={[{ required: true, min: 15 }]}>
            <Input.TextArea rows={3} placeholder="e.g. The CSSF published new guidance on delegation reporting; explain what changes for third-party AIFM clients." />
          </Form.Item>
          <Form.Item name="notes" label="Sources and facts (paste text, links, figures)">
            <Input.TextArea rows={5} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="useMarketStats" valuePropName="checked" noStyle>
              <Checkbox>Use FundHub market statistics</Checkbox>
            </Form.Item>
            <Form.Item name="providerId" noStyle>
              <Select allowClear showSearch optionFilterProp="label" placeholder="About a provider (optional)" style={{ width: 280 }} options={providers.map((p) => ({ value: p.id, label: p.name }))} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------- editor

export type PostFull = {
  id: number;
  slug: string;
  kind: "news" | "learn";
  title: string;
  summary: string;
  body: string;
  topic: string;
  category: string | null;
  readMinutes: number;
  status: string;
  aiGenerated: boolean;
  aiBrief: string | null;
  publishedAt: string | null;
};
export type SocialRow = { id: number; network: SocialNetwork; text: string; hashtags: string[]; status: string };

function SocialCard({ s }: { s: SocialRow }) {
  const { run, pending } = useAction();
  const { message } = App.useApp();
  const [text, setText] = useState(s.text);
  const [tags, setTags] = useState(s.hashtags.join(" "));
  const limit = SOCIAL_LIMITS[s.network];
  const full = s.network === "x" ? text : `${text}${tags.trim() ? `\n\n${tags.split(/\s+/).filter(Boolean).map((t) => `#${t.replace(/^#/, "")}`).join(" ")}` : ""}`;
  const over = full.length > limit;
  const payload = (status: string) => ({ id: s.id, text, hashtags: tags.split(/\s+/).filter(Boolean), status });

  return (
    <Card size="small" title={NETWORK_LABEL[s.network]} extra={<Tag color={STATUS_COLOR[s.status]}>{s.status}</Tag>}>
      <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 4, maxRows: 14 }} />
      {s.network !== "x" && (
        <Input style={{ marginTop: 8 }} addonBefore="#" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hashtags separated by spaces" />
      )}
      <Typography.Text type={over ? "danger" : "secondary"} style={{ fontSize: 12, display: "block", marginTop: 6 }}>
        {full.length} / {limit} characters{over ? " (too long for this network)" : ""}
      </Typography.Text>
      <Space wrap style={{ marginTop: 8 }}>
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={async () => {
            await navigator.clipboard.writeText(full);
            message.success("Copied");
          }}
        >
          Copy
        </Button>
        <Button size="small" loading={pending} onClick={() => run(() => saveSocial(payload(s.status)))}>
          Save
        </Button>
        <Button size="small" loading={pending} disabled={over} onClick={() => run(() => saveSocial(payload("approved")))}>
          Approve
        </Button>
        <Button size="small" icon={<SendOutlined />} loading={pending} disabled={over} onClick={() => run(() => saveSocial(payload("published")))}>
          Mark as posted
        </Button>
      </Space>
    </Card>
  );
}

export function PostEditor({ post, social, aiReady, websiteUrl }: { post: PostFull; social: SocialRow[]; aiReady: boolean; websiteUrl: string }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [form] = Form.useForm();
  const [body, setBody] = useState(post.body);

  const values = () => ({ ...form.getFieldsValue(), body, id: post.id, category: form.getFieldValue("category") ?? null });

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        title={
          <Space>
            <Link href="/content">Content</Link>
            <span>/</span>
            <span>{post.title}</span>
            <Tag color={STATUS_COLOR[post.status]}>{post.status}</Tag>
            {post.aiGenerated && <Tag icon={<RobotOutlined />}>AI draft</Tag>}
          </Space>
        }
        extra={
          <Space>
            <Button loading={pending} onClick={() => run(() => savePost(values()))}>
              Save
            </Button>
            {post.status !== "published" ? (
              <Popconfirm title="Publish on the website now?" onConfirm={() => run(async () => { const s = await savePost(values()); return s.error ? s : setPostStatus(post.id, "published"); })}>
                <Button type="primary">Publish</Button>
              </Popconfirm>
            ) : (
              <>
                <a href={`${websiteUrl}/news/${post.slug}`} target="_blank" rel="noreferrer"><Button>View live</Button></a>
                <Button onClick={() => run(() => setPostStatus(post.id, "draft"))}>Unpublish</Button>
              </>
            )}
            <Popconfirm title="Delete this post and its social versions?" onConfirm={() => run(async () => { const r = await deletePost(post.id); router.push("/content"); return r; })}>
              <Button danger>Delete</Button>
            </Popconfirm>
          </Space>
        }
      >
        {post.aiBrief && <Alert style={{ marginBottom: 16 }} type="info" showIcon message="AI draft: check every fact against your sources before publishing." description={`Brief: ${post.aiBrief}`} />}
        <Form form={form} layout="vertical" initialValues={{ ...post }}>
          <Row gutter={16}>
            <Col xs={24} md={16}>
              <Form.Item name="title" label="Title" rules={[{ required: true }]}><Input /></Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="kind" label="Type"><Select options={[{ value: "news", label: "News" }, { value: "learn", label: "Learn" }]} /></Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="readMinutes" label="Read (min)"><InputNumber min={1} max={60} style={{ width: "100%" }} /></Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="summary" label="Summary (shown in lists and search results)"><Input.TextArea rows={2} maxLength={600} showCount /></Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="topic" label="Topic"><Select options={TOPICS.map((t) => ({ value: t, label: t }))} /></Form.Item>
            </Col>
            <Col xs={12} md={10}>
              <Form.Item name="category" label="Related service category"><Select allowClear options={TAXONOMY.map((c) => ({ value: c.slug, label: c.label }))} /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="slug" label="URL slug"><Input addonBefore="/news/" /></Form.Item>
            </Col>
          </Row>
        </Form>
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Typography.Text strong>Body (Markdown)</Typography.Text>
            <Input.TextArea className="mono" value={body} onChange={(e) => setBody(e.target.value)} autoSize={{ minRows: 18, maxRows: 40 }} style={{ marginTop: 6, fontSize: 13 }} />
          </Col>
          <Col xs={24} lg={12}>
            <Typography.Text strong>Preview</Typography.Text>
            <div style={{ marginTop: 6, padding: 16, border: "1px solid #eef0f3", borderRadius: 6, background: "#fff", maxHeight: 720, overflow: "auto" }}>
              {body.trim() ? <Markdown>{body}</Markdown> : <Empty description="Nothing yet" />}
            </div>
          </Col>
        </Row>
      </Card>

      <Card
        title="Social media versions"
        extra={
          <Space>
            {social.length > 0 && (
              <Button
                icon={<DownloadOutlined />}
                onClick={async () => {
                  downloadText(`${post.slug}-social.csv`, await socialCsv(post.id), "text/csv");
                }}
              >
                Export CSV
              </Button>
            )}
            <Button type="primary" icon={<RobotOutlined />} loading={pending} disabled={!aiReady} onClick={() => run(() => generateSocial(post.id))}>
              {social.length ? "Regenerate with AI" : "Generate with AI"}
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          One version per network within its limits. Copy and post, or export the CSV to a scheduler. Automatic posting through Postiz can be connected later.
        </Typography.Paragraph>
        {social.length ? (
          <Tabs items={SOCIAL_NETWORKS.map((n) => social.find((s) => s.network === n)).filter((s): s is SocialRow => !!s).map((s) => ({ key: s.network, label: NETWORK_LABEL[s.network], children: <SocialCard s={s} /> }))} />
        ) : (
          <Empty description="No social versions yet" />
        )}
      </Card>
    </Space>
  );
}
