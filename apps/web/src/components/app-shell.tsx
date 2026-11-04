"use client";

/**
 * FILE: apps/web/src/components/app-shell.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "frame" around every public page: the dark navigation sidebar on the left, the
 *   independence banner and the top header bar (search box, "Request quotes", "Talk to an advisor"),
 *   and the footer. On phones the sidebar is hidden and opens as a slide-in "drawer" from a menu button.
 *   The page's own content is passed in and drawn in the middle.
 * WHERE IT RUNS: in the browser (and pre-rendered on the server first). It is a client component because it
 *   remembers whether the mobile drawer is open, listens for the Escape key and reads the current URL.
 * FRAMEWORK NOTES: `"use client"` (the first line) makes this a client component whose JavaScript runs in
 *   the browser. A React component is a function that returns JSX (HTML-like markup). `children` is a
 *   special prop: whatever is placed between <AppShell> and </AppShell> by the layout file.
 *   Tailwind classes such as `hidden lg:block` mean "hidden by default, shown as a block on large screens";
 *   the `sm:`, `md:`, `lg:` prefixes apply a style only from that screen width upward.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases (`type NavItem = {...}`), optional fields (`children?:`), arrays (`NavItem[]`).
 *   - tuples (`[string, string]`): a fixed-length array where each position has a known type.
 *   - union types (`"visitor" | "provider"`, `... | null`), `undefined` (no value).
 *   - array methods `.map`, `.flatMap`, `.filter`, `.sort`, `.reduce`, `.some`; spread `[...a, ...b]`.
 *   - nullish coalescing `a ?? b`, optional chaining `a?.b`, non-null assertion `x!`, `!!x` (to boolean).
 *   - default parameter values (`newsletter = false`).
 */

// `import { a } from "b"` pulls named things out of another module. Plain names are npm libraries,
// `./x` is a file in this same folder, `@/...` is this app's src folder, `@fundhub/...` a shared package.

// Next.js link component: changes page without a full reload.
import Link from "next/link";
// `usePathname()` is a Next.js hook that returns the current URL path, e.g. "/compare".
import { usePathname } from "next/navigation";
// React: `Suspense` shows a placeholder while a child is not ready; `useEffect`/`useState` are hooks (see below).
import { Suspense, useEffect, useState } from "react";
// Icon components for the menu. `type LucideIcon` imports only the TypeScript type that describes "any icon".
import {
  Award,
  BarChart3,
  BookOpen,
  Building2,
  ChevronDown,
  CircleUserRound,
  FileText,
  Crown,
  Gauge,
  GraduationCap,
  Handshake,
  Home,
  LayoutGrid,
  LogIn,
  Menu,
  Newspaper,
  Search,
  ShieldCheck,
  Store,
  TrendingUp,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
// Other website components: the footer, the "FundHub" logo text and the search box in the header.
import { SiteFooter } from "./site-footer";
import { Wordmark } from "./wordmark";
import { TopSearch } from "./top-search";
// `cn(...)` joins several class names into one string, skipping any that are false/undefined.
import { cn } from "@/lib/cn";
// The master list of service categories (depositary, fund admin, ...), shared with the console.
import { TAXONOMY } from "@fundhub/core/taxonomy";

/**
 * Kind: type alias. One link in the sidebar.
 *   href: string (the URL), label: string (the text), icon: LucideIcon (which icon component to draw),
 *   children?: optional (`?`) list of sub-links, each `{ href, label }`, shown indented under it.
 */
type NavItem = { href: string; label: string; icon: LucideIcon; children?: { href: string; label: string }[] };
/** Kind: type alias. A group of sidebar links with an optional section heading (e.g. "Advisory"). */
type NavBlock = { section?: string; items: NavItem[] };

/**
 * Kind: constant. The whole sidebar menu, as data. The component below loops over it to draw links,
 * so adding a page to the menu means adding one line here. Each block = optional heading + items.
 */
const NAV: NavBlock[] = [
  { items: [{ href: "/", label: "Home", icon: Home }] },
  {
    section: "Provider Comparator",
    items: [
      { href: "/compare", label: "Comparator Engine", icon: Search },
      {
        href: "/services",
        label: "Service Categories",
        icon: LayoutGrid,
        // Sub-links built from the taxonomy: `.map` turns each category `c` into `{ href, label }`.
        // The extra brackets in `({ ... })` tell the arrow function to return an object.
        children: TAXONOMY.map((c) => ({ href: `/services/${c.slug}`, label: c.label })),
      },
      { href: "/benchmarks", label: "Fees & Rankings", icon: TrendingUp },
      { href: "/fundhub-score", label: "FundHub Score", icon: Gauge },
    ],
  },
  {
    section: "Advisory",
    items: [
      { href: "/advisory", label: "Fee Negotiation", icon: Handshake },
      { href: "/advisory/fund-setup", label: "Fund Set-up", icon: Building2 },
      { href: "/rfi", label: "Request Quotes", icon: FileText },
    ],
  },
  {
    section: "Data Intelligence",
    items: [
      { href: "/data-intelligence", label: "Stats & Reports", icon: BarChart3 },
      { href: "/data-intelligence/membership", label: "Membership", icon: Crown },
    ],
  },
  {
    section: "News & Learn",
    items: [
      { href: "/news", label: "News", icon: Newspaper },
      { href: "/learn", label: "Learn", icon: GraduationCap },
    ],
  },
  { section: "Awards", items: [{ href: "/awards", label: "FundHub Awards", icon: Trophy }] },
];

/** Smaller links at the bottom of the sidebar. */
// Kind: constant. TypeScript works out (infers) its type from the values, so no annotation is needed.
const BOTTOM_LINKS = [
  { href: "/methodology", label: "Methodology & Data", icon: BookOpen },
  { href: "/independence", label: "Independence Charter", icon: ShieldCheck },
  { href: "/for-providers", label: "For Service Providers", icon: Store },
];

/**
 * Kind: constant. Every URL that appears anywhere in the menu, as one flat list of strings.
 * `.flatMap(fn)` is like `.map` but flattens one level, so lists-of-lists become one list.
 * For each item it collects its own href plus its children's hrefs; `i.children ?? []` means
 * "the children, or an empty list if there are none" (`??` = use the right side when the left is
 * null/undefined). `[...a, ...b]` (spread) joins the menu hrefs and the bottom-link hrefs into one array.
 */
const ALL_HREFS = [...NAV.flatMap((b) => b.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])), ...BOTTOM_LINKS.map((l) => l.href)];
/**
 * Kind: constant. URL prefixes that should highlight a different menu entry. `[string, string][]` is an
 * array of pairs (tuples). Here: a provider profile page (/providers/...) highlights "Comparator Engine".
 */
const ALIASES: [string, string][] = [["/providers", "/compare"]];

/** The single nav entry for the current page: the longest matching href. */
/**
 * Kind: function.
 * @param pathname  type `string`: the current URL path, e.g. "/services/depositary".
 * @returns `string | undefined`: the menu href to highlight, or `undefined` if nothing matches.
 * Why "longest": on "/advisory/fund-setup" both "/advisory" and "/advisory/fund-setup" match; the longer,
 * more specific one is the right one to highlight.
 */
function activeHref(pathname: string): string | undefined {
  // `.reduce(fn, start)` walks the list carrying a value along. Starting from `pathname`, each alias pair
  // `[from, to]` (destructured) replaces the path with `to` if the path starts with `from`.
  const path = ALIASES.reduce((p, [from, to]) => (p.startsWith(from) ? to : p), pathname);
  // Home is special: every path starts with "/", so only an exact "/" counts as Home.
  if (path === "/") return "/";
  // Keep hrefs that equal the path or are a parent folder of it (`startsWith(`${h}/`)`), then
  // `.sort((a, b) => b.length - a.length)` orders them longest first, and `[0]` takes the first one
  // (which is `undefined` if the filtered list is empty).
  return ALL_HREFS.filter((h) => h !== "/" && (path === h || path.startsWith(`${h}/`))).sort((a, b) => b.length - a.length)[0];
}

/** Minimal account info for the shell; null for regular visitors. */
// Kind: exported type alias. Either an object with the user's name and account type, or `null`
// (meaning "nobody is logged in"). The layout file passes this in.
export type ShellAccount = { name: string; accountType: "visitor" | "provider" } | null;

/** Persistent statement of independence, shown on every page. */
// Kind: React component, no props. Returns the thin dark strip at the very top of the page.
function IndependenceBanner() {
  return (
    // `flex items-center justify-center gap-2` = lay children in a row, centred, with a small gap.
    <div className="flex items-center justify-center gap-2 bg-ink-900 px-4 py-1.5 text-center text-[11px] text-slate-300">
      {/* Shield icon: `hidden ... sm:block` = hidden on phones, visible from small-tablet width up. */}
      <ShieldCheck className="hidden h-3.5 w-3.5 shrink-0 text-emerald sm:block" />
      {/* The sentence below: `{" "}` inserts a real space before the link, because JSX drops the space
          at a line break that is followed by a tag. */}
      <p>
        <span className="font-semibold text-white">Independent by design.</span> FundHub accepts no referral fees or
        commissions from service providers.{" "}
        <Link href="/independence" className="font-medium text-emerald hover:underline">
          Read our charter →
        </Link>
      </p>
    </div>
  );
}

/**
 * Kind: React component. The sidebar contents (used twice: fixed on desktop, in the drawer on mobile).
 * Props (destructured from one object):
 *   onNavigate?: `() => void`, optional: a function with no inputs and no result, called when a link is
 *     clicked. The mobile drawer passes one to close itself; the desktop sidebar passes nothing.
 *   account: ShellAccount: the logged-in user, or null.
 * Returns: JSX for the whole sidebar.
 */
function Sidebar({ onNavigate, account }: { onNavigate?: () => void; account: ShellAccount }) {
  // Which menu entry matches the current URL (see activeHref above).
  const active = activeHref(usePathname());
  return (
    // `h-full flex-col` = full height, children stacked top to bottom.
    <div className="flex h-full flex-col bg-ink-900 text-slate-200">
      {/* Logo block linking to the home page. */}
      <Link href="/" onClick={onNavigate} aria-label="FundHub home" className="flex h-20 flex-col justify-center border-b border-ink-700 px-5">
        <Wordmark tone="light" className="text-3xl leading-none" />
        <span className="mt-1 block text-[10px] uppercase tracking-widest text-slate-400">Independent fund services comparator</span>
      </Link>

      {/* Main menu. `flex-1` makes it take all remaining height; `overflow-y-auto` adds a scrollbar if needed. */}
      <nav className="thin-scroll flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {/* One group per block. `({ section, items }, bi)` destructures each block; `bi` is its position.
            The key is the heading text, or the position number for the heading-less Home block (`??`). */}
        {NAV.map(({ section, items }, bi) => (
          <div key={section ?? bi}>
            {section && <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{section}</p>}
            {/* `icon: Icon` renames the field while destructuring: a component name must start with a capital
                letter for JSX (<Icon />) to treat it as a component rather than an HTML tag. */}
            {items.map(({ href, label, icon: Icon, children }) => {
              // Is this the current page?
              const current = active === href;
              // Show the sub-links when this item has children (`!!` turns a value into true/false) and either
              // it or one of its children is current. `.some(fn)` = true if fn is true for at least one item.
              const open = !!children && (current || children.some((c) => c.href === active));
              return (
                <div key={href}>
                  {/* `aria-current="page"` tells screen readers which link is the current page.
                      `cn(base, condition ? a : b)` picks highlighted or normal styling. */}
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm",
                      current ? "bg-ink-700 font-medium text-white" : "text-slate-300 hover:bg-ink-800",
                    )}
                  >
                    {/* `current && "text-emerald"` adds the green colour only when current (cn skips `false`). */}
                    <Icon className={cn("h-4 w-4 shrink-0", current && "text-emerald")} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {/* A down-arrow for items with sub-links; `rotate-180` flips it when open, `transition` animates. */}
                    {children && <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition", open && "rotate-180")} />}
                  </Link>
                  {/* The indented sub-link list. `children!` (non-null assertion) tells TypeScript "this is
                      definitely not undefined here", which is true because `open` is only true with children. */}
                  {open && (
                    <div className="ml-5 mt-0.5 space-y-0.5 border-l border-ink-700 pl-3">
                      {children!.map((c) => (
                        <Link
                          key={c.href}
                          href={c.href}
                          onClick={onNavigate}
                          aria-current={active === c.href ? "page" : undefined}
                          className={cn(
                            "block truncate rounded px-2 py-1 text-xs",
                            active === c.href ? "bg-ink-700 font-medium text-white" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200",
                          )}
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Small text links (methodology, charter, for providers). `flex-wrap` lets them wrap onto two lines. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-ink-700 px-5 py-3">
        {BOTTOM_LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn("text-[11px] hover:text-white", active === href ? "font-medium text-emerald" : "text-slate-400")}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Account link: goes to the account page when logged in, otherwise to the login page. */}
      <div className="border-t border-ink-700 p-3">
        <Link
          href={account ? "/account" : "/account/login"}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-ink-800"
        >
          {account ? <CircleUserRound className="h-4 w-4 text-emerald" /> : <LogIn className="h-4 w-4" />}
          <span className="min-w-0 truncate">{account ? account.name : "Log in / Sign up"}</span>
          {/* `account?.accountType` = read accountType only if account is not null. Provider accounts get a tag;
              `ml-auto` pushes it to the far right. */}
          {account?.accountType === "provider" && <span className="ml-auto text-[10px] uppercase text-emerald">Provider</span>}
        </Link>
      </div>

      {/* `text-emerald/80` = emerald colour at 80% opacity. */}
      <p className="flex items-center gap-1 border-t border-ink-700 px-5 py-2 text-[10px] font-medium text-emerald/80">
        <Award className="h-3 w-3" /> Independent · No referral fees
      </p>
    </div>
  );
}

/**
 * Kind: React component (exported; the website's root layout wraps every page in it).
 * Props:
 *   children: `React.ReactNode` = anything React can draw (the page content).
 *   account: ShellAccount = the logged-in user or null.
 *   newsletter?: boolean, optional, `= false` default: whether the footer shows the newsletter sign-up.
 * Returns: JSX for the full page frame.
 */
export function AppShell({ children, account, newsletter = false }: { children: React.ReactNode; account: ShellAccount; newsletter?: boolean }) {
  // Is the mobile navigation drawer open? (useState = remembered value + setter that redraws.)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation and on Escape.
  // `useEffect(fn, [pathname])` runs after drawing and again whenever the URL changes, so moving to another
  // page always closes the drawer.
  useEffect(() => setDrawerOpen(false), [pathname]);
  // Second effect: only while the drawer is open, listen for key presses on the whole window.
  useEffect(() => {
    if (!drawerOpen) return;
    // `e: KeyboardEvent` is the browser's key event; `a && b` runs b only if a is true (here: key is Escape).
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    // A function returned from an effect is the "clean-up": React runs it before the effect runs again or
    // when the component disappears, so the listener is removed and does not pile up.
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    // `min-h-screen` = at least the full window height; `flex` puts sidebar and content side by side.
    <div className="flex min-h-screen">
      {/* Desktop sidebar: `hidden lg:block` = only on large screens; `sticky top-0 h-screen` keeps it in view
          while the page scrolls; `w-64` = fixed width; `shrink-0` stops it being squeezed. */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-ink-700 lg:block">
        <Sidebar account={account} />
      </aside>

      {/* Mobile drawer, drawn only while open and only below large screens (`lg:hidden`).
          `fixed inset-0 z-50` covers the whole window above everything else. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          {/* A see-through dark backdrop (`bg-ink-900/50` = 50% opacity); clicking it closes the drawer. */}
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink-900/50"
            onClick={() => setDrawerOpen(false)}
          />
          {/* The drawer panel on the left; clicking any link inside calls onNavigate, which closes it. */}
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <Sidebar account={account} onNavigate={() => setDrawerOpen(false)} />
            <button
              aria-label="Close navigation"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-3 top-5 text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Right-hand column: banner, header, page content, footer. `min-w-0 flex-1` lets it fill the rest
          of the width without overflowing. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <IndependenceBanner />
        {/* Header bar that sticks to the top while scrolling; `bg-white/95 backdrop-blur` = slightly
            see-through white that blurs whatever scrolls underneath. */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            {/* Hamburger menu button, only on small screens (`lg:hidden`); opens the drawer. */}
            <button
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-ink-600 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            {/* TopSearch reads the URL's query string, which Next.js requires to sit inside <Suspense>.
                `fallback` is a grey placeholder box shown until it is ready. */}
            <Suspense fallback={<div className="h-10 max-w-2xl flex-1 rounded-md bg-canvas" />}>
              <TopSearch />
            </Suspense>
            {/* "Request quotes": hidden on phones, shown as a flex row from medium screens (`md:flex`). */}
            <Link
              href="/rfi"
              className="hidden items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-ink-600 hover:bg-slate-50 md:flex"
            >
              <FileText className="h-4 w-4" />
              Request quotes
            </Link>
            {/* "Talk to an advisor": always shown; on phones only the icon, the text appears from `sm:` up. */}
            <Link
              href="/advisory"
              className="flex items-center gap-2 rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white hover:bg-ink-800 sm:px-4"
            >
              <Handshake className="h-4 w-4" />
              <span className="hidden sm:inline">Talk to an advisor</span>
            </Link>
          </div>
        </header>
        {/* The actual page content passed in by the layout. */}
        {children}
        <SiteFooter newsletter={newsletter} />
      </div>
    </div>
  );
}
