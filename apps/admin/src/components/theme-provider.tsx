"use client";

/**
 * FILE: apps/admin/src/components/theme-provider.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Wraps the whole Console in Ant Design's theme settings so every antd button, table and menu
 *   uses FundHub's brand colours (dark "ink" and emerald green), font and corner rounding.
 * WHERE IT RUNS: in the browser ("use client"), because antd's ConfigProvider and App use React context
 *   and hooks, which only work in client components.
 * FRAMEWORK NOTES:
 *   - Ant Design (antd) is a library of ready-made UI components. `ConfigProvider` sets global options for
 *     all antd components inside it. Its `theme.token` values are "design tokens" (base colours, radius…);
 *     `theme.components` overrides tokens for specific components only.
 *   - antd's `App` component provides the shared `message`/`modal` APIs used by `App.useApp()` elsewhere
 *     (see use-action.ts). It is renamed `AntApp` here to avoid clashing with other things called "App".
 *   - `children` is a special React prop: whatever is placed between <ThemeProvider> and </ThemeProvider>.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - import renaming `App as AntApp`.
 *   - an inline props type `{ children: React.ReactNode }` (ReactNode = anything React can display).
 */

// `import { a } from "b"` brings named things from a library. Both come from Ant Design ("antd", from npm).
import { ConfigProvider, App as AntApp } from "antd";

/**
 * Kind: React component.
 * FundHub brand on Ant Design: ink + emerald, compact data density.
 * @param children  type `React.ReactNode` — the rest of the Console that should receive the theme.
 * @returns JSX: the children wrapped in antd's ConfigProvider and App.
 */
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
      {/* Above: primary = emerald (buttons, highlights), links a darker emerald, text the brand ink colour;
          the sidebar (Layout sider) and its dark Menu use a near-black ink; componentSize "middle" is the
          normal antd size. Below: AntApp enables App.useApp() for the whole Console. */}
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
