"use client";
/**
 * FILE: apps/admin/src/components/engine-pipeline.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Company Intelligence "Pipeline" page: headline KPIs (companies, cross-checked share,
 *   waiting for approval, open conflicts, failing quality checks), the interactive dataflow diagram
 *   (pipeline-diagram.tsx), coverage per source, field completeness of the golden records, the latest data
 *   quality, then the operational cards (census, sessions, queue, runs, change feed: engine-overview.tsx).
 * WHERE IT RUNS: in the browser; data from lib/engine-data.ts pipelineOverview() + currentRound().
 */

import Link from "next/link";
import { Card, Col, Progress, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import type { currentRound, pipelineOverview } from "@/lib/engine-data";
import { EngineOverview, fmt } from "./engine-overview";
import { PipelineDiagram } from "./pipeline-diagram";

type Data = Awaited<ReturnType<typeof pipelineOverview>>;
type Round = Awaited<ReturnType<typeof currentRound>>;

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 1000) / 10}%`);

/** Kind: React component. Quality check value, formatted as a ratio or a count. */
export function QualityValue({ q }: { q: { value: number | null; min: number | null; max: number | null; passed: boolean | null; numerator: number | null; denominator: number | null } }) {
  const isCount = q.denominator === 1;
  const v = q.value === null ? "not measured" : isCount ? String(q.numerator) : pct(q.value);
  return <Tag color={q.passed === null ? "default" : q.passed ? "green" : "red"}>{v}</Tag>;
}

export function PipelineView({ data, round }: { data: Data; round: Round }) {
  const m = data.metrics;
  const companies = m["core.companies"] ?? 0;
  const failing = data.quality.filter((q) => q.passed === false).length;
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>Company intelligence — pipeline</Typography.Title>
        <Typography.Text type="secondary">
          Every Luxembourg company, cross-checked across registers, the CSSF, FundHub accounts, company websites and the news. Data flows left to right; nothing reaches the golden record without passing the clean and match stages, and the optional approval gate.
        </Typography.Text>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Companies" value={companies} /></Card></Col>
        <Col xs={12} md={8} lg={4}><Card size="small"><Statistic title="Service providers" value={m["core.service_providers"] ?? 0} /></Card></Col>
        <Col xs={12} md={8} lg={4}><Card size="small"><Tooltip title="Companies stated by two or more sources"><Statistic title="Cross-checked" value={companies ? Math.round(((m["core.multi_source"] ?? 0) / companies) * 100) : 0} suffix="%" /></Tooltip></Card></Col>
        <Col xs={12} md={8} lg={4}><Card size="small"><Link href="/engine/review?tab=staging"><Statistic title="Waiting for approval" value={m["staging.pending_review"] ?? 0} valueStyle={m["staging.pending_review"] ? { color: "#d97706" } : undefined} /></Link></Card></Col>
        <Col xs={12} md={8} lg={4}><Card size="small"><Link href="/engine/review?tab=conflicts"><Statistic title="Open conflicts" value={m["match.conflicts_open"] ?? 0} valueStyle={m["match.conflicts_open"] ? { color: "#d97706" } : undefined} /></Link></Card></Col>
        <Col xs={12} md={8} lg={4}><Card size="small"><Link href="/engine/quality"><Statistic title="Quality checks failing" value={failing} suffix={`/ ${data.quality.length}`} valueStyle={failing ? { color: "#dc2626" } : undefined} /></Link></Card></Col>
      </Row>

      <PipelineDiagram metrics={m} coverage={data.coverage} />

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          <Card size="small" title="Coverage by source" extra={<Link href="/engine/sources">Sources →</Link>}>
            <Table
              size="small"
              rowKey="source"
              pagination={false}
              dataSource={data.coverage}
              scroll={{ x: true }}
              columns={[
                { title: "Source", render: (_, r) => <Space size={4}><span>{r.name}</span>{!r.enabled && <Tag>off</Tag>}</Space> },
                { title: "System", dataIndex: "system" },
                { title: "Records", align: "right", render: (_, r) => r.found.toLocaleString("en") },
                { title: "Linked", align: "right", render: (_, r) => (r.found ? pct(r.linked / r.found) : "—") },
                { title: "Gate", align: "right", render: (_, r) => (r.pending_review ? <Link href={`/engine/review?tab=staging&source=${r.source}`}><Tag color="orange">{r.pending_review}</Tag></Link> : "—") },
                { title: "Last run", render: (_, r) => fmt(r.last_run_at) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="Golden record completeness (companies not struck off)">
            <Space direction="vertical" style={{ width: "100%" }} size={2}>
              {data.completeness.map((f) => (
                <Row key={f.attribute} gutter={8} align="middle">
                  <Col span={8}><Typography.Text>{f.attribute}</Typography.Text></Col>
                  <Col span={16}><Progress percent={Math.round(f.ratio * 100)} size="small" format={() => `${f.filled.toLocaleString("en")}`} /></Col>
                </Row>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Data quality (latest measurement)" extra={<Link href="/engine/quality">History →</Link>}>
        <Space wrap size={[16, 8]}>
          {data.quality.map((q) => (
            <Tooltip key={q.code} title={q.description}>
              <Space size={4}>
                <Typography.Text>{q.label}</Typography.Text>
                <QualityValue q={q} />
              </Space>
            </Tooltip>
          ))}
        </Space>
      </Card>

      <EngineOverview data={data.dashboard} round={round} />
    </Space>
  );
}
