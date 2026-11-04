"use client";

/**
 * FILE: apps/admin/src/components/moderation-views.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Three Console moderation screens in one file:
 *   - `ClaimsView`: people asking to manage a company's listing ("claims"). Staff approve or reject them, or,
 *     for a company not yet listed, fill in a few facts and create the listing in one go (`NewListingForm`).
 *   - `ReviewsView`: client reviews waiting for verification: send a verification email, then publish or reject.
 *   - `EditsView`: an audit list of changes providers made to their own listings, showing before/after values.
 * WHERE IT RUNS: in the browser ("use client"), because of buttons, forms and the `useAction` hook. The lists are
 *   loaded on the server by the pages that render these components; decisions are sent to server actions in
 *   "@/lib/moderation-actions", which update the database and send emails.
 * FRAMEWORK NOTES:
 *   - antd parts: Card (`type="inner"` = a nested card), Descriptions (a label/value grid), Empty ("nothing here"
 *     placeholder), Rate (star rating; `disabled` = display only), Popconfirm ("are you sure?" bubble before an
 *     action), Form `layout="inline"` (fields side by side), Table with `expandable` (rows that open up).
 *   - In React, when a list is drawn with `.map`, each item needs a unique `key` prop so React can track it.
 *   - Next.js `Link` = an internal link that changes page without a full reload.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - object type aliases, `string | null`, `string | Date | null` unions, `string[]` arrays,
 *     `Record<string, { from: unknown; to: unknown }>` (an object keyed by field name), `unknown` (any value
 *     whose type we have not checked yet).
 *   - arrow functions, ternaries (also nested), `??`, `!!`, `try/catch`, regular expressions `/^www\./`,
 *     `Object.entries/Object.keys`, `Array.isArray`, renaming in destructuring `{ pending: busy }`.
 */

// `import { a } from "b"` brings named things from "b"; `import X from "b"` its default export.
// Plain names = npm libraries; `@fundhub/…` = our shared packages; `@/…` = this app's src; `./…` = this folder.
// Next.js internal link component.
import Link from "next/link";
// Ant Design UI components (see FRAMEWORK NOTES).
import { Alert, Button, Card, Descriptions, Empty, Form, InputNumber, Popconfirm, Rate, Select, Space, Table, Tag, Typography } from "antd";
// Date library used to format timestamps.
import dayjs from "dayjs";
// Allowed provider types (e.g. "Boutique") and the category taxonomy (slug + label for each category).
import { PROVIDER_TYPES } from "@fundhub/core/enums";
import { TAXONOMY } from "@fundhub/core/taxonomy";
// Server actions behind the moderation buttons (they run on the server, update the DB and send emails).
import {
  approveClaim,
  approveNewListing,
  approveReview,
  rejectClaim,
  rejectReview,
  sendReviewVerification,
} from "@/lib/moderation-actions";
// Hook: run a server action, show a toast, refresh the page data.
import { useAction } from "./use-action";

/**
 * Kind: arrow function. Formats a date/time as e.g. "18 Oct 2026 14:05", or "—" when there is no date.
 * @param d  type `string | Date | null` — date text, a Date object or nothing.
 */
const fmt = (d: string | Date | null) => (d ? dayjs(d).format("D MMM YYYY HH:mm") : "—");
/**
 * Kind: arrow function. The domain part of an email: "jane@acme.lu" → "acme.lu".
 * `.split("@")` cuts the text into an array at "@"; `[1]` takes the second piece; `?? ""` gives "" if there is none.
 */
const domain = (email: string) => email.split("@")[1] ?? "";
/**
 * Kind: arrow function. The host name of a web address without "www.": "https://www.acme.lu/x" → "acme.lu".
 * @param url  type `string | null`.
 * @returns    `string` — "" when there is no URL or it is not a valid address.
 */
const hostOf = (url: string | null) => {
  // `new URL(text)` parses a web address and THROWS an error if the text is not a valid URL; `try/catch` turns
  // that error into "". `/^www\./` is a regular expression meaning "the text 'www.' at the very start".
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------- claims

/**
 * Kind: type alias (exported for the server page that loads the claims).
 * One claim request. If the company already has a listing, the `provider…` fields are filled and `proposed…`
 * are `null`; for a new company it is the other way round (`providerId` is `null` and `proposedName` etc. come
 * from the claimant). `userName`/`userEmail` identify the website user who made the claim.
 */
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

/**
 * Kind: React component (private to this file: no `export`).
 * A one-line form shown for a claim on a company that is not yet listed. Staff choose the category and provider
 * type and enter headcount and the min/max quarterly fee; submitting creates the listing AND approves the claim.
 * @param claim  type `ClaimRow` — the claim being handled.
 * @returns JSX: an inline antd Form.
 */
function NewListingForm({ claim }: { claim: ClaimRow }) {
  const { run, pending } = useAction();
  // `initialValues` pre-fills the form: the category the claimant proposed (`?? undefined` turns null into
  // "no value" so the placeholder shows) and "Boutique" as the provider type. On submit, antd validates the
  // `rules` and calls `onFinish(v)` with the values; we add the claim id (`{ ...v, claimId }`) and call the
  // `approveNewListing` server action through `run`.
  return (
    <Form
      layout="inline"
      initialValues={{ category: claim.proposedCategory ?? undefined, providerType: "Boutique" }}
      onFinish={(v) => run(() => approveNewListing({ ...v, claimId: claim.id }))}
      style={{ rowGap: 8 }}
    >
      {/* Each Form.Item's `name` becomes a key in `v`; `rules: required` blocks submit while empty. The category
          options come from TAXONOMY via `.map`, turning each category into a `{ value, label }` option. */}
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

/**
 * Kind: React component.
 * @param pending  type `ClaimRow[]` — claims still waiting for a decision (here "pending" means the claims,
 *                 not the loading flag).
 * @param recent   type `ClaimRow[]` — claims decided recently, for reference.
 * @returns JSX: a card per pending claim with evidence and buttons, then a table of recent decisions.
 * Why: approving a claim gives someone edit rights over a company's public listing, so staff check identity first.
 */
export function ClaimsView({ pending, recent }: { pending: ClaimRow[]; recent: ClaimRow[] }) {
  // `{ pending: busy }` takes the hook's `pending` flag but names it `busy`, because the name `pending` is
  // already used by the prop above.
  const { run, pending: busy } = useAction();
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      {/* `` `… (${pending.length})` `` puts the number of waiting claims in the title. */}
      <Card title={`Company claims to review (${pending.length})`}>
        <Alert
          showIcon
          type="info"
          style={{ marginBottom: 16 }}
          message="Approve only when you're confident the person represents the company: matching email domain, LinkedIn, or a call to the company's switchboard."
        />
        {/* If there are no claims show an "empty" placeholder; otherwise draw one inner Card per claim with `.map`.
            For each claim we work out the company's web host and whether the claimant's email domain ends with it
            (a quick hint that they really work there; `!!site &&` makes it false when there is no website). */}
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
                {/* The card title links to the existing listing, or says "New listing: …" for an unlisted company.
                    Below, a label/value grid (1 column on phones, 2 on medium screens and up). The email gets a green
                    tag when its domain matches the website, orange when it does not. `{" "}` inserts a space. */}
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
                  {/* Existing company: Approve / Reject buttons, each behind a confirmation bubble. New company: the
                      NewListingForm (create + approve) plus a Reject button. */}
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
      {/* Recently decided claims. `render: (_, c) => …` builds a cell from the whole row `c` (the first argument,
          the cell value, is unused and named `_`). Passing `fmt` directly as `render` formats the date. */}
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

/**
 * Kind: type alias (exported for the server page).
 * One submitted client review: which provider it is about, who wrote it (private, never shown publicly), how they
 * relate to the provider, the star scores (overall + four sub-scores), title/body text, the evidence they gave,
 * automatic warning `flags` (array of texts), its `status`, whether it came from a logged-in website account,
 * and whether the verification email was already sent.
 */
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

/**
 * Kind: React component.
 * @param pending     type `ReviewRow[]` — reviews waiting for verification.
 * @param recent      type `ReviewRow[]` — reviews handled recently.
 * @param websiteUrl  type `string` — base address of the public website, used to link to the provider's page.
 * @returns JSX: one card per pending review with its details and the 1-2 step buttons, then a table of recent ones.
 * Why: reviews are only published after the reviewer confirms by email/phone, to keep scores trustworthy.
 */
export function ReviewsView({ pending, recent, websiteUrl }: { pending: ReviewRow[]; recent: ReviewRow[]; websiteUrl: string }) {
  // As in ClaimsView: rename the hook's loading flag to `busy` because `pending` is a prop.
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
              {/* Card title: the star rating (display only) and the review title; top-right: link to the provider's
                  public page (opens in a new tab). Then the reviewer's details; "since" and fund structure are only
                  added when present (ternary returning "" otherwise). */}
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
              {/* One yellow warning per automatic flag (the flag text doubles as the React `key`), then the review
                  body; `whiteSpace: "pre-wrap"` keeps the reviewer's line breaks. */}
              {r.flags.map((f) => <Alert key={f} type="warning" showIcon message={f} style={{ marginTop: 6 }} />)}
              <Typography.Paragraph style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{r.body}</Typography.Paragraph>
              {/* The two-step process: 1) email the reviewer (button text changes once sent), 2) publish once they
                  confirm (this also updates the provider's peer score). Or reject. Each calls a server action. */}
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

/**
 * Kind: type alias (exported for the server page).
 * One self-edit made by a provider's user. `changes` maps each changed field name to its old and new value,
 * e.g. `{ headcount: { from: 12, to: 15 } }`. Values are `unknown` because fields can be numbers, text or lists.
 */
export type EditRow = { id: number; providerName: string; providerId: number; userName: string | null; changes: Record<string, { from: unknown; to: unknown }>; createdAt: string };

/**
 * Kind: arrow function. Turns any stored value into display text: arrays become "a, b, c",
 * null/undefined become "—", anything else `String(v)`. (A nested ternary: `a ? x : b ? y : z`.)
 */
const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "—" : String(v));

/**
 * Kind: React component.
 * @param edits  type `EditRow[]` — recent provider self-edits.
 * @returns JSX: a table, one row per edit; expanding a row shows a small before/after table of the changed fields.
 * Why: provider edits go live immediately, so staff review them afterwards for abuse.
 */
export function EditsView({ edits }: { edits: EditRow[] }) {
  // `expandable.expandedRowRender(e)` draws the inner table for row `e`. `Object.entries(obj)` gives
  // [key, value] pairs; `.map(([field, c]) => …)` destructures each pair into one inner-table row.
  // The "Fields" column shows a Tag per changed field name (`Object.keys` = just the keys).
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
