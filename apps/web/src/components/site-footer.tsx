/**
 * FILE: apps/web/src/components/site-footer.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The footer shown at the bottom of every public page: the FundHub logo and independence
 *   statement, links to every service category, an optional newsletter sign-up, three columns of site links,
 *   and a bottom strip with legal links, cookie settings and the copyright/disclaimer text.
 * WHERE IT RUNS: on the server (no "use client" line, so it is a Next.js server component that outputs HTML).
 *   It can still contain client components (NewsletterForm, CookieSettingsLink): Next.js sends just those
 *   small interactive pieces' JavaScript to the browser.
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). Lists are drawn with
 *   `.map(…)` and need a unique `key` per item. Next.js's <Link> moves between pages without a full reload.
 *   Tailwind classes in `className` are small styles; `sm:`/`md:`/`xl:` apply from small/medium/extra-large
 *   screen widths upwards (the layout gains columns as the screen grows).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - an array of objects as a constant (TypeScript works out its type automatically: "type inference").
 *   - optional prop with default `newsletter = false`; `&&` to show something conditionally.
 *   - React fragments `<>…</>`: group several elements without adding an extra HTML element.
 *   - template strings `` `/services/${c.slug}` ``.
 */

// `import X from "b"` imports a default export; `{ a }` picks named exports.
// Next.js's link component.
import Link from "next/link";
// TAXONOMY: the master list of service categories (slug + label + …), from our shared package packages/core.
import { TAXONOMY } from "@fundhub/core/taxonomy";
// A small button that reopens the cookie-consent settings (cookie-consent.tsx in this folder).
import { CookieSettingsLink } from "./cookie-consent";
// The newsletter sign-up form (newsletter-form.tsx in this folder).
import { NewsletterForm } from "./newsletter-form";
// The FundHub text logo (wordmark.tsx in this folder).
import { Wordmark } from "./wordmark";

/**
 * Kind: constant (array of objects).
 * The three link columns of the footer. Each column has a `title` and a list of `links`, each with an `href`
 * (the URL path) and a `label` (the visible text). To add a footer link, add an object to the right list.
 */
const COLUMNS = [
  {
    title: "Compare",
    links: [
      { href: "/compare", label: "Provider comparator" },
      { href: "/services", label: "Service categories" },
      { href: "/benchmarks", label: "Fee benchmarks & rankings" },
      { href: "/fundhub-score", label: "FundHub Score" },
    ],
  },
  {
    title: "Services",
    links: [
      { href: "/advisory", label: "Selection & negotiation" },
      { href: "/advisory/fund-setup", label: "Fund set-up advisory" },
      { href: "/data-intelligence", label: "Data Intelligence" },
      { href: "/data-intelligence/membership", label: "Membership" },
      { href: "/news", label: "News" },
      { href: "/learn", label: "Learn" },
      { href: "/awards", label: "FundHub Awards" },
    ],
  },
  {
    title: "FundHub",
    links: [
      { href: "/independence", label: "Independence charter" },
      { href: "/methodology", label: "Methodology & data" },
      { href: "/for-providers", label: "For service providers" },
      { href: "/account/login", label: "Log in / Sign up" },
    ],
  },
];

/**
 * Kind: React component (server component).
 * Props: newsletter — type `boolean`, optional, default `false`. When true the newsletter sign-up form is
 *   shown under the categories (pages choose whether they want it).
 * Returns: JSX — the <footer> element.
 */
export function SiteFooter({ newsletter = false }: { newsletter?: boolean }) {
  return (
    // `mt-auto` pushes the footer to the bottom of the page when the content is short (inside a flex column).
    <footer className="mt-auto border-t border-slate-200 bg-white">
      {/* Main area: one column on phones, 2 from medium screens, 5 from extra-large screens. */}
      <div className="grid gap-8 px-4 py-8 sm:px-6 md:grid-cols-2 xl:grid-cols-5">
        {/* Left block: spans 2 of the 5 columns on extra-large screens (`xl:col-span-2`). */}
        <div className="xl:col-span-2">
          <p>
            <Wordmark className="text-lg" />
            <span className="ml-1 text-xs text-slate-400">FundHub.lu</span>
          </p>
          {/* The independence statement: FundHub's key business rule (paid by fund managers, not providers). */}
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-600">
            The independent fund service provider comparator and set-up & fee negotiation advisory for Luxembourg. We are paid by fund
            managers, never by referral fees or commissions from the providers we compare.
          </p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Categories</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            {/* One link per service category. `.map((c, i) => …)` also gives the position `i` (0, 1, 2…).
                `i > 0 && " · "` puts a separator dot before every link except the first. */}
            {TAXONOMY.map((c, i) => (
              <span key={c.slug}>
                {i > 0 && " · "}
                <Link href={`/services/${c.slug}`} className="hover:text-ink hover:underline">
                  {c.label}
                </Link>
              </span>
            ))}
          </p>
          {/* Only when `newsletter` is true. `<>…</>` is a fragment: it groups the three elements without
              wrapping them in an extra <div>. */}
          {newsletter && (
            <>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Newsletter</p>
              <p className="mt-1 mb-2 text-xs text-ink-600">Sector news and the quarterly market snapshot. Unsubscribe anytime.</p>
              <NewsletterForm />
            </>
          )}
        </div>
        {/* The three link columns from COLUMNS above: an outer `.map` over columns, an inner `.map` over each
            column's links. The column title and the link URL are unique, so they serve as the `key`s. */}
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{col.title}</p>
            {/* `space-y-1.5` puts a small vertical gap between list items. */}
            <ul className="mt-2 space-y-1.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-xs text-ink-600 hover:text-ink hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {/* Bottom strip, separated by a faint top border. */}
      <div className="border-t border-slate-100 px-4 py-4 text-[11px] leading-relaxed text-slate-400 sm:px-6">
        {/* Legal links in a row that wraps onto new lines on narrow screens (`flex-wrap`). */}
        <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/legal/notice" className="text-xs text-ink-600 hover:text-ink hover:underline">Legal notice</Link>
          <Link href="/legal/privacy" className="text-xs text-ink-600 hover:text-ink hover:underline">Privacy</Link>
          <Link href="/legal/terms" className="text-xs text-ink-600 hover:text-ink hover:underline">Terms</Link>
          <Link href="/legal/cookies" className="text-xs text-ink-600 hover:text-ink hover:underline">Cookies</Link>
          <Link href="/privacy-request" className="text-xs text-ink-600 hover:text-ink hover:underline">Data request</Link>
          <CookieSettingsLink />
        </p>
        {/* Copyright and disclaimer. `new Date().getFullYear()` inserts the current year, so it never goes stale. */}
        <p>
          © {new Date().getFullYear()} FundHub.lu. Fee ranges are indicative quarterly quotes, not offers. Content is
          general information, not legal, tax or investment advice. Public beta: provider profiles shown are
          illustrative sample data.
        </p>
      </div>
    </footer>
  );
}
