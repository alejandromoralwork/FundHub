"use client";
/**
 * FILE: apps/web/src/components/top-search.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The big search box in the site header. On the comparator page (/compare) it filters the list
 *   live as you type (after a short pause). On any other page it waits for Enter and then takes you to the
 *   comparator with your search applied. It shows a spinner while results load and an "X" to clear the text.
 * WHERE IT RUNS: in the browser ("use client" on the first line), since it reacts to typing and keeps state.
 * FRAMEWORK NOTES:
 *   - `useState` = a remembered value plus a setter that redraws the component when called.
 *   - `useEffect(fn, [deps])` = run `fn` after React draws the component, and again whenever a value in the
 *     dependency list changes. If `fn` returns a function, React calls that "clean-up" before re-running or
 *     when the component is removed from the page.
 *   - `useRef` = a box (`.current`) that keeps a value between redraws WITHOUT causing a redraw when changed.
 *   - Event handlers like `onChange`/`onSubmit`/`onClick` receive an event object `e` describing what happened.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generics `useRef<T>(…)`; `ReturnType<typeof setTimeout>` = "whatever type setTimeout returns"
 *     (it differs between browsers and Node, so we ask TypeScript instead of hard-coding it).
 *   - arrow functions, ternaries (including a chained `a ? x : b ? y : z`), `null` = render nothing.
 */

// `import { a } from "b"` brings named things from another file or library into this one.
// Icons from `lucide-react` (npm): a spinning loader, a magnifying glass, and an X for "clear".
import { Loader2, Search, X } from "lucide-react";
// React hooks (from the `react` npm package), explained in the header above.
import { useEffect, useRef, useState } from "react";
// Our hook for reading/writing filters in the URL, and the comparator's path ("/compare"), from this folder.
import { COMPARATOR_PATH, useFilterParams } from "./use-filter-params";

/**
 * Kind: React component (client component). Takes no props.
 * Returns: JSX — a search <form> with an icon, the text input and a spinner/clear button on the right.
 */
export function TopSearch() {
  // From our hook: read a URL value, update URL values, "is loading" flag, and the current page path.
  const { get, update, isPending, pathname } = useFilterParams();
  // The search text currently in the URL — only meaningful on the comparator, so elsewhere it is "".
  const urlQuery = pathname === COMPARATOR_PATH ? get("q") : "";
  // What is typed in the box right now. Starts with the URL's text. Kept separately from the URL so typing
  // feels instant while the URL is updated with a delay.
  const [value, setValue] = useState(urlQuery);
  // Holds the ID of the pending delay timer (or undefined) so we can cancel it. A ref is used because changing
  // the timer should not redraw anything.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keep the input in sync when the URL changes elsewhere (reset, back button).
  // Runs every time `urlQuery` changes, copying it into the box.
  useEffect(() => setValue(urlQuery), [urlQuery]);
  // Empty dependency list `[]` = run once when the component appears. It returns a clean-up function
  // (`() => clearTimeout(…)`) that React calls when the component disappears, so no stray timer fires later.
  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * Kind: function (arrow function stored in a const).
   * @param q  type `string` — the search text to apply.
   * Cancels any pending delayed search, then writes the trimmed text into the URL — but only if it actually
   * differs from what the URL already has, to avoid pointless navigation. `.trim()` removes edge spaces.
   */
  const commit = (q: string) => {
    clearTimeout(timer.current);
    if (q.trim() !== urlQuery) update({ q: q.trim() });
  };

  return (
    <form
      // `role="search"` tells assistive technology this form is a search area.
      role="search"
      // `relative` lets the icons be positioned on top of the input; `flex-1` lets it grow in the header.
      className="relative max-w-2xl flex-1"
      // Submit handler (pressing Enter). `e.preventDefault()` stops the browser's normal behaviour of
      // reloading the page to submit the form; we apply the search ourselves instead.
      onSubmit={(e) => {
        e.preventDefault();
        commit(value);
      }}
    >
      {/* Magnifying glass drawn inside the left edge of the input. `absolute left-3 top-1/2 -translate-y-1/2`
          centres it vertically; `pointer-events-none` lets clicks pass through it to the input. */}
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        aria-label="Search providers"
        // A "controlled input": React decides what the box shows (`value`), and onChange updates that state.
        value={value}
        // Called on every keystroke. `e.target` is the input element; `.value` is its new text.
        onChange={(e) => {
          const q = e.target.value;
          setValue(q);
          // Live-filter on the comparator; elsewhere wait for Enter.
          // "Debounce": cancel the previous timer and start a new 300 ms one, so the URL only updates once the
          // user pauses typing rather than on every single letter.
          if (pathname === COMPARATOR_PATH) {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(q), 300);
          }
        }}
        placeholder="Search providers, services, software stacks or regulations…"
        // Styles: full width, padding left/right (pl-10 pr-10) to leave room for the icons, `focus:` styles while
        // typing (green border, white background, soft green ring). The last class, in square brackets, is a
        // Tailwind "arbitrary variant" that hides the browser's own built-in clear button (we draw our own X).
        className="w-full rounded-md border border-slate-200 bg-canvas py-2.5 pl-10 pr-10 text-sm text-ink placeholder:text-slate-400 focus:border-emerald focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {/* Right-hand slot, vertically centred inside the input. */}
      <span className="absolute right-3 top-1/2 -translate-y-1/2">
        {/* Chained ternary: while loading → spinner; else if there is text → clear button; else → nothing. */}
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        ) : value ? (
          <button
            type="button"
            aria-label="Clear search"
            // Empty the box and remove the search from the URL straight away.
            onClick={() => {
              setValue("");
              commit("");
            }}
            className="flex text-slate-400 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </span>
    </form>
  );
}
