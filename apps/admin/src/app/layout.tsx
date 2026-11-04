/**
 * FILE: apps/admin/src/app/layout.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The outermost frame of every Console page, including the login pages: the <html> and <body>
 *   tags, the font, the global stylesheet, and the Ant Design and theme (light/dark) set-up. It also sets
 *   the default browser-tab title and tells search engines never to index the Console.
 * WHERE IT RUNS: on the server (Node.js) as a server component that produces the page skeleton; the
 *   components it wraps around the page (AntdRegistry, ThemeProvider) also run in the browser.
 * FRAMEWORK NOTES: the layout.tsx directly inside app/ is the "root layout": Next.js requires it, and it
 *   must contain <html> and <body>. Every page is passed into it as `children`. Ant Design (antd) is the
 *   library of ready-made UI pieces (tables, forms, buttons) the Console is built with.
 * TYPESCRIPT YOU WILL SEE HERE: side-effect imports (`import "x"` — load a file just for its effect, such as
 *   CSS), `import type`, nested object literals, `Readonly<…>` (a type whose fields cannot be reassigned),
 *   `React.ReactNode`, JSX.
 */

// `import "x"` with nothing named loads a module only for its side effects.
// This patch lets Ant Design version 5 work correctly with React 19.
import "@ant-design/v5-patch-for-react-19";
// Loads the "Inter" font files (an npm package of web fonts) so the CSS can use them.
import "@fontsource-variable/inter";
// `import { a } from "b"` loads named exports. `Metadata` = type of the page-info object.
import type { Metadata } from "next";
// AntdRegistry collects Ant Design's styles while rendering on the server, so the page arrives styled
// (without it the page would flash unstyled for a moment).
import { AntdRegistry } from "@ant-design/nextjs-registry";
// `@/…` = this app's src folder. Our light/dark theme wrapper for Ant Design.
import { ThemeProvider } from "@/components/theme-provider";
// The global stylesheet in this same folder (`./` = "next to this file").
import "./globals.css";

/**
 * Kind: constant of type `Metadata`, read by Next.js.
 * - title.default: the tab title when a page sets none; title.template: the pattern for pages that do set
 *   one, where "%s" is replaced by the page's title (e.g. "Billing & invoices · FundHub Admin").
 * - robots: index/follow false = ask search engines not to list these pages or follow their links.
 */
export const metadata: Metadata = {
  title: { default: "FundHub Admin", template: "%s · FundHub Admin" },
  robots: { index: false, follow: false },
};

/**
 * Kind: React component (the root layout).
 * @param props  `{ children }` destructured; type `Readonly<{ children: React.ReactNode }>` = a read-only
 *               object whose `children` is anything React can display (the current page).
 * @returns      JSX: the full page skeleton with the page inside.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // JSX: HTML-like markup. `lang="en"` tells browsers and screen readers the language.
  // Wrapping order: AntdRegistry (styles) > ThemeProvider (colours) > the page.
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ThemeProvider>{children}</ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
