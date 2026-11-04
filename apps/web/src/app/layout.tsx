/**
 * FILE: apps/web/src/app/layout.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "root layout" of the public website: the outer HTML frame (<html>, <body>, header,
 *   footer, chat widget, cookie banner) that wraps every single page. It also sets the default page title,
 *   description and social-sharing details that every page inherits unless it overrides them.
 * WHERE IT RUNS: on the server (Node.js). It is a React "server component": it can read the login cookie and
 *   the database directly, and only the finished HTML is sent to the browser.
 * FRAMEWORK NOTES: Next.js "App Router" builds the site from the folder src/app. A file called layout.tsx
 *   wraps every page in its folder and all sub-folders; this one sits at the top of app/, so it wraps the
 *   whole site. Next.js renders the current page and passes it to this layout as `children`.
 *   Exporting a constant called `metadata` (or `viewport`) is another Next.js convention: Next.js reads it
 *   and writes the matching <title>, <meta> and <link> tags into the page's <head> for us.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type { X }`: import only a type (a description of data), which disappears when compiled.
 *   - type annotations `name: Type` (e.g. `metadata: Metadata`): tell TypeScript what shape a value must have.
 *   - ternary `cond ? a : b`: "if cond then a else b" as one expression.
 *   - template strings `` `https://${x}` ``: text with a value inserted at ${...}.
 *   - async/await: a function that waits for slow work (here: reading the logged-in user).
 *   - `Readonly<{ ... }>`: a generic type that marks every property as read-only.
 */

// `import { a } from "b"` loads the named thing `a` from the module (file or library) "b".
// Plain names like "next" are libraries installed from npm; "@/..." means this app's src folder;
// "./x" means a file next to this one.
// `Metadata` and `Viewport` are Next.js types describing the shape of the `metadata`/`viewport` exports below.
import type { Metadata, Viewport } from "next";
// Self-hosted fonts: bundled from npm, so builds never depend on reaching Google Fonts.
// An `import "x"` with no names just runs/loads the file: here each one adds a font's CSS to the site.
// Inter is the main (sans-serif) font; IBM Plex Mono is the fixed-width font in weights 400/500/600.
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
// AppShell: our component that draws the site header, navigation and footer around the page content.
import { AppShell } from "@/components/app-shell";
// getCurrentUser: reads the login cookie and returns the logged-in visitor (or nothing if not logged in).
import { getCurrentUser } from "@/lib/auth/session";
// AdvisorWidget: the floating "ask an advisor" chat button shown on every page.
import { AdvisorWidget } from "@/components/advisor-widget";
// CookieConsent: the cookie banner that asks visitors for consent.
import { CookieConsent } from "@/components/cookie-consent";
// The site-wide stylesheet (Tailwind CSS setup and our colour names such as `text-ink`, `bg-emerald`).
import "./globals.css";

/**
 * Kind: constant (Next.js metadata export), of type `Metadata`.
 * Default <head> information for every page of the site.
 * - `title.default`: the browser-tab title when a page sets no title of its own.
 * - `title.template`: how a page's own title is shown; `%s` is replaced by that title, so a page with
 *   `title: "News"` gets the tab title "News · FundHub".
 * - `description`: the summary search engines show under the link.
 * - `openGraph`: details used when the link is shared on LinkedIn, Slack etc. (`en_GB` = British English).
 * - `metadataBase`: the site's full web address, needed so Next.js can turn relative image/link paths into
 *   absolute URLs. On Vercel (our hosting) the environment variable VERCEL_PROJECT_PRODUCTION_URL holds the
 *   live domain; locally it is missing, so we pass `undefined` (TypeScript's "no value").
 */
export const metadata: Metadata = {
  title: {
    default: "FundHub · Independent Fund Services Comparator & Advisor in Luxembourg",
    template: "%s · FundHub",
  },
  description:
    "Independent fund service provider comparator and set-up & fee negotiation advisory for Luxembourg. Compare administrators, depositaries, ManCos, tax and legal providers on real fees, tech and peer reviews. No referral fees, no commissions.",
  openGraph: { type: "website", siteName: "FundHub", locale: "en_GB" },
  // `process.env.NAME` reads an environment variable (a setting supplied by the server, not written in code).
  // `cond ? a : b` is the ternary operator: if the variable is set, build a URL object from it, else undefined.
  metadataBase: process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : undefined,
};

/**
 * Kind: constant (Next.js viewport export), of type `Viewport`.
 * `themeColor` tints the browser's address bar on mobile phones with our dark ink colour.
 */
export const viewport: Viewport = {
  themeColor: "#1a212b",
};

/**
 * Kind: async React component (server component) — the root layout.
 * A React component is a function that returns JSX: HTML-like markup describing what to show.
 * `export default` makes it the file's main export, which is what Next.js looks for in layout.tsx.
 * @param children  type `React.ReactNode` (anything React can display): the current page, given by Next.js.
 *                  `{ children }` is "destructuring": it pulls the `children` property out of the props
 *                  object. `Readonly<...>` says the props must not be modified.
 * @returns         `Promise<JSX>`: because the function is `async`, the markup arrives once the user lookup
 *                  has finished.
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // `await` pauses until the login cookie has been checked. `user` is the visitor's account or null/undefined.
  const user = await getCurrentUser();
  // The JSX below is the page frame. `className` is JSX's name for the HTML `class` attribute; the values are
  // Tailwind CSS utility classes (`font-sans` = use the sans-serif font family, i.e. Inter).
  // AppShell props:
  // - `account`: `user && {...}` means "if there is a user, pass just their name and account type, otherwise
  //   pass the empty value". Passing only two fields avoids sending private details to the browser.
  // - `newsletter`: `!!x` turns any value into true/false. The newsletter sign-up is shown only when both
  //   Listmonk (our newsletter tool) settings exist; `&&` means "and".
  // `{children}` between the AppShell tags puts the current page inside the shell.
  return (
    <html lang="en">
      <body className="font-sans">
        <AppShell account={user && { name: user.name, accountType: user.accountType }} newsletter={!!process.env.LISTMONK_URL && !!process.env.LISTMONK_LIST_UUID}>{children}</AppShell>
        {/* The chat widget and the cookie banner sit outside the shell so they float above every page. */}
        <AdvisorWidget />
        <CookieConsent />
      </body>
    </html>
  );
}
