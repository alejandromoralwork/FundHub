/**
 * FILE: apps/web/src/components/score-badge.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Two small display pieces for the FundHub Score:
 *   - ScoreBadge: a compact block with a coloured grade chip (A+, A, B, C, D), the 0–100 score and the Quality
 *     and Price sub-scores, used on provider cards and pages.
 *   - ScoreBar: a labelled horizontal progress bar for one sub-score on the provider page.
 * WHERE IT RUNS: on the server (no "use client" line, so these are Next.js server components outputting HTML).
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). One file may export several
 *   components. Tailwind classes in `className` are small styles; `md:` = only on medium screens and wider.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` = import a type only; `Record<string, string>` = object with text keys and text values.
 *   - union types `"start" | "end"` and `number | null`; nullish coalescing `a ?? b`.
 *   - optional props `?`, default values `align = "end"`, ternaries and `&&`.
 */

// `import X from "b"` imports a file's default export; `{ a }` picks named exports.
// Next.js's <Link>, a link that changes page without a full browser reload.
import Link from "next/link";
// The type describing a provider's computed score (grade, fundhub, quality, price, provisional, …), from our
// shared package packages/core (`@fundhub/…` = our own packages).
import type { ProviderScore } from "@fundhub/core/score";
// `cn` (this app's src/lib/cn.ts) joins CSS class names, skipping empty/undefined ones.
import { cn } from "@/lib/cn";

/**
 * Kind: constant lookup table.
 * Maps each grade to the Tailwind colours of its chip: emerald greens for the best grades, then blue (sky),
 * amber and grey. `"A+"` needs quotes because `+` is not allowed in a bare property name.
 */
const GRADE_STYLE: Record<string, string> = {
  "A+": "bg-emerald text-white",
  A: "bg-emerald-600 text-white",
  B: "bg-sky-600 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-slate-400 text-white",
};

/**
 * Compact FundHub Score: grade chip, 0–100 score, and Quality / Price sub-scores.
 *
 * Kind: React component (server component).
 * Props:
 *   - score      type `ProviderScore` — the provider's computed score.
 *   - className  type `string`, optional — extra classes from the caller.
 *   - align      type `"start" | "end"`, optional, default "end" — "end" right-aligns the block on medium+
 *                screens (for the right edge of a card); "start" keeps it left-aligned.
 * Returns: JSX — the badge block.
 */
export function ScoreBadge({ score, className, align = "end" }: { score: ProviderScore; className?: string; align?: "start" | "end" }) {
  return (
    // A vertical stack (`flex flex-col`) whose alignment depends on `align`.
    <div className={cn("flex flex-col gap-1", align === "end" ? "md:items-end" : "items-start", className)}>
      {/* Small caption that links to the page explaining how the FundHub Score is calculated. */}
      <Link href="/fundhub-score" className="text-[10px] font-medium uppercase tracking-wide text-slate-400 hover:text-emerald-700">
        FundHub Score
      </Link>
      <div className="flex items-center gap-2">
        {/* Grade chip: `GRADE_STYLE[score.grade]` looks up the colours for this grade in the table above. */}
        <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", GRADE_STYLE[score.grade])}>{score.grade}</span>
        {/* The overall 0–100 number (`tnum` = digits of equal width), followed by a small grey "/100". */}
        <span className="tnum text-lg font-semibold leading-none text-ink">{score.fundhub}</span>
        <span className="text-[11px] text-slate-400">/100</span>
      </div>
      {/* Sub-scores line. `score.price ?? "n/a"` shows "n/a" when there is no price score (null). */}
      <p className="tnum text-[11px] text-slate-500">
        Quality {score.quality} · Price {score.price ?? "n/a"}
        {/* Business rule: with fewer than 3 verified reviews the score is "provisional"; flag it in amber.
            `title` shows the explanation as a tooltip when hovering. */}
        {score.provisional && <span className="ml-1 text-amber-600" title="Fewer than 3 verified reviews">· provisional</span>}
      </p>
    </div>
  );
}

/**
 * Horizontal bar for one sub-score on the provider page.
 *
 * Kind: React component (server component).
 * Props:
 *   - label  type `string` — the sub-score's name, e.g. "Quality".
 *   - value  type `number | null` — the score 0–100, or null when it cannot be computed.
 *   - hint   type `string` — a short explanation shown under the bar.
 * Returns: JSX — label and number on one line, the bar, then the hint.
 */
export function ScoreBar({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div>
      {/* Label on the left, number on the right (`justify-between`), sharing a text baseline. */}
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="tnum font-semibold text-ink">{value ?? "n/a"}</span>
      </div>
      {/* The track: a thin (h-1.5), rounded, light grey bar. `overflow-hidden` clips the green fill inside it. */}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        {/* The green fill, as wide as the score in percent (a score of 72 → width 72%). Null counts as 0%. */}
        <div className="h-full rounded-full bg-emerald" style={{ width: `${value ?? 0}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </div>
  );
}
