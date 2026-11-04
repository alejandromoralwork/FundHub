"use client";
/**
 * FILE: apps/web/src/components/mobile-filters.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: On small and medium screens the filter side panel of the provider directory is hidden. This
 *   component shows a "More filters" button instead; clicking it opens/closes the same filters inline.
 *   A small green badge on the button shows how many filters are currently active.
 * WHERE IT RUNS: in the browser ("use client" on the first line), because it remembers whether the panel is
 *   open and responds to clicks — both need JavaScript running in the browser.
 * FRAMEWORK NOTES:
 *   - `useState` is a React hook that gives a component a remembered value ("state") plus a function to
 *     change it. Changing state makes React redraw the component with the new value.
 *   - Tailwind's `xl:hidden` = hide this on extra-large screens (where the real side panel is visible).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Record<string, number>` = an object whose keys are text and values are numbers, e.g. { bank: 12 }.
 *   - array destructuring `const [open, setOpen] = …`; arrow functions; logical `&&` and NOT `!`.
 */

// `import { a } from "b"` brings named things from another file or library into this one.
// An icon of slider controls from the `lucide-react` icon library (npm).
import { SlidersHorizontal } from "lucide-react";
// The `useState` hook from React (npm).
import { useState } from "react";
// The filter panel itself, from filter-pane.tsx in this same folder (`./`).
import { FilterPane } from "./filter-pane";

/**
 * Below xl the side pane is hidden; this exposes the same filters inline.
 *
 * Kind: React component (client component).
 * Props:
 *   - typeCounts   type `Record<string, number>` — how many providers exist per provider type; passed on
 *                  to the filter panel so it can show counts next to each option.
 *   - activeCount  type `number` — how many filters are currently switched on (shown in the badge).
 * Returns: JSX — the toggle button and, when open, the filter panel.
 */
export function MobileFilters({ typeCounts, activeCount }: { typeCounts: Record<string, number>; activeCount: number }) {
  // State: `open` starts as `false` (panel closed). `setOpen` changes it and triggers a redraw.
  const [open, setOpen] = useState(false);
  return (
    // The whole block disappears on extra-large screens (`xl:hidden`), where the side panel shows instead.
    <div className="xl:hidden">
      <button
        // `type="button"` stops the button from submitting any surrounding form.
        type="button"
        // Tells screen readers whether the panel controlled by this button is currently open.
        aria-expanded={open}
        // Click handler: flip the state. `setOpen((o) => !o)` passes a function that receives the current
        // value `o` and returns its opposite; this form is safest when the new value depends on the old one.
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-slate-50"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        More filters
        {/* Show the round green count badge only when at least one filter is active. */}
        {activeCount > 0 && (
          <span className="rounded-full bg-emerald px-1.5 text-[10px] font-semibold text-white tnum">{activeCount}</span>
        )}
      </button>
      {/* When `open` is true, render the filter panel in a white bordered box under the button. */}
      {open && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white">
          <FilterPane typeCounts={typeCounts} />
        </div>
      )}
    </div>
  );
}
