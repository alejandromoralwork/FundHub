import Link from "next/link";
import type { ProviderScore } from "@fundhub/core/score";
import { cn } from "@/lib/cn";

const GRADE_STYLE: Record<string, string> = {
  "A+": "bg-emerald text-white",
  A: "bg-emerald-600 text-white",
  B: "bg-sky-600 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-slate-400 text-white",
};

/** Compact FundHub Score: grade chip, 0–100 score, and Quality / Price sub-scores. */
export function ScoreBadge({ score, className, align = "end" }: { score: ProviderScore; className?: string; align?: "start" | "end" }) {
  return (
    <div className={cn("flex flex-col gap-1", align === "end" ? "md:items-end" : "items-start", className)}>
      <Link href="/fundhub-score" className="text-[10px] font-medium uppercase tracking-wide text-slate-400 hover:text-emerald-700">
        FundHub Score
      </Link>
      <div className="flex items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", GRADE_STYLE[score.grade])}>{score.grade}</span>
        <span className="tnum text-lg font-semibold leading-none text-ink">{score.fundhub}</span>
        <span className="text-[11px] text-slate-400">/100</span>
      </div>
      <p className="tnum text-[11px] text-slate-500">
        Quality {score.quality} · Price {score.price ?? "n/a"}
        {score.provisional && <span className="ml-1 text-amber-600" title="Fewer than 3 verified reviews">· provisional</span>}
      </p>
    </div>
  );
}

/** Horizontal bar for one sub-score on the provider page. */
export function ScoreBar({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="tnum font-semibold text-ink">{value ?? "n/a"}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald" style={{ width: `${value ?? 0}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
