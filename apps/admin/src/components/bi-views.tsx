"use client";
/**
 * FILE: apps/admin/src/components/bi-views.tsx
 * PART: console (apps/admin) — Data intelligence
 * WHAT IT DOES: The browser side of the Data intelligence pages:
 *   - `BiCatalogue`: the report cards (system, restricted, team), each opening the report inside the console;
 *   - `BiDashboardView`: one Metabase dashboard in an iframe that grows to the dashboard's height;
 *   - `BiWorkspace`: links into Metabase to write SQL, build questions and make team reports;
 *   - `BiNotConfigured`: what to set when Metabase is not connected yet.
 * WHERE IT RUNS: in the browser. The signed iframe address is made on the server (src/lib/metabase.ts).
 */

import { BarChartOutlined, CodeOutlined, ExportOutlined, LockOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Row, Space, Tag, Typography } from "antd";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type BiCard = {
  id: number;
  name: string;
  description: string | null;
  kind: "system" | "restricted" | "team";
  collection: string;
};

const KIND: Record<BiCard["kind"], { label: string; color: string; icon: React.ReactNode }> = {
  system: { label: "System report", color: "blue", icon: <BarChartOutlined /> },
  restricted: { label: "Owners only", color: "red", icon: <LockOutlined /> },
  team: { label: "Team report", color: "green", icon: <TeamOutlined /> },
};

/** Kind: React component. The report catalogue. */
export function BiCatalogue({ dashboards, metabaseUrl, error }: { dashboards: BiCard[]; metabaseUrl: string; error?: string }) {
  const groups: [string, BiCard[]][] = [
    ["System reports", dashboards.filter((d) => d.kind !== "team")],
    ["Team reports", dashboards.filter((d) => d.kind === "team")],
  ];
  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Data intelligence
          </Typography.Title>
          <Typography.Text type="secondary">
            Reports over the Intelligence DB (every Luxembourg company) and the Website DB (FundHub&apos;s business).
          </Typography.Text>
        </div>
        <Space>
          <Link href="/intelligence/query">
            <Button icon={<CodeOutlined />}>Query workspace</Button>
          </Link>
          <Button type="primary" icon={<PlusOutlined />} href={`${metabaseUrl}/dashboard/new`} target="_blank" rel="noreferrer">
            New report
          </Button>
        </Space>
      </Space>
      {error && <Alert type="error" showIcon message="Metabase could not be reached" description={error} />}
      {groups.map(([title, list]) => (
        <div key={title}>
          <Typography.Title level={5}>{title}</Typography.Title>
          {list.length ? (
            <Row gutter={[16, 16]}>
              {list.map((d) => (
                <Col key={d.id} xs={24} md={12} xl={8}>
                  <Link href={`/intelligence/${d.id}`}>
                    <Card hoverable style={{ height: "100%" }}>
                      <Space direction="vertical" size={6}>
                        <Space>
                          {KIND[d.kind].icon}
                          <Typography.Text strong>{d.name}</Typography.Text>
                        </Space>
                        <Tag color={KIND[d.kind].color}>{KIND[d.kind].label}</Tag>
                        {d.description && (
                          <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ margin: 0 }}>
                            {d.description}
                          </Typography.Paragraph>
                        )}
                      </Space>
                    </Card>
                  </Link>
                </Col>
              ))}
            </Row>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                title === "Team reports"
                  ? "No team reports yet. Build a dashboard in Metabase (Team reports), then Sharing → Embed → Publish to show it here."
                  : "No system reports: run npm run bi:provision on the VM."
              }
            />
          )}
        </div>
      ))}
    </Space>
  );
}

/**
 * Kind: React component. One dashboard, embedded. Metabase tells the parent page its height with
 * `postMessage({ metabase: { type: "frame", frame: { height } } })`; the iframe follows it, so the page scrolls
 * once instead of twice.
 */
export function BiDashboardView({ name, description, src, editUrl, kind }: { name: string; description: string | null; src: string; editUrl: string; kind: BiCard["kind"] }) {
  const [height, setHeight] = useState(1200);
  const origin = useRef(new URL(src).origin);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== origin.current) return;
      const h = e.data?.metabase?.type === "frame" ? Number(e.data.metabase.frame?.height) : NaN;
      if (Number.isFinite(h) && h > 200) setHeight(Math.min(h + 16, 20000));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <div>
          <Link href="/intelligence">← Data intelligence</Link>
          <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
            {name} <Tag color={KIND[kind].color}>{KIND[kind].label}</Tag>
          </Typography.Title>
          {description && <Typography.Text type="secondary">{description}</Typography.Text>}
        </div>
        <Button icon={<ExportOutlined />} href={editUrl} target="_blank" rel="noreferrer">
          {kind === "team" ? "Edit in Metabase" : "Open in Metabase"}
        </Button>
      </Space>
      <iframe
        src={src}
        title={name}
        style={{ width: "100%", height, border: "1px solid #f0f0f0", borderRadius: 8, background: "#fff" }}
        // The embed needs scripts and its own origin (to load data); nothing else (no top navigation, no popups).
        sandbox="allow-scripts allow-same-origin allow-downloads"
        referrerPolicy="no-referrer"
      />
    </Space>
  );
}

/** Kind: React component. Entry points into Metabase's editors. */
export function BiWorkspace({ metabaseUrl, teamCollectionUrl }: { metabaseUrl: string; teamCollectionUrl: string }) {
  const tiles = [
    { title: "New SQL query", text: "Write SQL against the Intelligence DB or the Website DB (read-only). Save it as a question.", href: `${metabaseUrl}/question/notebook#?type=native`, icon: <CodeOutlined /> },
    { title: "New question", text: "Point-and-click: pick a table, filter, group, chart. No SQL needed.", href: `${metabaseUrl}/question/notebook`, icon: <BarChartOutlined /> },
    { title: "New dashboard", text: "Combine questions into a report. Save it in Team reports.", href: `${metabaseUrl}/dashboard/new`, icon: <PlusOutlined /> },
    { title: "Team reports", text: "Everything the team has saved. Switch on embedding to show a dashboard in this console.", href: teamCollectionUrl, icon: <TeamOutlined /> },
  ];
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Link href="/intelligence">← Data intelligence</Link>
        <Typography.Title level={3} style={{ margin: "4px 0 0" }}>
          Query workspace
        </Typography.Title>
        <Typography.Text type="secondary">
          Opens Metabase in a new tab (VM login with authenticator code, then your Metabase account). For a quick one-off SQL
          query, the <Link href="/db">Database</Link> page&apos;s SQL console also works.
        </Typography.Text>
      </div>
      <Row gutter={[16, 16]}>
        {tiles.map((t) => (
          <Col key={t.title} xs={24} md={12}>
            <a href={t.href} target="_blank" rel="noreferrer">
              <Card hoverable>
                <Space direction="vertical" size={4}>
                  <Space>
                    {t.icon}
                    <Typography.Text strong>{t.title}</Typography.Text>
                    <ExportOutlined style={{ fontSize: 11 }} />
                  </Space>
                  <Typography.Text type="secondary">{t.text}</Typography.Text>
                </Space>
              </Card>
            </a>
          </Col>
        ))}
      </Row>
      <Alert
        type="info"
        showIcon
        message="Show your report in the console"
        description="In Metabase, open the dashboard → Sharing (share icon) → Embed → Static embedding → Publish. It appears under Data intelligence → Team reports within 5 minutes."
      />
    </Space>
  );
}

/** Kind: React component. Shown until the Vercel settings exist. */
export function BiNotConfigured({ missing }: { missing: string[] }) {
  return (
    <Alert
      type="warning"
      showIcon
      message="Data intelligence is not connected yet"
      description={
        <>
          Set {missing.join(" and ")} on the Vercel project fund-hub-admin and redeploy. The values are on the VM in
          ~/.fundhub-secrets/ (setup: docs/data-intelligence.md).
        </>
      }
    />
  );
}
