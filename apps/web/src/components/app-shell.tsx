"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
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
import { SiteFooter } from "./site-footer";
import { Wordmark } from "./wordmark";
import { TopSearch } from "./top-search";
import { cn } from "@/lib/cn";
import { TAXONOMY } from "@fundhub/core/taxonomy";

type NavItem = { href: string; label: string; icon: LucideIcon; children?: { href: string; label: string }[] };
type NavBlock = { section?: string; items: NavItem[] };

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
        children: TAXONOMY.map((c) => ({ href: `/services/${c.slug}`, label: c.label })),
      },
      { href: "/benchmarks", label: "Fees & Rankings", icon: TrendingUp },
      { href: "/fundhub-score", label: "FundHub Score", icon: Gauge },
    ],
  },
  {
    section: "Advisory",
    items: [
      { href: "/advisory", label: "Selection & Negotiation", icon: Handshake },
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
const BOTTOM_LINKS = [
  { href: "/methodology", label: "Methodology & Data", icon: BookOpen },
  { href: "/independence", label: "Independence Charter", icon: ShieldCheck },
  { href: "/for-providers", label: "For Service Providers", icon: Store },
];

const ALL_HREFS = [...NAV.flatMap((b) => b.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])), ...BOTTOM_LINKS.map((l) => l.href)];
const ALIASES: [string, string][] = [["/providers", "/compare"]];

/** The single nav entry for the current page: the longest matching href. */
function activeHref(pathname: string): string | undefined {
  const path = ALIASES.reduce((p, [from, to]) => (p.startsWith(from) ? to : p), pathname);
  if (path === "/") return "/";
  return ALL_HREFS.filter((h) => h !== "/" && (path === h || path.startsWith(`${h}/`))).sort((a, b) => b.length - a.length)[0];
}

/** Minimal account info for the shell; null for regular visitors. */
export type ShellAccount = { name: string; accountType: "visitor" | "provider" } | null;

/** Persistent statement of independence, shown on every page. */
function IndependenceBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-ink-900 px-4 py-1.5 text-center text-[11px] text-slate-300">
      <ShieldCheck className="hidden h-3.5 w-3.5 shrink-0 text-emerald sm:block" />
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

function Sidebar({ onNavigate, account }: { onNavigate?: () => void; account: ShellAccount }) {
  const active = activeHref(usePathname());
  return (
    <div className="flex h-full flex-col bg-ink-900 text-slate-200">
      <Link href="/" onClick={onNavigate} aria-label="FundHub home" className="flex h-20 flex-col justify-center border-b border-ink-700 px-5">
        <Wordmark tone="light" className="text-3xl leading-none" />
        <span className="mt-1 block text-[10px] uppercase tracking-widest text-slate-400">Independent fund services comparator</span>
      </Link>

      <nav className="thin-scroll flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {NAV.map(({ section, items }, bi) => (
          <div key={section ?? bi}>
            {section && <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{section}</p>}
            {items.map(({ href, label, icon: Icon, children }) => {
              const current = active === href;
              const open = !!children && (current || children.some((c) => c.href === active));
              return (
                <div key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm",
                      current ? "bg-ink-700 font-medium text-white" : "text-slate-300 hover:bg-ink-800",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", current && "text-emerald")} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {children && <ChevronDown className={cn("h-3.5 w-3.5 text-slate-500 transition", open && "rotate-180")} />}
                  </Link>
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

      <div className="border-t border-ink-700 p-3">
        <Link
          href={account ? "/account" : "/account/login"}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-ink-800"
        >
          {account ? <CircleUserRound className="h-4 w-4 text-emerald" /> : <LogIn className="h-4 w-4" />}
          <span className="min-w-0 truncate">{account ? account.name : "Log in / Sign up"}</span>
          {account?.accountType === "provider" && <span className="ml-auto text-[10px] uppercase text-emerald">Provider</span>}
        </Link>
      </div>

      <p className="flex items-center gap-1 border-t border-ink-700 px-5 py-2 text-[10px] font-medium text-emerald/80">
        <Award className="h-3 w-3" /> Independent · No referral fees
      </p>
    </div>
  );
}

export function AppShell({ children, account, newsletter = false }: { children: React.ReactNode; account: ShellAccount; newsletter?: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation and on Escape.
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-ink-700 lg:block">
        <Sidebar account={account} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink-900/50"
            onClick={() => setDrawerOpen(false)}
          />
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

      <div className="flex min-w-0 flex-1 flex-col">
        <IndependenceBanner />
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-ink-600 lg:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Suspense fallback={<div className="h-10 max-w-2xl flex-1 rounded-md bg-canvas" />}>
              <TopSearch />
            </Suspense>
            <Link
              href="/rfi"
              className="hidden items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-ink-600 hover:bg-slate-50 md:flex"
            >
              <FileText className="h-4 w-4" />
              Request quotes
            </Link>
            <Link
              href="/advisory"
              className="flex items-center gap-2 rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white hover:bg-ink-800 sm:px-4"
            >
              <Handshake className="h-4 w-4" />
              <span className="hidden sm:inline">Talk to an advisor</span>
            </Link>
          </div>
        </header>
        {children}
        <SiteFooter newsletter={newsletter} />
      </div>
    </div>
  );
}
