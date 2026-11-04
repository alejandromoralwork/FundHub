/**
 * FILE: apps/web/src/components/stat-cards.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shows a strip of small "key number" tiles (e.g. number of providers, reviews, average score),
 *   each with an icon, a label, a big value and an optional hint line underneath.
 * WHERE IT RUNS: on the server (no "use client" line, so it is a Next.js server component that outputs HTML).
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). Rendering a list uses
 *   `.map(…)` and each item needs a unique `key`. Tailwind classes in `className` are small reusable styles,
 *   and prefixes like `md:` mean "only on medium-sized screens and wider".
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` = import only a type (it disappears from the compiled JavaScript).
 *   - type alias `type Stat = { … }` describing the shape of an object; `?` = optional field.
 *   - array type `Stat[]` = a list of Stat objects.
 *   - destructuring with renaming `icon: Icon` = take the `icon` field and call it `Icon` here.
 */

// `import { a } from "b"` brings named things from another file or library into this one.
// `LucideIcon` is the TypeScript type of any icon component from the `lucide-react` icon library (npm).
import type { LucideIcon } from "lucide-react";
// `cn` (from this app's src/lib/cn.ts) joins CSS class names, skipping empty/false ones.
import { cn } from "@/lib/cn";

/**
 * Kind: type alias (exported so pages building the stats list can use it).
 * The shape of one tile:
 *   - label   `string` — small caption, e.g. "Providers".
 *   - value   `string` — the big number, already formatted as text, e.g. "1,240".
 *   - icon    `LucideIcon` — the icon component to draw next to the label.
 *   - hint    `string`, optional — a small grey note under the value.
 *   - accent  `boolean` (true/false), optional — when true the value is drawn in emerald green to stand out.
 */
export type Stat = {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  accent?: boolean;
};

/**
 * Kind: React component (server component).
 * Props: stats — type `Stat[]`, the list of tiles to show, in order.
 * Returns: JSX — a <section> grid with one tile per stat.
 */
export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    // `aria-label` names the section for screen readers.
    // Layout trick: the grid has a 1px gap (`gap-px`) and a grey background (`bg-slate-200`); each tile is
    // white, so the grey shows through the gaps as thin divider lines. 2 columns on phones, 4 from `md:` up.
    <section
      aria-label="Ecosystem status"
      className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-4"
    >
      {/* `.map(…)` turns each Stat object into one tile. The arrow function destructures the object's fields.
          `icon: Icon` renames it with a capital letter because JSX treats capitalised names as components
          (<Icon />), while lower-case names would be read as plain HTML tags. */}
      {stats.map(({ label, value, icon: Icon, hint, accent }) => (
        // `key={label}` — the label is unique per tile, so React uses it to identify each item in the list.
        <div key={label} className="bg-white px-5 py-4">
          {/* Caption row: small (11px), upper-case, grey text with the icon in front. */}
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            <Icon className="h-3.5 w-3.5" /> {label}
          </p>
          {/* The big value. `tnum` is a custom class for "tabular numbers" (all digits the same width).
              The ternary picks emerald when `accent` is true, otherwise the normal ink colour. */}
          <p className={cn("mt-1 text-2xl font-semibold tnum", accent ? "text-emerald-700" : "text-ink")}>{value}</p>
          {/* `hint && …` = only render the hint paragraph if a hint was given. */}
          {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
        </div>
      ))}
    </section>
  );
}
