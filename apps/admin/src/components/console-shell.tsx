"use client";

import {
  AuditOutlined,
  BarChartOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  FilePdfOutlined,
  InboxOutlined,
  LogoutOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  StarOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Refine } from "@refinedev/core";
import { ThemedLayout, ThemedSider, useNotificationProvider } from "@refinedev/antd";
import routerProvider from "@refinedev/nextjs-router/app";
import { Avatar, Button, Layout, Space, Tag, Typography } from "antd";
import { staffLogout } from "@/lib/auth-actions";
import { dataProvider } from "@/lib/data-provider";
import { Wordmark } from "./wordmark";

export type ShellStaff = { name: string; email: string; role: string };

/** Sidebar entries. Each maps to a page under src/app/(console). */
const RESOURCES = [
  { name: "dashboard", list: "/", meta: { label: "Dashboard", icon: <DashboardOutlined /> } },
  { name: "moderation", meta: { label: "Moderation", icon: <SafetyCertificateOutlined /> } },
  { name: "claims", list: "/claims", meta: { label: "Company claims", parent: "moderation" } },
  { name: "reviews-queue", list: "/reviews", meta: { label: "Client reviews", parent: "moderation", icon: <StarOutlined /> } },
  { name: "edits", list: "/edits", meta: { label: "Provider self-edits", parent: "moderation" } },
  { name: "requests", list: "/requests", meta: { label: "Inbox", icon: <InboxOutlined /> } },
  { name: "email", list: "/email", meta: { label: "Email", icon: <MailOutlined /> } },
  { name: "billing", list: "/billing", meta: { label: "Billing & invoices", icon: <DollarOutlined /> } },
  { name: "analytics", list: "/analytics", meta: { label: "Analytics", icon: <BarChartOutlined /> } },
  { name: "pipeline", list: "/pipeline", meta: { label: "Data pipeline", icon: <CloudDownloadOutlined /> } },
  { name: "reports-admin", list: "/reports", meta: { label: "Reports", icon: <FilePdfOutlined /> } },
  { name: "database", list: "/db", meta: { label: "Database", icon: <DatabaseOutlined /> } },
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
        <Space size={8}>
          <Avatar size="small" style={{ background: "#1a212b" }}>
            {staff.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Typography.Text>{staff.name}</Typography.Text>
        </Space>
        <form action={staffLogout}>
          <Button htmlType="submit" size="small" icon={<LogoutOutlined />}>
            Log out
          </Button>
        </form>
      </Space>
    </Layout.Header>
  );
}

export function ConsoleShell({ staff, children }: { staff: ShellStaff; children: React.ReactNode }) {
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
        Sider={(props) => <ThemedSider {...props} fixed render={({ items }) => <>{items}</>} />}
      >
        {children}
      </ThemedLayout>
    </Refine>
  );
}
