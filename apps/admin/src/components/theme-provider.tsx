"use client";

import { ConfigProvider, App as AntApp } from "antd";

/** FundHub brand on Ant Design: ink + emerald, compact data density. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#0f9d78",
          colorLink: "#0c8265",
          colorTextBase: "#1e2632",
          borderRadius: 6,
          fontFamily: '"Inter Variable", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
        },
        components: { Layout: { siderBg: "#1a212b", headerBg: "#ffffff" }, Menu: { darkItemBg: "#1a212b", darkSubMenuItemBg: "#141a22" } },
      }}
      componentSize="middle"
    >
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
