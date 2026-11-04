"use client";
/**
 * FILE: apps/admin/src/components/console-shell.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The frame around every signed-in Console page: the left sidebar menu (Dashboard, Moderation,
 *   Inbox, Billing…), the top bar (role tag, the staff member's name linking to account security, and a
 *   "Log out" button), and the area where each page's own content is shown. It also starts Refine, the
 *   admin framework the Console is built on.
 * WHERE IT RUNS: in the browser (`"use client"`), because the sidebar can collapse/expand and Refine keeps
 *   its state in the browser. The server-side layout file passes in who is signed in.
 * FRAMEWORK NOTES:
 *   - Refine (`@refinedev/…`) is an open-source framework for admin panels. You give it "resources" (the
 *     sections of the app), a "router provider" (how to change pages: here Next.js's router), a "data
 *     provider" (how to load and save records) and a "notification provider" (how to show pop-up messages).
 *     It then builds the menu and wiring for you.
 *   - `@refinedev/antd` gives Refine pieces drawn with Ant Design: `ThemedLayout` (the overall page frame)
 *     and `ThemedSider` (the sidebar menu built from the resources list).
 *   - `children` is React's name for "whatever is placed between this component's opening and closing tags",
 *     here: the current page.
 *   - A "render prop" is a prop that is itself a function returning JSX, letting us customise part of
 *     someone else's component (used for `Title`, `Header`, `Sider` below).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - exported type aliases (`ShellStaff`, `ShellTool`); optional prop with default `tools = []`;
 *   - `React.ReactNode` = "anything React can display" (elements, text, lists, nothing);
 *   - arrow functions returning JSX, `{...props}` spread (pass every field of `props` on as props),
 *     `&&` and ternaries for conditional display, `.map` to draw lists with `key`s.
 */

// `import { a } from "b"` brings named things in from another module. Plain names are npm libraries;
// `@/…` = this app's src folder; `./…` = same folder.

// Icons from Ant Design's icon set, one for each sidebar entry, plus "export" (open in new tab) and
// "logout" icons.
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
// Next.js link component: changes page without a full reload.
import Link from "next/link";
// `Refine`: the root component of the Refine admin framework (see FRAMEWORK NOTES).
import { Refine } from "@refinedev/core";
// Refine's Ant Design layout, sidebar, and the adapter that shows Refine notifications with antd pop-ups.
import { ThemedLayout, ThemedSider, useNotificationProvider } from "@refinedev/antd";
// Connects Refine to the Next.js "app" router, so menu clicks change the Next.js page.
import routerProvider from "@refinedev/nextjs-router/app";
// antd UI pieces for the top bar.
import { Avatar, Button, Layout, Space, Tag, Typography } from "antd";
// Server action that signs the staff member out (clears their session on the server).
import { staffLogout } from "@/lib/auth-actions";
// Our own data provider: tells Refine how to fetch and save records for this app.
import { dataProvider } from "@/lib/data-provider";
// The FundHub logo/wordmark component.
import { Wordmark } from "./wordmark";

/**
 * Kind: type alias (exported so the server layout can build one).
 * The signed-in staff member as the shell needs it: display name, email and role (e.g. "owner", "editor").
 */
export type ShellStaff = { name: string; email: string; role: string };
/**
 * Kind: type alias.
 * Self-hosted open-source tools (only the configured ones are passed in).
 * One external tool link for the bottom of the sidebar: its label and web address.
 */
export type ShellTool = { label: string; href: string };

/**
 * Kind: React component (private to this file).
 * The "Open tools" block at the bottom of the sidebar: one link per external tool, opening in a new tab.
 * @param tools      `ShellTool[]` — the tools to list.
 * @param collapsed  `boolean` — is the sidebar folded down to icons only? Then only icons are shown.
 * @returns          JSX for the block, or `null` (nothing) when there are no tools.
 */
function ToolLinks({ tools, collapsed }: { tools: ShellTool[]; collapsed: boolean }) {
  // An empty list has length 0, which counts as false, so `!tools.length` means "no tools".
  if (!tools.length) return null;
  return (
    // Less side padding when collapsed; a thin grey line above separates it from the menu.
    <div style={{ padding: collapsed ? "8px 4px" : "8px 16px", borderTop: "1px solid #f0f0f0", marginTop: 8 }}>
      {/* The small "OPEN TOOLS" heading, hidden when collapsed. */}
      {!collapsed && <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Open tools</Typography.Text>}
      {/* `.map` draws one link per tool. `key={t.href}` gives React a unique id per item in the list. */}
      {tools.map((t) => (
        <a key={t.href} href={t.href} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13, color: "inherit" }}>
          <ExportOutlined />
          {!collapsed && t.label}
        </a>
      ))}
    </div>
  );
}

/**
 * Kind: constant (an array of Refine "resources").
 * Sidebar entries. Each maps to a page under src/app/(console).
 * Each entry: `name` = Refine's internal id; `list` = the page address for that section (the Console runs
 * under /admin, which Next.js adds automatically); `meta.label` = the menu text; `meta.icon` = JSX for its
 * icon; `meta.parent` = the name of the group it sits under. "moderation" has no `list`, so it is only a
 * folding group heading for its three children.
 */
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

/**
 * Kind: React component (private).
 * The top bar: role tag, avatar + name (a link to the account security page) and the Log out button.
 * @param staff  `ShellStaff` — the signed-in staff member.
 * @returns      JSX for the header bar.
 */
function Header({ staff }: { staff: ShellStaff }) {
  return (
    // `Layout.Header` is antd's top-bar area. The flex styles push its content to the right edge.
    <Layout.Header
      style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", padding: "0 24px", borderBottom: "1px solid #eef0f3", height: 56 }}
    >
      <Space size="middle">
        <Tag color="green">{staff.role}</Tag>
        {/* `title` is the tooltip shown when hovering. */}
        <Link href="/account" title="Account security: password and two-factor">
          <Space size={8}>
            {/* A round avatar with the first letter of the name: `.slice(0, 1)` takes the first character,
                `.toUpperCase()` capitalises it. */}
            <Avatar size="small" style={{ background: "#1a212b" }}>
              {staff.name.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography.Text>{staff.name}</Typography.Text>
          </Space>
        </Link>
        {/* Logging out is a tiny form whose `action` is the `staffLogout` server action: clicking the
            submit button runs it on the server, which ends the session and sends the user to the login page. */}
        <form action={staffLogout}>
          <Button htmlType="submit" size="small" icon={<LogoutOutlined />}>
            Log out
          </Button>
        </form>
      </Space>
    </Layout.Header>
  );
}

/**
 * Kind: React component (exported; used by the Console's signed-in layout).
 * @param staff     `ShellStaff` — who is signed in.
 * @param tools     optional `ShellTool[]` — external tool links; `= []` makes it an empty list when not given.
 * @param children  `React.ReactNode` — the current page's content, shown in the main area.
 * @returns         JSX: Refine set up with our providers, wrapping the themed layout and the page.
 */
export function ConsoleShell({ staff, tools = [], children }: { staff: ShellStaff; tools?: ShellTool[]; children: React.ReactNode }) {
  return (
    // Start Refine with its four building blocks (see FRAMEWORK NOTES). Options:
    // `syncWithLocation` keeps table filters/pages in the address bar; `warnWhenUnsavedChanges` asks before
    // leaving a half-filled form; `disableTelemetry` stops Refine sending anonymous usage data to its makers.
    <Refine
      routerProvider={routerProvider}
      dataProvider={dataProvider}
      notificationProvider={useNotificationProvider}
      resources={RESOURCES}
      options={{ syncWithLocation: true, warnWhenUnsavedChanges: true, disableTelemetry: true }}
    >
      {/* The page frame. Each prop below is a "render prop" (a function returning JSX):
          - `Title`: the logo at the top of the sidebar; when collapsed, the wordmark without its suffix text.
          - `Header`: our own top bar from above.
          - `Sider`: Refine's sidebar, given all the props Refine passed in (`{...props}` spread), kept fixed
            in place while the page scrolls, and with a custom `render` that shows the normal menu `items`
            followed by our "Open tools" block. `<>…</>` is a fragment (groups elements, adds nothing). */}
      <ThemedLayout
        Title={({ collapsed }) => (collapsed ? <Wordmark suffix="" /> : <Wordmark />)}
        Header={() => <Header staff={staff} />}
        Sider={(props) => <ThemedSider {...props} fixed render={({ items, collapsed }) => <>{items}<ToolLinks tools={tools} collapsed={collapsed} /></>} />}
      >
        {/* The current page goes here. */}
        {children}
      </ThemedLayout>
    </Refine>
  );
}
