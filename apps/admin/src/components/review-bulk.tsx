"use client";
/**
 * FILE: apps/admin/src/components/review-bulk.tsx
 * PART: console (apps/admin) — Company intelligence → Review
 * WHAT IT DOES: The bulk toolbar shared by the review tabs (staging, matches, conflicts, mentions): "N selected"
 *   and one button per decision, plus the row-selection shortcuts (all pages / invert / none).
 * WHERE IT RUNS: in the browser.
 */

import { Button, Popconfirm, Space, Table, Typography } from "antd";
import { useAction } from "./use-action";

/** Kind: constant. Row-selection shortcuts: all rows on every page, invert, none. */
export const SELECTIONS = [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE];

/**
 * Kind: React component. The bulk toolbar above a review table: "N selected" + one button per decision.
 * Each action receives the selected ids; the selection clears when it succeeds.
 */
export function BulkBar({ selected, clear, actions }: {
  selected: number[];
  clear: () => void;
  actions: { label: string; danger?: boolean; primary?: boolean; confirm?: string; run: (ids: number[]) => Promise<{ ok?: string; error?: string }> }[];
}) {
  const { run, pending } = useAction();
  const go = (a: (typeof actions)[number]) => run(async () => { const r = await a.run(selected); if (!r.error) clear(); return r; });
  return (
    <Space wrap style={{ marginBottom: 8 }}>
      <Typography.Text type="secondary">{selected.length ? `${selected.length} selected` : "Select rows (header checkbox ▾ = all pages) for bulk actions"}</Typography.Text>
      {actions.map((a) =>
        a.confirm ? (
          <Popconfirm key={a.label} title={a.confirm.replace("{n}", String(selected.length))} onConfirm={() => go(a)} disabled={!selected.length}>
            <Button size="small" danger={a.danger} type={a.primary ? "primary" : "default"} disabled={!selected.length} loading={pending}>{a.label} ({selected.length})</Button>
          </Popconfirm>
        ) : (
          <Button key={a.label} size="small" danger={a.danger} type={a.primary ? "primary" : "default"} disabled={!selected.length} loading={pending} onClick={() => go(a)}>{a.label} ({selected.length})</Button>
        ),
      )}
    </Space>
  );
}

