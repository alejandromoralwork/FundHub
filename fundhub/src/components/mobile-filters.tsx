"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { FilterPane } from "./filter-pane";

/** Below xl the side pane is hidden; this exposes the same filters inline. */
export function MobileFilters({ typeCounts, activeCount }: { typeCounts: Record<string, number>; activeCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="xl:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-slate-50"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        More filters
        {activeCount > 0 && (
          <span className="rounded-full bg-emerald px-1.5 text-[10px] font-semibold text-white tnum">{activeCount}</span>
        )}
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white">
          <FilterPane typeCounts={typeCounts} />
        </div>
      )}
    </div>
  );
}
