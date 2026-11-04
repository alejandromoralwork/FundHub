"use client";

/**
 * FILE: apps/web/src/components/filter-pane.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The side panel of detailed filters on the provider comparator ("Strict Parameters"):
 *   two sliders for the quarterly fee range, checkboxes for provider type (with how many providers of each
 *   type), a slider for the minimum number of active client mandates, and checkboxes for asset classes,
 *   licences, regulatory scope and tech stack. A "Reset all" button clears every filter.
 *   Every filter is stored in the page URL, so the results (drawn on the server) follow it.
 * WHERE IT RUNS: in the browser (`"use client"`): sliders and checkboxes need to react instantly.
 * FRAMEWORK NOTES: Changing the URL makes Next.js fetch new results from the server. Doing that on every
 *   pixel of a slider drag would be slow, so the sliders keep their own local value (useState) for smooth
 *   movement and only write to the URL once the user pauses for 350 ms ("debouncing").
 *   `useFilterParams` is our own custom hook (in this folder) that reads and updates the URL's filters.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Record<string, number | undefined>`: an object with any string keys whose values are numbers or undefined.
 *   - `ReturnType<typeof setTimeout>`: "whatever type setTimeout returns" (it differs between browser and Node).
 *   - `readonly string[]`: an array that may not be changed. Default parameters (`ms = 350`).
 *   - functions returning functions, array destructuring with a ternary (`const [lo, hi] = c ? [a, b] : [b, a]`).
 *   - `Number(x) || fallback`: convert to a number, using the fallback when it is 0 or not a number.
 */

// `import { a } from "b"` pulls named things from a module. Plain names = npm libraries,
// `@fundhub/...` = our shared packages, `./...` = a file in this folder.

// React hooks: useEffect (run after drawing), useRef (a value kept between draws without redrawing),
// useState (a remembered value that redraws when changed).
import { useEffect, useRef, useState } from "react";
// The fixed option lists for the checkbox groups, defined alongside the database schema.
import { ASSET_CLASSES, LICENCES, PROVIDER_TYPES, REGULATORY_SCOPES, TECH_STACKS } from "@fundhub/db/schema";
// Slider limits: lowest and highest fee shown, and highest "density" (mandates) value.
import { DENSITY_CEILING, PRICE_CEILING, PRICE_FLOOR } from "@fundhub/core/filters";
// Formats a number with thousands separators, e.g. 6000 → "6,000".
import { formatNumber } from "@fundhub/core/format";
// Our custom hook for reading/changing the filters in the URL.
import { useFilterParams } from "./use-filter-params";

/**
 * Kind: custom React hook (a function starting with `use` that uses other hooks).
 * @param fn  `(v: Record<string, number | undefined>) => void`: the function to call (here: update the URL).
 * @param ms  `number`, default 350: how many milliseconds of quiet to wait before calling `fn`.
 * @returns   a new function with the same input. Each call cancels the previous waiting call and starts the
 *            timer again, so `fn` only runs once the user stops moving the slider.
 */
function useDebounced(fn: (v: Record<string, number | undefined>) => void, ms = 350) {
  // Holds the id of the pending timer. A ref survives redraws and changing it does not cause a redraw.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // On leaving the page (component removed), cancel any pending timer. `() => () => ...` is an effect whose
  // only job is to return the clean-up function; `[]` = set up once.
  useEffect(() => () => clearTimeout(timer.current), []);
  // The debounced function: cancel the old timer, then schedule `fn(v)` to run after `ms` milliseconds.
  return (v: Record<string, number | undefined>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(v), ms);
  };
}

/**
 * Kind: React component written as an arrow function stored in a constant.
 * Props: children: React.ReactNode, the heading text. Returns: a small grey upper-case heading.
 * `=> ( ... )` returns the markup directly without a `return` statement.
 */
const Heading = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</p>
);

/**
 * Kind: React component. A titled group of checkboxes.
 * Props:
 *   title: string, the group heading.
 *   options: `readonly string[]`, the choices (read-only lists from the schema).
 *   selected: string[], the choices currently ticked.
 *   onToggle: `(v: string) => void`, called with an option when its box is clicked.
 *   counts?: optional `Record<string, number>`, how many providers match each option (shown on the right).
 * Returns: JSX.
 */
function CheckGroup({
  title,
  options,
  selected,
  onToggle,
  counts,
}: {
  title: string;
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  counts?: Record<string, number>;
}) {
  return (
    // <fieldset>/<legend> group the boxes under one title for screen readers.
    <fieldset className="space-y-2.5">
      <legend className="mb-2.5">
        <Heading>{title}</Heading>
      </legend>
      {/* One clickable row per option. Wrapping the checkbox in <label> makes the whole row clickable.
          `checked={...}` makes it a controlled checkbox: ticked exactly when the URL says so. */}
      {options.map((o) => (
        <label key={o} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-600">
          <input type="checkbox" className="check h-4 w-4" checked={selected.includes(o)} onChange={() => onToggle(o)} />
          {o}
          {/* The count, pushed to the right (`ml-auto`); `counts[o] ?? 0` shows 0 for options with no entry. */}
          {counts && <span className="ml-auto text-xs tnum text-slate-400">{counts[o] ?? 0}</span>}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Kind: React component (exported; the comparator page places it in its side column).
 * Props: typeCounts: `Record<string, number>`, number of providers per provider type, worked out on the server.
 * Returns: JSX for the whole filter panel.
 */
export function FilterPane({ typeCounts }: { typeCounts: Record<string, number> }) {
  // URL helpers from our hook (see filter-bar.tsx for what each does); `reset` clears all filters.
  const { get, getList, update, toggleInList, reset } = useFilterParams();

  // Current values from the URL. `Number("")` is 0, and `0 || x` gives x, so a missing value falls back to
  // the slider's end point (or 0 = "Any" for density).
  const urlMin = Number(get("min")) || PRICE_FLOOR;
  const urlMax = Number(get("max")) || PRICE_CEILING;
  const urlDensity = Number(get("density")) || 0;

  // Local slider state so dragging is smooth; URL is updated debounced.
  const [min, setMin] = useState(urlMin);
  const [max, setMax] = useState(urlMax);
  const [density, setDensity] = useState(urlDensity);
  // If the URL changes from elsewhere (e.g. "Reset all", the browser back button), copy it into the sliders.
  useEffect(() => setMin(urlMin), [urlMin]);
  useEffect(() => setMax(urlMax), [urlMax]);
  useEffect(() => setDensity(urlDensity), [urlDensity]);

  // Debounced versions of `update` (separate timers, so a price drag and a density drag do not cancel each other).
  const commitDensity = useDebounced(update);
  const commitPriceBounds = useDebounced(update);
  // Kind: arrow function. Writes the price range to the URL, leaving out a bound that sits at the slider's
  // end (`undefined` removes it), so "no price filter" keeps a clean URL.
  const commitPrice = (lo: number, hi: number) =>
    commitPriceBounds({
      min: lo > PRICE_FLOOR ? lo : undefined,
      max: hi < PRICE_CEILING ? hi : undefined,
    });

  // The two sliders may cross (the "min" knob dragged past "max"). For display, always show the smaller as
  // lo and the larger as hi. Array destructuring picks `[min, max]` or the swapped pair.
  const [lo, hi] = min <= max ? [min, max] : [max, min];

  return (
    // `space-y-6` = generous gaps between sections; `p-5` = padding all round.
    <div className="space-y-6 p-5">
      {/* Title row with "Reset all" on the right. `onClick={reset}` passes the function itself (no brackets),
          so it runs on click. */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Strict Parameters</h2>
        <button type="button" onClick={reset} className="text-xs font-medium text-emerald-700 hover:underline">
          Reset all
        </button>
      </div>

      {/* Price range. Labels show the current values; a "+" after the max when it is at the ceiling,
          meaning "and above". */}
      <div className="space-y-3">
        <Heading>Price Bounds (€/qtr)</Heading>
        <div className="flex items-center justify-between text-xs tnum text-ink-600">
          <span>Min €{formatNumber(lo)}</span>
          <span>
            Max €{formatNumber(hi)}
            {hi >= PRICE_CEILING && "+"}
          </span>
        </div>
        {/* Minimum slider (`type="range"`), moving in steps of €100. On each move: convert the text value to
            a number, update the local state at once (smooth), then send the sorted pair to the debounced
            URL update. `Math.min/Math.max` keep lo ≤ hi even if the knobs crossed. */}
        <input
          type="range"
          className="range w-full"
          aria-label="Minimum quarterly fee"
          min={PRICE_FLOOR}
          max={PRICE_CEILING}
          step={100}
          value={min}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMin(v);
            commitPrice(Math.min(v, max), Math.max(v, max));
          }}
        />
        {/* Maximum slider, same idea. */}
        <input
          type="range"
          className="range w-full"
          aria-label="Maximum quarterly fee"
          min={PRICE_FLOOR}
          max={PRICE_CEILING}
          step={100}
          value={max}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMax(v);
            commitPrice(Math.min(min, v), Math.max(min, v));
          }}
        />
      </div>

      {/* A thin divider line between sections. */}
      <hr className="border-slate-100" />

      {/* Provider type checkboxes, with counts. Ticking one toggles it in the URL's "type" list. */}
      <CheckGroup
        title="Provider Type"
        options={PROVIDER_TYPES}
        selected={getList("type")}
        onToggle={(v) => toggleInList("type", v)}
        counts={typeCounts}
      />

      <hr className="border-slate-100" />

      {/* Minimum number of active client mandates. 0 shows as "Any"; otherwise e.g. "25+". */}
      <div className="space-y-3">
        <Heading>Client Portfolio Density</Heading>
        <div className="flex items-center justify-between text-xs tnum text-ink-600">
          <span>Min. active mandates</span>
          <span className="font-medium text-ink">{density ? `${density}+` : "Any"}</span>
        </div>
        {/* `v || undefined`: a value of 0 becomes undefined, which removes "density" from the URL. */}
        <input
          type="range"
          className="range w-full"
          aria-label="Minimum active client mandates"
          min={0}
          max={DENSITY_CEILING}
          step={5}
          value={density}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDensity(v);
            commitDensity({ density: v || undefined });
          }}
        />
      </div>

      <hr className="border-slate-100" />

      {/* The remaining checkbox groups all follow the same pattern; the first argument of toggleInList is the
          URL key ("asset", "licence", "reg", "stack"). */}
      <CheckGroup
        title="Asset Classes"
        options={ASSET_CLASSES}
        selected={getList("asset")}
        onToggle={(v) => toggleInList("asset", v)}
      />

      <hr className="border-slate-100" />

      <CheckGroup
        title="Licences & Authorisations"
        options={LICENCES}
        selected={getList("licence")}
        onToggle={(v) => toggleInList("licence", v)}
      />

      <hr className="border-slate-100" />

      <CheckGroup
        title="Regulatory Scope"
        options={REGULATORY_SCOPES}
        selected={getList("reg")}
        onToggle={(v) => toggleInList("reg", v)}
      />

      <hr className="border-slate-100" />

      <CheckGroup
        title="Tech Stack"
        options={TECH_STACKS}
        selected={getList("stack")}
        onToggle={(v) => toggleInList("stack", v)}
      />
    </div>
  );
}
