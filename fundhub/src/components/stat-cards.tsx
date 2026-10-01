import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Stat = {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  accent?: boolean;
};

export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <section
      aria-label="Ecosystem status"
      className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-4"
    >
      {stats.map(({ label, value, icon: Icon, hint, accent }) => (
        <div key={label} className="bg-white px-5 py-4">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <Icon className="h-3.5 w-3.5" /> {label}
          </p>
          <p className={cn("mt-1 text-2xl font-semibold tnum", accent ? "text-emerald-700" : "text-ink")}>{value}</p>
          {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
        </div>
      ))}
    </section>
  );
}
