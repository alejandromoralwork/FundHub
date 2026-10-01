"use client";

import { ChevronDown } from "lucide-react";
import { CATEGORIES, TECH_STACKS } from "@/db/schema";
import { SCALE_BANDS } from "@/lib/filters";
import { cn } from "@/lib/cn";
import { useFilterParams } from "./use-filter-params";

export function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-ink-600 focus:border-emerald focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function FilterBar() {
  const { get, getList, update, toggleInList } = useFilterParams();
  const stacks = getList("stack");

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <Select
        label="Macro-category"
        value={get("category")}
        onChange={(category) => update({ category })}
        options={[
          { value: "", label: "Macro-Category: All" },
          ...CATEGORIES.map((c) => ({ value: c, label: c })),
        ]}
      />
      <Select
        label="Scale / headcount"
        value={get("scale")}
        onChange={(scale) => update({ scale })}
        options={[
          { value: "", label: "Scale / Headcount: Any" },
          ...Object.entries(SCALE_BANDS).map(([value, b]) => ({ value, label: `${b.label} staff` })),
        ]}
      />

      <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
      <span className="hidden text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:inline">
        Tech stack
      </span>

      {TECH_STACKS.map((s) => {
        const active = stacks.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => toggleInList("stack", s)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-emerald bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-white text-ink-600 hover:border-slate-300",
            )}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
