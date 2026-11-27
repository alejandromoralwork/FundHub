"use client";
/**
 * FILE: apps/admin/src/components/engine-review.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The data-stewardship queue, one tab per kind of decision a person makes:
 *   - Staging approval: versions held at the APPROVAL GATE. Each shows why it was held, the field-by-field
 *     difference with the version released before, and the raw page; Approve / Edit & approve / Reject,
 *     one by one or in bulk. Approval queues `staging_release` (clean → match → core).
 *   - Matches: same name, no shared identifier — same company? (engine-matches.tsx)
 *   - Conflicts: sources disagree about a company; the golden record follows precedence until a person checks.
 *   - Mentions: news articles that may (or may not) be about a company.
 *   - Rejects: values the clean stage refused, for spotting parser or source problems.
 * WHERE IT RUNS: in the browser; data from lib/engine-data.ts reviewPage(); writes via lib/engine-actions.ts.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import type { reviewPage } from "@/lib/engine-data";
import { decideConflict, decideConflicts, decideMention, decideMentions, decideStaging, editAndApproveStaging } from "@/lib/engine-actions";
import { MatchesView } from "./engine-matches";
import { fmt, short } from "./engine-overview";
import { useAction } from "./use-action";
import { BulkBar, SELECTIONS } from "./review-bulk";

type Data = Awaited<ReturnType<typeof reviewPage>>;
type StagingRow = Data["staging"][number];

type Facts = Record<string, unknown>;
const factsOf = (p: Record<string, unknown> | null | undefined): Facts => ((p?.facts as Facts | undefined) ?? {});
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Kind: function. Field-by-field difference of the facts (and list sizes) between two versions. */
export function factDiff(prev: Record<string, unknown> | null, next: Record<string, unknown>) {
  const a = factsOf(prev);
  const b = factsOf(next);
  const rows = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => !same(a[k], b[k]))
    .map((k) => ({ key: k, field: k, before: a[k], after: b[k] }));
  for (const list of ["people", "relations", "licences", "filings", "webPresence"]) {
    const x = (prev?.[list] as unknown[] | undefined)?.length ?? 0;
    const y = (next[list] as unknown[] | undefined)?.length ?? 0;
    if (x !== y) rows.push({ key: list, field: `${list} (count)`, before: x, after: y });
  }
  return rows;
}

/** Kind: React component. The staging approval tab. */
function StagingTab({ rows, canEdit, sources, source }: { rows: StagingRow[]; canEdit: boolean; sources: string[]; source?: string }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [editing, setEditing] = useState<StagingRow | null>(null);
  const [editText, setEditText] = useState("");
  const [note, setNote] = useState("");

  const openEdit = (r: StagingRow) => {
    setEditing(r);
    setEditText(JSON.stringify({ facts: factsOf(r.payload), people: r.payload.people, relations: r.payload.relations, webPresence: r.payload.webPresence }, null, 2));
  };
  const submitEdit = () => {
    let edited: Record<string, unknown>;
    try {
      edited = JSON.parse(editText);
    } catch {
      return Modal.error({ title: "Not valid JSON", content: "Fix the edited version before approving." });
    }
    run(async () => {
      const res = await editAndApproveStaging(editing!.id, edited, note || undefined);
      if (!res.error) setEditing(null);
      return res;
    });
  };

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="Records held at the approval gate"
        description="Nothing below has reached the golden record yet. Approve to release it; Edit & approve to correct it first (corrected fields become staff values that win and can be cleared later); Reject to stop it (kept for audit). Policies decide what is held: Sources page."
      />
      <Space wrap>
        <Select allowClear placeholder="All sources" style={{ width: 200 }} value={source} options={sources.map((s) => ({ value: s, label: s }))}
          onChange={(v) => router.push(`/engine/review?tab=staging${v ? `&source=${v}` : ""}`)} />
        {canEdit && (
          <>
            <Button type="primary" disabled={!selected.length} loading={pending} onClick={() => run(() => decideStaging({ ids: selected, decision: "approve" }))}>Approve selected ({selected.length})</Button>
            <Popconfirm title={`Reject ${selected.length} version(s)?`} onConfirm={() => run(() => decideStaging({ ids: selected, decision: "reject" }))} disabled={!selected.length}>
              <Button danger disabled={!selected.length} loading={pending}>Reject selected</Button>
            </Popconfirm>
          </>
        )}
      </Space>
      {rows.length === 0 ? (
        <Empty description="Nothing waiting for approval." />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          rowSelection={canEdit ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as number[]), selections: SELECTIONS } : undefined}
          expandable={{
            defaultExpandedRowKeys: rows.slice(0, 3).map((r) => r.id),
            expandedRowRender: (r) => (
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={factDiff(r.released, r.payload)}
                locale={{ emptyText: r.released ? "No field changed (lists or details only)." : "First version from this source." }}
                columns={[
                  { title: "Field", dataIndex: "field", width: 180 },
                  { title: "Released before", render: (_, d) => <Typography.Text type="secondary">{short(d.before)}</Typography.Text> },
                  { title: "This version", render: (_, d) => <Typography.Text strong>{short(d.after)}</Typography.Text> },
                ]}
              />
            ),
          }}
          columns={[
            { title: "Held", dataIndex: "created_at", render: fmt, width: 140 },
            {
              title: "Record",
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <span><Tag>{r.source}</Tag><span className="mono">{r.external_id}</span></span>
                  <strong>{String(factsOf(r.payload).name ?? "—")}</strong>
                  {r.company_id ? <Link href={`/engine/companies/${r.company_id}`}>{r.company_name}</Link> : <Typography.Text type="secondary">not linked yet</Typography.Text>}
                </Space>
              ),
            },
            { title: "Why held", render: (_, r) => <Space direction="vertical" size={2}>{(r.reasons ?? []).map((x) => <Tag color="orange" key={x}>{x}</Tag>)}</Space> },
            { title: "Raw", render: (_, r) => (r.fetch_url ? <a href={r.fetch_url} target="_blank" rel="noreferrer">page</a> : "—"), width: 60 },
            {
              title: "",
              width: 250,
              render: (_, r) =>
                canEdit && (
                  <Space>
                    <Button size="small" type="primary" loading={pending} onClick={() => run(() => decideStaging({ ids: [r.id], decision: "approve" }))}>Approve</Button>
                    <Button size="small" onClick={() => openEdit(r)}>Edit…</Button>
                    <Popconfirm title="Reject this version?" onConfirm={() => run(() => decideStaging({ ids: [r.id], decision: "reject" }))}>
                      <Button size="small" danger loading={pending}>Reject</Button>
                    </Popconfirm>
                  </Space>
                ),
            },
          ]}
        />
      )}
      <Modal open={!!editing} width={760} title={`Edit & approve — ${editing?.source} ${editing?.external_id}`} okText="Approve with corrections" onOk={submitEdit} onCancel={() => setEditing(null)} confirmLoading={pending}>
        <Typography.Paragraph type="secondary">Correct the facts (and remove wrong people, clients or profiles). Identifiers cannot be changed here.</Typography.Paragraph>
        <Input.TextArea value={editText} onChange={(e) => setEditText(e.target.value)} rows={18} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
        <Input style={{ marginTop: 8 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Modal>
    </Space>
  );
}

/** Kind: React component. Conflicts tab: one row per disagreement; Checked / Ignore one at a time or in bulk. */
function ConflictsTab({ rows, canEdit }: { rows: Data["conflicts"]; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <Card size="small" title="Sources disagree" extra={<Typography.Text type="secondary">The golden record uses the winner (precedence). Check, then correct on the company page if needed.</Typography.Text>}>
      {rows.length === 0 ? <Empty description="No open conflicts." /> : (
        <>
          {canEdit && (
            <BulkBar selected={selected} clear={() => setSelected([])} actions={[
              { label: "Mark checked", primary: true, run: (ids) => decideConflicts(ids, "resolved") },
              { label: "Ignore", confirm: "Ignore {n} conflict(s)? They will not be raised again.", run: (ids) => decideConflicts(ids, "ignored") },
            ]} />
          )}
          <Table size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 25 }}
            rowSelection={canEdit ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as number[]), selections: SELECTIONS } : undefined}
            columns={[
              { title: "Company", render: (_, c) => <Link href={`/engine/companies/${c.company_id}`}>{c.company_name}</Link> },
              { title: "Field", dataIndex: "attribute", filters: [...new Set(rows.map((r) => r.attribute))].map((a) => ({ text: a, value: a })), onFilter: (v, r) => r.attribute === v },
              { title: "What each source says", render: (_, c) => <Space direction="vertical" size={2}>{c.values.map((v) => <span key={v.source}><Tag color={v.source === c.winner ? "green" : undefined}>{v.source}{v.source === c.winner ? " (used)" : ""}</Tag>{short(v.value)}</span>)}</Space> },
              { title: "Since", dataIndex: "detected_at", render: fmt, width: 140 },
              { title: "", width: 180, render: (_, c) => canEdit && <Space><Button size="small" loading={pending} onClick={() => run(() => decideConflict(c.id, "resolved"))}>Checked</Button><Button size="small" loading={pending} onClick={() => run(() => decideConflict(c.id, "ignored"))}>Ignore</Button></Space> },
            ]} />
        </>
      )}
    </Card>
  );
}

/** Kind: React component. Mentions tab: is this article about the company? One at a time or in bulk. */
function MentionsTab({ rows, canEdit }: { rows: Data["mentions"]; canEdit: boolean }) {
  const { run, pending } = useAction();
  const [selected, setSelected] = useState<number[]>([]);
  return (
    <Card size="small" title="Is this article about the company?">
      {rows.length === 0 ? <Empty description="No uncertain mentions." /> : (
        <>
          {canEdit && (
            <BulkBar selected={selected} clear={() => setSelected([])} actions={[
              { label: "About it", primary: true, run: (ids) => decideMentions(ids, true) },
              { label: "Not about it", run: (ids) => decideMentions(ids, false) },
            ]} />
          )}
          <Table size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 25 }}
            rowSelection={canEdit ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as number[]), selections: SELECTIONS } : undefined}
            columns={[
              { title: "Article", render: (_, m) => <Space direction="vertical" size={0}><a href={m.url} target="_blank" rel="noreferrer">{m.title}</a><Typography.Text type="secondary">{m.snippet ?? ""}</Typography.Text></Space> },
              { title: "Company", render: (_, m) => <Space direction="vertical" size={0}><Link href={`/engine/companies/${m.company_id}`}>{m.company_name}</Link><Typography.Text type="secondary">matched “{m.matched_text}” · {Math.round(m.confidence * 100)}%</Typography.Text></Space> },
              { title: "Published", dataIndex: "published_at", render: fmt, width: 140 },
              { title: "", width: 190, render: (_, m) => canEdit && <Space><Button size="small" type="primary" loading={pending} onClick={() => run(() => decideMention(m.id, true))}>About it</Button><Button size="small" loading={pending} onClick={() => run(() => decideMention(m.id, false))}>Not about it</Button></Space> },
            ]} />
        </>
      )}
    </Card>
  );
}

/** Kind: React component. The page with its tabs (tab in the URL: ?tab=staging|matches|conflicts|mentions|rejects). */
export function ReviewView({ data, canEdit, tab = "staging", source }: { data: Data; canEdit: boolean; tab?: string; source?: string }) {
  const router = useRouter();
  const sources = useMemo(() => [...new Set(data.staging.map((r) => r.source))].sort(), [data.staging]);
  const count = (n: number) => <Badge count={n} overflowCount={999} style={{ marginLeft: 6 }} />;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>Review</Typography.Title>
        <Typography.Text type="secondary">Every decision the pipeline leaves to a person, in one place.</Typography.Text>
      </div>
      <Tabs
        activeKey={tab}
        onChange={(k) => router.push(`/engine/review?tab=${k}`)}
        items={[
          { key: "staging", label: <>Staging approval{count(data.staging.length)}</>, children: <StagingTab rows={data.staging} canEdit={canEdit} sources={sources} source={source} /> },
          { key: "matches", label: <>Matches{count(data.matches.length)}</>, children: <MatchesView rows={data.matches} canEdit={canEdit} /> },
          { key: "conflicts", label: <>Conflicts{count(data.conflicts.length)}</>, children: <ConflictsTab rows={data.conflicts} canEdit={canEdit} /> },
          { key: "mentions", label: <>Mentions{count(data.mentions.length)}</>, children: <MentionsTab rows={data.mentions} canEdit={canEdit} /> },
          {
            key: "rejects",
            label: <>Rejects{count(data.rejects.length)}</>,
            children: (
              <Card size="small" title="Values refused by the clean stage (latest 300)">
                {data.rejects.length === 0 ? <Empty description="No rejected values." /> : (
                  <Table size="small" rowKey="id" dataSource={data.rejects} pagination={{ pageSize: 25 }} columns={[
                    { title: "When", dataIndex: "created_at", render: fmt, width: 140 },
                    { title: "Record", render: (_, r) => <span><Tag>{r.source}</Tag><span className="mono">{r.external_id}</span>{r.company_id && <> · <Link href={`/engine/companies/${r.company_id}`}>company</Link></>}</span> },
                    { title: "Field", dataIndex: "attribute" },
                    { title: "Value", render: (_, r) => <span className="mono">{short(r.value)}</span> },
                    { title: "Reason", dataIndex: "reason" },
                  ]} />
                )}
              </Card>
            ),
          },
        ]}
      />
    </Space>
  );
}
