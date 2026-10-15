"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  Award,
  BarChart3,
  BookOpen,
  CircleUserRound,
  FileText,
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

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "FundHub",
    items: [
      { href: "/", label: "Home", icon: Home },
      { href: "/compare", label: "Provider Comparator", icon: Search },
      { href: "/services", label: "Service Categories", icon: LayoutGrid },
      { href: "/benchmarks", label: "Fee Benchmarks", icon: TrendingUp },
      { href: "/advisory", label: "Advisory", icon: Handshake },
      { href: "/news", label: "News & Learn", icon: Newspaper },
      { href: "/data-intelligence", label: "Data Intelligence", icon: BarChart3 },
      { href: "/awards", label: "FundHub Awards", icon: Trophy },
    ],
  },
  {
    section: "More",
    items: [
      { href: "/rfi", label: "Request Quotes", icon: FileText },
      { href: "/independence", label: "Independence Charter", icon: ShieldCheck },
      { href: "/methodology", label: "Methodology & Data", icon: BookOpen },
      { href: "/for-providers", label: "For Service Providers", icon: Store },
    ],
  },
];

/** Minimal account info for the shell; null for regular visitors. */
export type ShellAccount = { name: string; accountType: "visitor" | "provider" } | null;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/compare") return pathname.startsWith("/compare") || pathname.startsWith("/providers");
  return pathname.startsWith(href);
}

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
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-ink-900 text-slate-200">
      <Link href="/" onClick={onNavigate} aria-label="FundHub home" className="flex h-16 flex-col justify-center border-b border-ink-700 px-5">
        <Wordmark tone="light" className="text-xl leading-none" />
        <span className="mt-1 block text-[10px] uppercase tracking-widest text-slate-400">Independent fund services comparator</span>
      </Link>

      <nav className="thin-scroll flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV.map(({ section, items }) => (
          <div key={section}>
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">{section}</p>
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                    active ? "bg-ink-700 font-medium text-white" : "text-slate-300 hover:bg-ink-800",
                  )}
                >
                  <Icon className={cn("h-4 w-4", active && "text-emerald")} />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

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

      <div className="space-y-2 border-t border-ink-700 p-4 text-[11px] leading-relaxed text-slate-400">
        <p className="flex items-center gap-1.5 font-semibold text-emerald">
          <Award className="h-3.5 w-3.5" /> Independent · No referral fees
        </p>
        <p>Paid by buyers, never by referrals. Rankings can&apos;t be bought.</p>
        <p className="text-slate-500">Public beta · fee ranges are indicative, not offers.</p>
      </div>
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
