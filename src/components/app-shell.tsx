"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BookOpen, FileText, Layers, Menu, Plus, Search, TrendingUp, X, type LucideIcon } from "lucide-react";
import { TopSearch } from "./top-search";
import { cn } from "@/lib/cn";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Discovery", items: [{ href: "/", label: "Comparator Grid", icon: Search }] },
  {
    section: "Intelligence",
    items: [
      { href: "/benchmarks", label: "Fee Benchmarks", icon: TrendingUp },
      { href: "/rfi", label: "Request an RFI", icon: FileText },
    ],
  },
  { section: "Platform", items: [{ href: "/about", label: "Methodology & API", icon: BookOpen }] },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/providers") : pathname.startsWith(href);
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-ink-900 text-slate-200">
      <Link href="/" onClick={onNavigate} className="flex h-16 items-center gap-2.5 border-b border-ink-700 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald text-white">
          <Layers className="h-4 w-4" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-white">
            FundHub<span className="text-emerald"> Lux</span>
          </span>
          <span className="block text-[10px] uppercase tracking-widest text-slate-400">Fund Services Index</span>
        </span>
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

      <div className="border-t border-ink-700 p-4 text-[11px] leading-relaxed text-slate-400">
        <p className="font-medium text-slate-300">Public beta · v0.1</p>
        <p>Fee ranges are indicative quarterly quotes, not offers.</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
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
        <Sidebar />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink-900/50"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
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
              className="flex items-center gap-2 rounded-md bg-ink-900 px-3 py-2 text-sm font-medium text-white hover:bg-ink-800 sm:px-4"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New RFI</span>
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
