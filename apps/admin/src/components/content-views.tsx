"use client";
/**
 * FILE: apps/admin/src/components/content-views.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's "Content studio" for the website's News and Learn articles.
 *   - `ContentList`: the table of all articles, a button to start one by hand, and a pop-up to ask the AI
 *     (Claude) to write a first draft from a brief and sources.
 *   - `PostEditor`: the editing screen for one article (title, summary, topic, slug, Markdown body with a
 *     live preview), with Save / Publish / Unpublish / Delete, plus the social-media versions of the article.
 *   - `SocialCard` (private): one editable social post (LinkedIn, X, Facebook or Instagram) with a character
 *     counter and Copy / Save / Approve / "Mark as posted" buttons.
 * WHERE IT RUNS: in the browser (`"use client"`): typing, previews, pop-ups and clipboard copying all need the
 *   browser. Saving, publishing and AI generation happen on the server via server actions in
 *   `@/lib/content-actions`.
 * FRAMEWORK NOTES:
 *   - React component = function returning JSX; props are its inputs; hooks (`useState`, `useTransition`,
 *     `useRouter`, `App.useApp`, `Form.useForm`, our `useAction`) give it memory and abilities.
 *   - Markdown is a simple text format for formatted writing (`# Heading`, `**bold**`, `- list`); the
 *     `react-markdown` library turns it into real headings and paragraphs for the preview.
 *   - antd: `Table`, `Modal`, `Form`, `Popconfirm` (a small "Are you sure?" bubble before an action), `Tabs`,
 *     `Empty` (the grey "nothing here" placeholder), `Row`/`Col` grid, and more.
 *   - Next.js `useRouter().push(url)` moves the browser to another Console page without a full reload.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - exported type aliases for rows; `"news" | "learn"` exact-string unions; `string[]`; `string | null`;
 *   - `Record<SocialNetwork, string>`: a lookup table that must have an entry for every network;
 *   - generics `Table<PostRow>`; a type guard `(s): s is SocialRow => !!s` (tells TypeScript that the items
 *     left after a filter are definitely SocialRow, not undefined);
 *   - regular expressions `/\s+/` (patterns for matching text), template strings, spread, `??`, `&&`,
 *     ternaries, async/await.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@fundhub/…` = our shared packages; `@/…` = this app's src folder; `./…` = same folder.

// Next.js link (page change without reload) and router (change page from code).
import Link from "next/link";
import { useRouter } from "next/navigation";
// React hooks: `useState` remembers values; `useTransition` runs async work and reports whether it is busy.
import { useState, useTransition } from "react";
// Turns Markdown text into formatted markup for the preview.
import Markdown from "react-markdown";
// antd UI components (see FRAMEWORK NOTES). `App` gives access to antd's pop-up `message` API.
import { Alert, App, Button, Card, Checkbox, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Radio, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
// Icons: copy, download, plus, robot (AI), and paper plane (send).
import { CopyOutlined, DownloadOutlined, PlusOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
// Date formatting library.
import dayjs from "dayjs";
// Shared social-media settings: character limit per network, the list of networks, and the network type.
import { SOCIAL_LIMITS, SOCIAL_NETWORKS, type SocialNetwork } from "@fundhub/core/enums";
// The list of service categories (slug + label) used across FundHub.
import { TAXONOMY } from "@fundhub/core/taxonomy";
// Server actions for content: AI draft, create/delete/save a post, generate/save social versions, change a
// post's status, and build the social CSV export.
import { aiDraft, createPost, deletePost, generateSocial, savePost, saveSocial, setPostStatus, socialCsv } from "@/lib/content-actions";
// Helper that makes the browser download a piece of text as a file.
import { downloadText } from "./download";
// Our hook: run a server action, show its message, refresh the page data.
import { useAction } from "./use-action";

/**
 * Kind: constant holding an arrow function.
 * @param d  `string | null` — a date as text, or null.
 * @returns  `string` like "3 Mar 2026", or "—" when there is no date.
 */
const fmt = (d: string | null) => (d ? dayjs(d).format("D MMM YYYY") : "—");
/** Kind: constant lookup table. Tag colour per status (used for both articles and social posts). */
const STATUS_COLOR: Record<string, string> = { draft: "default", published: "green", archived: "orange", approved: "blue" };
/**
 * Kind: constant lookup table. Display names of the networks. Typed `Record<SocialNetwork, string>`, so
 * TypeScript complains if a network is added to the shared list but forgotten here.
 */
const NETWORK_LABEL: Record<SocialNetwork, string> = { linkedin: "LinkedIn", x: "X (Twitter)", facebook: "Facebook", instagram: "Instagram" };
/** Kind: constant (array of strings). The topics an article can be filed under. */
const TOPICS = ["Independence", "Fees", "Structuring", "Depositary", "Regulation", "FundHub", "Market data", "Technology"];

// ---------------------------------------------------------------- list

/**
 * Kind: type alias (exported). One row of the article list: id, title, URL slug, kind ("news" or "learn"),
 * status, topic, whether the AI wrote the first draft, when it was published (null if never), last update,
 * and how many social versions it has.
 */
export type PostRow = { id: number; title: string; slug: string; kind: string; status: string; topic: string; aiGenerated: boolean; publishedAt: string | null; updatedAt: string; socialCount: number };

/**
 * Kind: React component (exported; used by the Content page).
 * @param rows        `PostRow[]` — all articles.
 * @param providers   `{ id: number; name: string }[]` — providers the AI draft can be about.
 * @param aiReady     `boolean` — is the Anthropic (Claude) API key set? If not, AI buttons are disabled.
 * @param websiteUrl  `string` — the public website's address, for "View" links.
 * @returns           JSX: the article table and the AI-draft pop-up.
 */
export function ContentList({ rows, providers, aiReady, websiteUrl }: { rows: PostRow[]; providers: { id: number; name: string }[]; aiReady: boolean; websiteUrl: string }) {
  // The Next.js router, so we can open the editor after a post is created.
  const router = useRouter();
  // antd's pop-up messages (green "success", red "error"). `App.useApp()` returns an object; we destructure
  // only `message` from it.
  const { message } = App.useApp();
  // `useTransition` returns [isBusy, startFunction]: `start(fn)` runs `fn` and `pending` stays true until done.
  // Used here instead of `useAction` because we want to open the new post rather than just refresh the list.
  const [pending, start] = useTransition();
  // Is the AI-draft pop-up open?
  const [aiOpen, setAiOpen] = useState(false);
  // Controller for the AI-draft form (so the pop-up's OK button can submit it).
  const [form] = Form.useForm();

  /**
   * Kind: arrow function.
   * Runs a server action that creates a post, then opens it in the editor.
   * @param fn  a function with no arguments returning `Promise<{ ok?: string; error?: string; id?: number }>`;
   *            the `id` is the new post's id.
   * On error: shows the red message. Otherwise, if an id came back: shows the success text (if any) and
   * navigates to `/content/<id>` (the editor page).
   */
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
    // The card's `extra` slot (top-right) holds the two "new article" buttons.
    <Card
      title="Content studio: News & Learn"
      extra={
        <Space>
          {/* Creates an empty "news" post on the server and opens it. */}
          <Button icon={<PlusOutlined />} loading={pending} onClick={() => openPost(() => createPost("news"))}>
            Write manually
          </Button>
          {/* Only opens the AI pop-up; disabled when no AI key is configured. */}
          <Button type="primary" icon={<RobotOutlined />} onClick={() => setAiOpen(true)} disabled={!aiReady}>
            Draft with AI
          </Button>
        </Space>
      }
    >
      {/* Warning shown only when the AI is not configured. */}
      {!aiReady && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Set ANTHROPIC_API_KEY on the admin project to enable AI drafts and social versions." />}
      <Table<PostRow>
        size="small"
        rowKey="id"
        dataSource={rows}
        pagination={{ pageSize: 25 }}
        columns={[
          // Column settings: `title` header, `dataIndex` field, `render` custom cell. `filters` adds a
          // filter menu to the column header, and `onFilter(v, r)` decides whether row `r` matches the
          // chosen value `v` (here: same kind / same status). Filtering happens in the browser.
          { title: "Title", render: (_, r) => <Link href={`/content/${r.id}`}>{r.title}</Link> },
          { title: "Type", dataIndex: "kind", render: (k: string) => <Tag>{k === "news" ? "News" : "Learn"}</Tag>, filters: [{ text: "News", value: "news" }, { text: "Learn", value: "learn" }], onFilter: (v, r) => r.kind === v },
          { title: "Status", dataIndex: "status", render: (s: string) => <Tag color={STATUS_COLOR[s]}>{s}</Tag>, filters: ["draft", "published", "archived"].map((s) => ({ text: s, value: s })), onFilter: (v, r) => r.status === v },
          { title: "Topic", dataIndex: "topic" },
          // A robot tag for AI-drafted posts; `null` = show nothing.
          { title: "", render: (_, r) => (r.aiGenerated ? <Tag icon={<RobotOutlined />}>AI draft</Tag> : null) },
          // "2/4" = two of the four networks have a social version; 0 counts as false, so "—".
          { title: "Social", dataIndex: "socialCount", render: (n: number) => (n ? `${n}/4` : "—") },
          { title: "Published", dataIndex: "publishedAt", render: fmt },
          // Link to the live article on the website, only for published posts.
          { title: "", render: (_, r) => (r.status === "published" ? <a href={`${websiteUrl}/news/${r.slug}`} target="_blank" rel="noreferrer">View</a> : null) },
        ]}
      />
      {/* The AI-draft pop-up. "Generate draft" (`okText`) submits the form; `confirmLoading` spins while the
          AI works; `width={680}` makes it wider than the default. */}
      <Modal
        open={aiOpen}
        title="Draft an article with AI"
        okText="Generate draft"
        confirmLoading={pending}
        onCancel={() => setAiOpen(false)}
        onOk={() => form.submit()}
        width={680}
      >
        {/* Business rule explained to staff: AI drafts are never auto-published, and unverified claims are
            flagged with [CHECK: …] markers that block publishing (enforced on the server). */}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          Claude writes a draft using only the facts you give it (plus FundHub data you tick). The draft is never published automatically;
          unverifiable points are marked [CHECK: …] and block publishing until resolved.
        </Typography.Paragraph>
        {/* On a valid submit, send the values to the `aiDraft` server action, then open the new draft. */}
        <Form form={form} layout="vertical" initialValues={{ kind: "news", useMarketStats: false }} onFinish={(v) => openPost(() => aiDraft(v))}>
          <Form.Item name="kind" label="Type">
            <Radio.Group optionType="button" options={[{ value: "news", label: "News" }, { value: "learn", label: "Learn (guide)" }]} />
          </Form.Item>
          {/* `min: 15` = the brief must be at least 15 characters, so the AI gets something to work with. */}
          <Form.Item name="brief" label="What should the article cover?" rules={[{ required: true, min: 15 }]}>
            <Input.TextArea rows={3} placeholder="e.g. The CSSF published new guidance on delegation reporting; explain what changes for third-party AIFM clients." />
          </Form.Item>
          <Form.Item name="notes" label="Sources and facts (paste text, links, figures)">
            <Input.TextArea rows={5} />
          </Form.Item>
          <Space wrap>
            {/* A checkbox stores true/false in a prop called `checked` (not `value`), so `valuePropName`
                tells antd to use that. `noStyle` drops the usual label and spacing. */}
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

/**
 * Kind: type alias (exported). Everything about one article for the editor: id, slug, kind, title,
 * summary, Markdown body, topic, related service category (null = none), estimated reading time in minutes,
 * status, whether the AI drafted it, the brief given to the AI (null if written by hand), publish date.
 */
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
/**
 * Kind: type alias (exported). One social-media version of an article: id, which network, the post text,
 * its hashtags (without "#"), and status (draft → approved → published).
 */
export type SocialRow = { id: number; network: SocialNetwork; text: string; hashtags: string[]; status: string };

/**
 * Kind: React component (private).
 * One editable social post card.
 * @param s  `SocialRow` — the social version to edit.
 * @returns  JSX: a card with the text box, hashtag box, character counter and action buttons.
 */
function SocialCard({ s }: { s: SocialRow }) {
  const { run, pending } = useAction();
  const { message } = App.useApp();
  // Local copies of the text and hashtags being edited; hashtags are edited as one space-separated line.
  const [text, setText] = useState(s.text);
  const [tags, setTags] = useState(s.hashtags.join(" "));
  // The maximum number of characters this network allows.
  const limit = SOCIAL_LIMITS[s.network];
  // The full post as it would appear. For X the text is used as is (no separate hashtag line). For other
  // networks, if any hashtags were typed (`tags.trim()` is not empty), add two line breaks (`\n\n`) and the
  // tags. Step by step: `.split(/\s+/)` cuts the line at any run of spaces; `.filter(Boolean)` drops empty
  // pieces; `.map` puts one "#" in front of each (`.replace(/^#/, "")` first removes a "#" the user may
  // have typed, so it is never doubled); `.join(" ")` glues them back with spaces.
  const full = s.network === "x" ? text : `${text}${tags.trim() ? `\n\n${tags.split(/\s+/).filter(Boolean).map((t) => `#${t.replace(/^#/, "")}`).join(" ")}` : ""}`;
  // Is it longer than the network allows? (`.length` = number of characters.)
  const over = full.length > limit;
  /**
   * Kind: arrow function. Builds what the `saveSocial` server action needs.
   * @param status  `string` — the status to save with (keep the current one, "approved" or "published").
   * @returns       `{ id, text, hashtags, status }`, with the hashtags turned back into a list.
   */
  const payload = (status: string) => ({ id: s.id, text, hashtags: tags.split(/\s+/).filter(Boolean), status });

  return (
    <Card size="small" title={NETWORK_LABEL[s.network]} extra={<Tag color={STATUS_COLOR[s.status]}>{s.status}</Tag>}>
      {/* A text box that grows with its content between 4 and 14 lines (`autoSize`). */}
      <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 4, maxRows: 14 }} />
      {/* The hashtag box, not shown for X. `addonBefore="#"` shows a "#" label at its left. */}
      {s.network !== "x" && (
        <Input style={{ marginTop: 8 }} addonBefore="#" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hashtags separated by spaces" />
      )}
      {/* Character counter: red ("danger") when too long, grey otherwise. */}
      <Typography.Text type={over ? "danger" : "secondary"} style={{ fontSize: 12, display: "block", marginTop: 6 }}>
        {full.length} / {limit} characters{over ? " (too long for this network)" : ""}
      </Typography.Text>
      <Space wrap style={{ marginTop: 8 }}>
        {/* Copy the full post to the clipboard (`navigator.clipboard` is the browser's clipboard API; it is
            async, hence `await`), then confirm with a pop-up. */}
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
        {/* Save keeps the current status; Approve and "Mark as posted" also change it. The last two are
            disabled while the post is too long. Posting itself is done by hand on the network. */}
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

/**
 * Kind: React component (exported; used by the /content/[id] editor page).
 * @param post        `PostFull` — the article being edited.
 * @param social      `SocialRow[]` — its social versions (may be empty).
 * @param aiReady     `boolean` — is the AI configured?
 * @param websiteUrl  `string` — public website address for "View live".
 * @returns           JSX: the article editor card and the social versions card.
 */
export function PostEditor({ post, social, aiReady, websiteUrl }: { post: PostFull; social: SocialRow[]; aiReady: boolean; websiteUrl: string }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [form] = Form.useForm();
  // The Markdown body is kept in its own state (not in the antd form) so the preview redraws as you type.
  const [body, setBody] = useState(post.body);

  /**
   * Kind: arrow function. Collects everything to save: all form fields (`form.getFieldsValue()`), plus the
   * body and the post id. `category` is read separately with `?? null` so an emptied drop-down is saved as
   * "no category" (null) instead of being left out.
   * @returns an object for the `savePost` server action.
   */
  const values = () => ({ ...form.getFieldsValue(), body, id: post.id, category: form.getFieldValue("category") ?? null });

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* The card's `title` can be any JSX: here a breadcrumb "Content / <title>" plus status tags. */}
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
            {/* Not yet published → a "Publish" button behind an "Are you sure?" bubble. On confirm it first
                saves; if saving failed (`s.error`) it returns that error, otherwise it sets the status to
                "published" (the server refuses if [CHECK: …] markers remain).
                Already published → "View live" and "Unpublish" (back to draft), grouped in a fragment <>…</>. */}
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
            {/* Delete after confirmation, then go back to the list. `danger` makes the button red. */}
            <Popconfirm title="Delete this post and its social versions?" onConfirm={() => run(async () => { const r = await deletePost(post.id); router.push("/content"); return r; })}>
              <Button danger>Delete</Button>
            </Popconfirm>
          </Space>
        }
      >
        {/* For AI drafts, a reminder to fact-check, showing the brief the AI was given. */}
        {post.aiBrief && <Alert style={{ marginBottom: 16 }} type="info" showIcon message="AI draft: check every fact against your sources before publishing." description={`Brief: ${post.aiBrief}`} />}
        {/* The metadata form, pre-filled with a copy of the post (`{ ...post }`). Fields are laid out on the
            24-column grid: e.g. `xs={24} md={16}` = full width on phones, two-thirds on medium screens. */}
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
              {/* `maxLength` + `showCount` limit the summary to 600 characters and show a live counter. */}
              <Form.Item name="summary" label="Summary (shown in lists and search results)"><Input.TextArea rows={2} maxLength={600} showCount /></Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="topic" label="Topic"><Select options={TOPICS.map((t) => ({ value: t, label: t }))} /></Form.Item>
            </Col>
            <Col xs={12} md={10}>
              <Form.Item name="category" label="Related service category"><Select allowClear options={TAXONOMY.map((c) => ({ value: c.slug, label: c.label }))} /></Form.Item>
            </Col>
            <Col xs={24} md={8}>
              {/* The slug is the last part of the article's web address. */}
              <Form.Item name="slug" label="URL slug"><Input addonBefore="/news/" /></Form.Item>
            </Col>
          </Row>
        </Form>
        {/* Side by side on large screens: the Markdown text on the left, the formatted preview on the right. */}
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Typography.Text strong>Body (Markdown)</Typography.Text>
            <Input.TextArea className="mono" value={body} onChange={(e) => setBody(e.target.value)} autoSize={{ minRows: 18, maxRows: 40 }} style={{ marginTop: 6, fontSize: 13 }} />
          </Col>
          <Col xs={24} lg={12}>
            <Typography.Text strong>Preview</Typography.Text>
            {/* A scrollable box (`overflow: "auto"`) at most 720px tall. If the body is blank (only spaces
                counts as blank thanks to `.trim()`), show the empty placeholder instead. */}
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
            {/* Export button only when there is something to export. It asks the server for the CSV text
                (`await socialCsv(…)`) and hands it to `downloadText`, which saves it as "<slug>-social.csv". */}
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
            {/* Ask the AI to write (or rewrite) one version per network. */}
            <Button type="primary" icon={<RobotOutlined />} loading={pending} disabled={!aiReady} onClick={() => run(() => generateSocial(post.id))}>
              {social.length ? "Regenerate with AI" : "Generate with AI"}
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          One version per network within its limits. Copy and post, or export the CSV to a scheduler. Automatic posting through Postiz can be connected later.
        </Typography.Paragraph>
        {/* One tab per network, in the fixed network order. Step by step: for each network `n` find its
            version (`.find` gives the row or undefined); `.filter((s): s is SocialRow => !!s)` drops the
            missing ones and, being a "type guard", tells TypeScript that what remains are real rows; `.map`
            turns each into a tab whose content is a `SocialCard`. With no versions, show the placeholder. */}
        {social.length ? (
          <Tabs items={SOCIAL_NETWORKS.map((n) => social.find((s) => s.network === n)).filter((s): s is SocialRow => !!s).map((s) => ({ key: s.network, label: NETWORK_LABEL[s.network], children: <SocialCard s={s} /> }))} />
        ) : (
          <Empty description="No social versions yet" />
        )}
      </Card>
    </Space>
  );
}
