"use client";
/**
 * FILE: apps/admin/src/components/engine-matches.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Match review. When a record arrives with no shared identifier (RCS no., LEI, CSSF code) but the
 *   same name as an existing entity in a different place, the engine keeps them apart and asks a person.
 *   "Same company" merges the two entities (identifiers, names, sources, history all move); "Different" keeps
 *   them apart for good.
 * WHERE IT RUNS: in the browser (client component), rendered by app/(console)/engine/matches/page.tsx.
 */

import Link from "next/link";
import { Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography } from "antd";
import type { pendingMatches } from "@/lib/engine-data";
import { decideMatch } from "@/lib/engine-actions";
import { fmt } from "./engine-overview";
import { useAction } from "./use-action";

type Rows = Awaited<ReturnType<typeof pendingMatches>>;

/** Kind: React component. The page. */
export function MatchesView({ rows, canEdit }: { rows: Rows; canEdit: boolean }) {
  const { run, pending } = useAction();
  return (
    <Card title={`Match review (${rows.length})`} extra={<Typography.Text type="secondary">Same name, no shared identifier — is it the same company?</Typography.Text>}>
      {rows.length === 0 ? (
        <Empty description="Nothing to review." />
      ) : (
        <Table size="small" rowKey="id" dataSource={rows} pagination={{ pageSize: 25 }}
          columns={[
            { title: "Found", dataIndex: "created_at", render: fmt, width: 140 },
            {
              title: "New record",
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <span><Tag>{r.record_source}</Tag><span className="mono">{r.record_external_id}</span></span>
                  <strong>{r.record_name ?? "—"}</strong>
                  <Typography.Text type="secondary">{r.record_address ?? ""}</Typography.Text>
                  {r.record_entity_id && <Link href={`/engine/registry/${r.record_entity_id}`}>its entity: {r.record_entity_name}</Link>}
                </Space>
              ),
            },
            {
              title: "Existing entity",
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <Link href={`/engine/registry/${r.candidate_entity_id}`}><strong>{r.candidate_name}</strong></Link>
                  <span className="mono">{r.candidate_rcs ?? "no RCS no."}</span>
                  <Typography.Text type="secondary">{r.candidate_address ?? ""}</Typography.Text>
                </Space>
              ),
            },
            { title: "Why", render: (_, r) => <Space direction="vertical" size={0}><Tag>{r.method}</Tag><span>{Math.round(r.score * 100)}%</span></Space>, width: 110 },
            {
              title: "",
              width: 200,
              render: (_, r) =>
                canEdit && (
                  <Space>
                    <Popconfirm title="Merge these into one entity? This moves all identifiers, sources and history." onConfirm={() => run(() => decideMatch(r.id, true))}>
                      <Button size="small" type="primary" loading={pending}>Same company</Button>
                    </Popconfirm>
                    <Button size="small" loading={pending} onClick={() => run(() => decideMatch(r.id, false))}>Different</Button>
                  </Space>
                ),
            },
          ]} />
      )}
    </Card>
  );
}
