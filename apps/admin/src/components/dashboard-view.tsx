"use client";

import Link from "next/link";
import { Alert, Badge, Card, Col, List, Row, Statistic, Tag, Typography } from "antd";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import type { getDashboard } from "@/lib/metrics";

dayjs.extend(relativeTime);

type Data = Awaited<ReturnType<typeof getDashboard>>;
const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

function Tile({ title, value, href, alert, suffix }: { title: string; value: number | string; href?: string; alert?: boolean; suffix?: string }) {
  const body = (
    <Card hoverable={!!href} size="small" style={{ height: "100%" }}>
      <Statistic title={title} value={value} suffix={suffix} valueStyle={{ color: alert ? "#b45309" : "#1e2632", fontVariantNumeric: "tabular-nums" }} />
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function DashboardView({ data, staffName, denied }: { data: Data; staffName: string; denied: boolean }) {
  const c = data.counts;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Good to see you, {staffName}
      </Typography.Title>
      {denied && <Alert type="warning" showIcon message="Your role doesn't have access to that section." />}

      <Typography.Text type="secondary">Needs attention</Typography.Text>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Tile title="Company claims to review" value={c.pending_claims} href="/claims" alert={c.pending_claims > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Reviews to verify" value={c.pending_reviews} href="/reviews" alert={c.pending_reviews > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Open requests (inbox)" value={c.open_requests} href="/requests" alert={c.open_requests > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Scraped records to review" value={c.pending_ingest} href="/pipeline" alert={c.pending_ingest > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile
            title={c.gdpr_next_due ? `GDPR requests (next due ${dayjs(c.gdpr_next_due).format("D MMM")})` : "GDPR requests open"}
            value={c.gdpr_open}
            href="/gdpr"
            alert={c.gdpr_open > 0}
          />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Post drafts" value={c.post_drafts} href="/content" />
        </Col>
      </Row>

      <Typography.Text type="secondary">Business (last 30 days)</Typography.Text>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Tile title="MRR (Pro subscriptions)" value={eur(c.mrr_cents)} href="/billing" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Unpaid invoices" value={eur(c.unpaid_cents)} href="/billing" alert={c.unpaid_cents > 0} />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Requests received" value={c.requests_30d} href="/analytics" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="New accounts" value={c.visitors_30d + c.providers_30d} suffix={`(${c.providers_30d} providers)`} href="/analytics" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Published providers" value={c.providers_published} suffix={`(${c.providers_verified} verified)`} href="/db/providers" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Website accounts" value={c.accounts} href="/db/users" />
        </Col>
        <Col xs={12} md={6}>
          <Tile title="Report downloads" value={c.downloads_30d} href="/analytics" />
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={10}>
          <Card size="small" title="Data freshness" extra={<Link href="/pipeline">Pipeline</Link>}>
            <List
              size="small"
              dataSource={data.freshness}
              renderItem={(f) => (
                <List.Item>
                  <span className="mono">{f.source}</span>
                  <span>
                    {f.last_status && (
                      <Badge status={f.last_status === "succeeded" ? "success" : f.last_status === "running" ? "processing" : "error"} text={f.last_status} />
                    )}{" "}
                    <Typography.Text type="secondary">
                      {f.last_success ? `last success ${dayjs(f.last_success).fromNow()}` : "never run"}
                    </Typography.Text>
                  </span>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card size="small" title="Recent staff activity" extra={<Link href="/audit">Audit log</Link>}>
            <List
              size="small"
              locale={{ emptyText: "No activity yet" }}
              dataSource={data.recent}
              renderItem={(a) => (
                <List.Item>
                  <span>
                    <Tag>{a.action}</Tag>
                    <span className="mono">
                      {a.entity}
                      {a.entity_id ? ` #${a.entity_id}` : ""}
                    </span>
                  </span>
                  <Typography.Text type="secondary">
                    {a.staff ?? "—"} · {dayjs(a.created_at).fromNow()}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
