"use client";
/**
 * FILE: apps/admin/src/components/engine-quality.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Data quality page: every quality check with its latest value, its target (min / max),
 *   pass / fail (as a labelled tag, never colour alone), a 90-day trend sparkline with a hover tooltip per day,
 *   and the completeness of each golden field. Checks are measured daily by the `quality_run` job.
 * WHERE IT RUNS: in the browser; data from lib/engine-data.ts qualityPage().
 */

import { useState } from "react";
import { Card, Col, Empty, Progress, Row, Space, Table, Tag, Typography, theme } from "antd";
import type { qualityPage } from "@/lib/engine-data";
import { fmt } from "./engine-overview";
import { QualityValue } from "./engine-pipeline";

type Data = Awaited<ReturnType<typeof qualityPage>>;

const isRatio = (code: string) => !["open_conflicts", "review_backlog"].includes(code);
const show = (code: string, v: number) => (isRatio(code) ? `${Math.round(v * 1000) / 10}%` : String(Math.round(v)));

/** Kind: React component. A one-series trend line (2px, recessive baseline) with a hover readout per point. */
function Sparkline({ code, points }: { code: string; points: { day: string; value: number }[] }) {
  const { token } = theme.useToken();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <Typography.Text type="secondary">{points.length ? "one measurement" : "—"}</Typography.Text>;
  const W = 160;
  const H = 36;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => 4 + (i / (points.length - 1)) * (W - 8);
  const y = (v: number) => H - 5 - ((v - lo) / span) * (H - 10);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const h = hover === null ? null : points[hover];
  return (
    <Space size={8}>
      <svg width={W} height={H} role="img" aria-label={`${code} trend, ${points.length} days, from ${show(code, vals[0])} to ${show(code, vals[vals.length - 1])}`} onMouseLeave={() => setHover(null)}>
        <line x1={4} x2={W - 4} y1={H - 5} y2={H - 5} stroke={token.colorBorderSecondary} strokeWidth={1} />
        <path d={d} fill="none" stroke={token.colorPrimary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && <line x1={x(hover!)} x2={x(hover!)} y1={2} y2={H - 5} stroke={token.colorTextTertiary} strokeWidth={1} />}
        {h && <circle cx={x(hover!)} cy={y(h.value)} r={4} fill={token.colorPrimary} stroke={token.colorBgContainer} strokeWidth={2} />}
        {/* Hit targets wider than the line: one band per day */}
        {points.map((p, i) => (
          <rect key={p.day} x={x(i) - W / points.length / 2} y={0} width={W / points.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 110, display: "inline-block" }}>
        {h ? `${h.day}: ${show(code, h.value)}` : `${points.length} days`}
      </Typography.Text>
    </Space>
  );
}

export function QualityView({ data }: { data: Data }) {
  const history = (code: string) => data.history.filter((h) => h.code === code);
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>Data quality</Typography.Title>
        <Typography.Text type="secondary">Measured daily by the quality_run job (Jobs page to run it now). Targets live in ops.quality_checks.</Typography.Text>
      </div>
      <Card size="small" title="Checks">
        {data.latest.length === 0 ? <Empty description="No checks configured." /> : (
          <Table
            size="small"
            rowKey="code"
            pagination={false}
            scroll={{ x: true }}
            dataSource={data.latest}
            columns={[
              { title: "Check", render: (_, q) => <Space direction="vertical" size={0}><Typography.Text strong>{q.label}</Typography.Text><Typography.Text type="secondary" style={{ fontSize: 12 }}>{q.description}</Typography.Text></Space> },
              { title: "Layer", render: (_, q) => <Tag>{q.layer}</Tag> },
              { title: "Latest", render: (_, q) => <QualityValue q={q} /> },
              { title: "Target", render: (_, q) => (q.min !== null ? `≥ ${show(q.code, q.min)}` : q.max !== null ? `≤ ${show(q.code, q.max)}` : "—") },
              { title: "Status", render: (_, q) => (q.passed === null ? <Tag>not measured</Tag> : q.passed ? <Tag color="success">✓ pass</Tag> : <Tag color="error">✕ fail</Tag>) },
              { title: "Detail", render: (_, q) => (q.denominator && q.denominator > 1 ? `${(q.numerator ?? 0).toLocaleString("en")} / ${q.denominator.toLocaleString("en")}` : "—") },
              { title: "90 days", render: (_, q) => <Sparkline code={q.code} points={history(q.code)} /> },
              { title: "Measured", render: (_, q) => fmt(q.measured_at) },
            ]}
          />
        )}
      </Card>
      <Card size="small" title="Golden record completeness (companies not struck off)">
        <Row gutter={[16, 4]}>
          {data.completeness.map((f) => (
            <Col xs={24} md={12} key={f.attribute}>
              <Row gutter={8} align="middle">
                <Col span={8}><Typography.Text>{f.attribute}</Typography.Text></Col>
                <Col span={16}><Progress percent={Math.round(f.ratio * 100)} size="small" format={(p) => `${p}% · ${f.filled.toLocaleString("en")}`} /></Col>
              </Row>
            </Col>
          ))}
        </Row>
      </Card>
    </Space>
  );
}
