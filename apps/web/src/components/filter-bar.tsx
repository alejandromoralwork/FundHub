"use client";

import { ChevronDown } from "lucide-react";
import { TECH_STACKS } from "@fundhub/db/schema";
import { SCALE_BANDS } from "@fundhub/core/filters";
import { getCategory, TAXONOMY } from "@fundhub/core/taxonomy";
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-emerald bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-ink-600 hover:border-slate-300",
      )}
    >
      {children}
    </button>
  );
}

export function FilterBar() {
  const { get, getList, update, toggleInList } = useFilterParams();
  const category = getCategory(get("category"));
  const services = getList("service");
  const stacks = getList("stack");

  return (
    <div className="space-y-2.5 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Service category"
          value={category?.slug ?? ""}
          // Sub-services belong to a category, so clear them when it changes.
          onChange={(c) => update({ category: c, service: undefined })}
          options={[
            { value: "", label: "All service categories" },
            ...TAXONOMY.map((c) => ({ value: c.slug, label: c.label })),
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

        {!category && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
            <span className="hidden text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:inline">
              Tech stack
            </span>
            {TECH_STACKS.slice(0, 5).map((s) => (
              <Chip key={s} active={stacks.includes(s)} onClick={() => toggleInList("stack", s)}>
                {s}
              </Chip>
            ))}
          </>
        )}
      </div>

      {category && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Services</span>
          {category.services.map((s) => (
            <Chip key={s} active={services.includes(s)} onClick={() => toggleInList("service", s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
