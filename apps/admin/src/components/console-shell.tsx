"use client";

import {
  AuditOutlined,
  BarChartOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  EditOutlined,
  ExportOutlined,
  LockOutlined,
  WalletOutlined,
  FilePdfOutlined,
  InboxOutlined,
  LogoutOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import { Refine } from "@refinedev/core";
import { ThemedLayout, ThemedSider, useNotificationProvider } from "@refinedev/antd";
import routerProvider from "@refinedev/nextjs-router/app";
import { Avatar, Button, Layout, Space, Tag, Typography } from "antd";
import { staffLogout } from "@/lib/auth-actions";
import { dataProvider } from "@/lib/data-provider";
import { Wordmark } from "./wordmark";

export type ShellStaff = { name: string; email: string; role: string };
/** Self-hosted open-source tools (only the configured ones are passed in). */
export type ShellTool = { label: string; href: string };

function ToolLinks({ tools, collapsed }: { tools: ShellTool[]; collapsed: boolean }) {
  if (!tools.length) return null;
  return (
    <div style={{ padding: collapsed ? "8px 4px" : "8px 16px", borderTop: "1px solid #f0f0f0", marginTop: 8 }}>
      {!collapsed && <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Open tools</Typography.Text>}
      {tools.map((t) => (
        <a key={t.href} href={t.href} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13, color: "inherit" }}>
          <ExportOutlined />
          {!collapsed && t.label}
        </a>
      ))}
    </div>
  );
}

/** Sidebar entries. Each maps to a page under src/app/(console). */
const RESOURCES = [
  { name: "dashboard", list: "/", meta: { label: "Dashboard", icon: <DashboardOutlined /> } },
  { name: "moderation", meta: { label: "Moderation", icon: <SafetyCertificateOutlined /> } },
  { name: "claims", list: "/claims", meta: { label: "Company claims", parent: "moderation" } },
  { name: "reviews-queue", list: "/reviews", meta: { label: "Client reviews", parent: "moderation", icon: <StarOutlined /> } },
  { name: "edits", list: "/edits", meta: { label: "Provider self-edits", parent: "moderation" } },
  { name: "requests", list: "/requests", meta: { label: "Inbox", icon: <InboxOutlined /> } },
  { name: "email", list: "/email", meta: { label: "Email", icon: <MailOutlined /> } },
  { name: "content", list: "/content", meta: { label: "Content studio", icon: <EditOutlined /> } },
  { name: "billing", list: "/billing", meta: { label: "Billing & invoices", icon: <DollarOutlined /> } },
  { name: "finance", list: "/finance", meta: { label: "Finance", icon: <WalletOutlined /> } },
  { name: "analytics", list: "/analytics", meta: { label: "Analytics", icon: <BarChartOutlined /> } },
  { name: "pipeline", list: "/pipeline", meta: { label: "Data pipeline", icon: <CloudDownloadOutlined /> } },
  { name: "reports-admin", list: "/reports", meta: { label: "Reports", icon: <FilePdfOutlined /> } },
  { name: "database", list: "/db", meta: { label: "Database", icon: <DatabaseOutlined /> } },
  { name: "gdpr", list: "/gdpr", meta: { label: "GDPR requests", icon: <LockOutlined /> } },
  { name: "staff", list: "/staff", meta: { label: "Staff", icon: <TeamOutlined /> } },
  { name: "audit", list: "/audit", meta: { label: "Audit log", icon: <AuditOutlined /> } },
];

function Header({ staff }: { staff: ShellStaff }) {
  return (
    <Layout.Header
      style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "0 24px", borderBottom: "1px solid #eef0f3", height: 56 }}
    >
      <Space size="middle">
        <Tag color="green">{staff.role}</Tag>
        <Link href="/account" title="Account security: password and two-factor">
          <Space size={8}>
            <Avatar size="small" style={{ background: "#1a212b" }}>
              {staff.name.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography.Text>{staff.name}</Typography.Text>
          </Space>
        </Link>
        <form action={staffLogout}>
          <Button htmlType="submit" size="small" icon={<LogoutOutlined />}>
            Log out
          </Button>
        </form>
      </Space>
    </Layout.Header>
  );
}

export function ConsoleShell({ staff, tools = [], children }: { staff: ShellStaff; tools?: ShellTool[]; children: React.ReactNode }) {
  return (
    <Refine
      routerProvider={routerProvider}
      dataProvider={dataProvider}
      notificationProvider={useNotificationProvider}
      resources={RESOURCES}
      options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, disableTelemetry: true }}
    >
      <ThemedLayout
        Title={({ collapsed }) => (collapsed ? <Wordmark suffix="" /> : <Wordmark />)}
        Header={() => <Header staff={staff} />}
        Sider={(props) => <ThemedSider {...props} fixed render={({ items, collapsed }) => <>{items}<ToolLinks tools={tools} collapsed={collapsed} /></>} />}
      >
        {children}
      </ThemedLayout>
    </Refine>
  );
}
