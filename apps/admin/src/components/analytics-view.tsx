"use client";

import { Card, Col, Row, Table, Typography } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import dayjs from "dayjs";
import { categoryLabel } from "@fundhub/core/taxonomy";
import type { getAnalytics } from "@/lib/metrics";

type Data = Awaited<ReturnType<typeof getAnalytics>>;

const ACCENT = "#0f9d78";
const GRID = "#eef0f3";
const AXIS = { fontSize: 11, fill: "#8a94a3" };

/** One series, one hue: magnitude only. Exact values are in tooltips and the tables below. */
function Bars({ data, x, y, height = 220, format, layout = "horizontal" }: {
  data: Record<string, unknown>[];
  x: string;
  y: string;
  height?: number;
  format?: (v: number) => string;
  layout?: "horizontal" | "vertical";
}) {
  const vertical = layout === "vertical";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 0, left: vertical ? 8 : -12 }} barCategoryGap={vertical ? 6 : "20%"}>
        <CartesianGrid stroke={GRID} vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={format} />
            <YAxis type="category" dataKey={x} tick={AXIS} axisLine={false} tickLine={false} width={190} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={format} />
          </>
        )}
        <Tooltip cursor={{ fill: "rgba(15,157,120,0.06)" }} formatter={(v) => (format ? format(Number(v)) : String(v))} />
        <Bar dataKey={y} fill={ACCENT} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const week = (w: string) => dayjs(w).format("D MMM");
const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString("en-GB")}`;

export function AnalyticsView({ data, posthogUrl }: { data: Data; posthogUrl: string | null }) {
  const requests = data.requests.map((r) => ({ ...r, week: week(r.week), total: r.rfi + r.advisory + r.data + r.awards }));
  const signups = data.signups.map((s) => ({ ...s, week: week(s.week), total: s.visitor + s.provider }));
  const categories = data.categories.map((c) => ({ ...c, label: categoryLabel(c.category) }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>Analytics</Typography.Title>
      <Typography.Text type="secondary">
        Business data from the database. Website traffic lives in{" "}
        {posthogUrl ? <a href={posthogUrl} target="_blank" rel="noreferrer">PostHog</a> : "PostHog (set POSTHOG_URL to link it here)"}.
      </Typography.Text>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Form submissions per week (12 weeks)">
            <Bars data={requests} x="week" y="total" />
            <Table size="small" pagination={false} rowKey="week" dataSource={requests.slice(-4)} style={{ marginTop: 8 }}
              columns={[{ title: "Week", dataIndex: "week" }, { title: "Quotes", dataIndex: "rfi" }, { title: "Advisory", dataIndex: "advisory" }, { title: "Data", dataIndex: "data" }, { title: "Awards", dataIndex: "awards" }]} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="New website accounts per week (12 weeks)">
            <Bars data={signups} x="week" y="total" />
            <Table size="small" pagination={false} rowKey="week" dataSource={signups.slice(-4)} style={{ marginTop: 8 }}
              columns={[{ title: "Week", dataIndex: "week" }, { title: "Visitors", dataIndex: "visitor" }, { title: "Providers", dataIndex: "provider" }]} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Revenue collected per month (paid invoices)">
            <Bars data={data.revenue} x="month" y="paid" format={eur} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Report downloads (90 days)">
            {data.downloads.length ? <Bars data={data.downloads} x="report" y="downloads" layout="vertical" height={Math.max(120, data.downloads.length * 34)} /> : <Typography.Text type="secondary">No downloads yet.</Typography.Text>}
          </Card>
        </Col>
        <Col xs={24}>
          <Card size="small" title="Published providers by category">
            <Bars data={categories} x="label" y="providers" layout="vertical" height={categories.length * 34 + 30} />
            <Table size="small" pagination={false} rowKey="category" dataSource={categories} style={{ marginTop: 8 }}
              columns={[
                { title: "Category", dataIndex: "label" },
                { title: "Providers", dataIndex: "providers", align: "right" },
                { title: "Verified", dataIndex: "verified", align: "right" },
                { title: "Verified %", align: "right", render: (_, c) => `${Math.round((c.verified / Math.max(c.providers, 1)) * 100)}%` },
              ]} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
