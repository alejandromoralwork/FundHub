"use client";

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFilterParams } from "./use-filter-params";

export function TopSearch() {
  const { get, update, isPending, pathname } = useFilterParams();
  const urlQuery = pathname === "/" ? get("q") : "";
  const [value, setValue] = useState(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep the input in sync when the URL changes elsewhere (reset, back button).
  useEffect(() => setValue(urlQuery), [urlQuery]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim() !== urlQuery) update({ q: q.trim() });
  };

  return (
    <form
      role="search"
      className="relative max-w-2xl flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        commit(value);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        aria-label="Search providers"
        value={value}
        onChange={(e) => {
          const q = e.target.value;
          setValue(q);
          // Live-filter on the comparator; elsewhere wait for Enter.
          if (pathname === "/") {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(q), 300);
          }
        }}
        placeholder="Search fund service providers, software stacks, or regulations..."
        className="w-full rounded-md border border-slate-200 bg-canvas py-2.5 pl-10 pr-10 text-sm text-ink placeholder:text-slate-400 focus:border-emerald focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald/20 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2">
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue("");
              commit("");
            }}
            className="flex text-slate-400 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </span>
    </form>
  );
}
