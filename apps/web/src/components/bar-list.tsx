/**
 * FILE: apps/web/src/components/bar-list.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: A simple horizontal bar chart drawn with plain HTML and Tailwind (no chart library). Each
 *   row shows a label, a green bar whose length is proportional to the value, and the value as text.
 *   Used on statistics pages such as fees and rankings.
 * WHERE IT RUNS: wherever the page using it runs (normally on the server). No `"use client"`, no
 *   interactivity: the hover tooltip is the browser's built-in `title` tooltip.
 * FRAMEWORK NOTES: A React component is a function that takes "props" and returns JSX markup.
 *   Tailwind classes style it; `grid-cols-[...]` defines a CSS grid with custom column widths.
 *   `style={{ ... }}` sets inline CSS when a value must be calculated (here the bar width).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - inline object types for props, written over several lines, with optional fields (`hint?:`).
 *   - arrays of objects (`{ ... }[]`), nullish coalescing `a ?? b`, template strings `${...}`.
 *   - spread into a function call (`Math.max(...list)`).
 */

/**
 * Single-series horizontal bar list (one hue, magnitude). Values are printed as text,
 * so color is never the only carrier; each row has a native hover tooltip.
 */
/**
 * Kind: React component.
 * Props (destructured from one object):
 *   rows: an array of `{ label: string; value: number; display: string; hint?: string }`:
 *     label = row name, value = the number that sets the bar length, display = the text shown on the right
 *     (e.g. "€45k"), hint = optional longer text for the hover tooltip.
 *   max?: number, optional: the value that counts as a full-length bar. If missing, the largest row value.
 *   caption?: string, optional: small note under the chart (e.g. the data source).
 * Returns: JSX, a <figure> holding the list of bars.
 */
export function BarList({
  rows,
  max,
  caption,
}: {
  rows: { label: string; value: number; display: string; hint?: string }[];
  max?: number;
  caption?: string;
}) {
  // The value of a full bar. `max ?? x` = use `max` if given, otherwise `x`. `rows.map((r) => r.value)`
  // makes a list of the numbers; `...` spreads them as separate arguments into `Math.max`. The extra `1`
  // guarantees at least 1, so we never divide by zero (and an empty list does not give -Infinity).
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <figure>
      {/* `space-y-2` = small vertical gap between rows. */}
      <ul className="space-y-2">
        {/* One <li> per row; `key={r.label}` is the unique id React uses to track list items.
            `title` gives the native tooltip: "label: hint", or "label: display" when there is no hint.
            The grid has three columns: label (up to 10rem, 14rem from `sm:` width up), bar (`1fr` = all
            remaining space) and value (`auto` = as wide as its text). */}
        {rows.map((r) => (
          <li
            key={r.label}
            title={`${r.label}: ${r.hint ?? r.display}`}
            className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 rounded px-1 py-0.5 text-xs hover:bg-canvas sm:grid-cols-[minmax(0,14rem)_1fr_auto]"
          >
            <span className="truncate text-ink-600">{r.label}</span>
            {/* Grey track with the green bar inside. Width = value as a percentage of `top`; `Math.max(2, ...)`
                keeps tiny values at least 2% wide so they stay visible. `style={{ width: "..%" }}`: the
                outer braces insert a value, the inner braces are the CSS object. */}
            <span className="h-2 rounded-full bg-slate-100">
              <span
                className="block h-2 rounded-full bg-emerald"
                style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }}
              />
            </span>
            {/* The value as text, right-aligned with evenly spaced digits (`tnum`). */}
            <span className="tnum w-16 text-right font-medium text-ink">{r.display}</span>
          </li>
        ))}
      </ul>
      {/* Optional caption under the chart. */}
      {caption && <figcaption className="mt-3 text-[11px] text-slate-400">{caption}</figcaption>}
    </figure>
  );
}
