"use client";
/**
 * FILE: apps/web/src/components/use-filter-params.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A custom React "hook" that every filter control (search box, sort dropdown, checkboxes, …)
 *   uses to read and change the filters of the provider comparator. The filters live in the page URL's query
 *   string, e.g. /compare?q=luxembourg&type=bank,depositary&sort=fee, so a filtered view can be shared as a link.
 * WHERE IT RUNS: in the browser ("use client" on the first line), because it reads the current URL and
 *   navigates to new URLs in response to what the user does.
 * FRAMEWORK NOTES:
 *   - A "hook" is a function whose name starts with `use`. It may only be called at the top level of a React
 *     component (or another hook). It lets components share stateful logic. Hooks used here:
 *     `useRouter` (navigate to another URL), `usePathname` (the path part, e.g. "/compare"),
 *     `useSearchParams` (the `?a=b` part), `useTransition` (do an update "in the background" and know while it
 *     is in progress), `useCallback` (keep the same function object between redraws unless its inputs change).
 *   - This file is .ts, not .tsx, because it contains no JSX markup.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - nullish coalescing `a ?? b` = use `b` only when `a` is null/undefined.
 *   - `Record<string, A | B>` = an object with text keys whose values have one of several types (union `|`).
 *   - `for (const [key, value] of …)` loops; `Array.isArray`; nested ternaries `c1 ? x : c2 ? y : z`.
 *   - computed property names `{ [key]: value }`; spread `[...list, value]`.
 */

// `import { a } from "b"` brings named things from a library into this file.
// `next/navigation` = Next.js's hooks for reading the URL and navigating (App Router version).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// React's built-in hooks (from the `react` npm package).
import { useCallback, useTransition } from "react";

/**
 * Kind: constant (exported). The URL path of the provider comparator page, where filters apply.
 * Kept in one place so other files (e.g. top-search.tsx) compare against the same value.
 */
export const COMPARATOR_PATH = "/compare";

/**
 * Reads and writes comparator filters in the URL query string.
 *
 * Kind: custom React hook (a function that calls other hooks).
 * Parameters: none.
 * Returns: an object with
 *   - get(key)               → `string`: one filter value, or "" if absent.
 *   - getList(key)           → `string[]`: a comma-separated filter split into a list.
 *   - update(changes)        → sets/removes several filters and navigates.
 *   - toggleInList(key, v)   → adds v to a list filter, or removes it if already there.
 *   - reset()                → clears all filters.
 *   - isPending              → `boolean`, true while the new filtered page is loading.
 *   - pathname               → `string`, the current page path.
 */
export function useFilterParams() {
  // Access to Next.js navigation (push/replace URLs).
  const router = useRouter();
  // The current path, e.g. "/compare" or "/rfi".
  const pathname = usePathname();
  // The current query string as a read-only object with .get(name).
  const searchParams = useSearchParams();
  // `useTransition` returns [isPending, startTransition]. Navigation started inside startTransition is
  // marked non-urgent: the current page stays usable and `isPending` is true until the new one is ready.
  const [isPending, startTransition] = useTransition();

  // Kind: function (memoised with useCallback). Returns the value of `key` from the URL, or "" if missing.
  // `useCallback(fn, [searchParams])` = reuse the same function until `searchParams` changes; the list in
  // square brackets is the "dependency list" React watches.
  const get = useCallback((key: string) => searchParams.get(key) ?? "", [searchParams]);

  // Kind: function. For list filters stored like "bank,depositary": split on commas into an array.
  // `.filter(Boolean)` drops empty strings, so a missing value gives [] instead of [""].
  const getList = useCallback(
    (key: string) => (searchParams.get(key) ?? "").split(",").filter(Boolean),
    [searchParams],
  );

  /** Set several params at once; empty string / empty array / undefined removes the key. */
  // Kind: function. Parameter `changes`: an object like { sort: "fee", type: ["bank"], q: undefined }.
  // Each value may be a string, a list of strings, a number, or undefined (= remove that filter).
  const update = useCallback(
    (changes: Record<string, string | string[] | number | undefined>) => {
      // Other pages' query params (e.g. /rfi?provider=) don't belong on the comparator.
      // So: on the comparator, start from the existing filters; anywhere else, start from an empty query.
      const onComparator = pathname === COMPARATOR_PATH;
      // `URLSearchParams` is a built-in browser class for building query strings; `new` creates one.
      const next = new URLSearchParams(onComparator ? searchParams.toString() : "");
      // `Object.entries(changes)` gives [key, value] pairs; loop over each, destructuring the pair.
      for (const [key, value] of Object.entries(changes)) {
        // Turn the value into text: a list becomes "a,b,c"; undefined becomes ""; numbers via String(...).
        const str = Array.isArray(value) ? value.join(",") : value === undefined ? "" : String(value);
        // Non-empty text → set that parameter; empty → remove it so the URL stays tidy.
        if (str) next.set(key, str);
        else next.delete(key);
      }
      // Build the final URL: "/compare?q=…" or just "/compare" when no filters remain.
      const qs = next.toString();
      const href = qs ? `${COMPARATOR_PATH}?${qs}` : COMPARATOR_PATH;
      startTransition(() => {
        // Filters only apply on the comparator, so navigate there from other pages.
        // `replace` swaps the current history entry (so Back does not step through every keystroke) and
        // `{ scroll: false }` keeps the scroll position; `push` adds a new history entry (a normal page move).
        if (onComparator) router.replace(href, { scroll: false });
        else router.push(href);
      });
    },
    [pathname, router, searchParams],
  );

  // Kind: function. Adds `value` to the list filter `key`, or removes it if it is already there
  // (used by checkboxes). `list.includes(value)` checks membership; `.filter(v => v !== value)` returns a
  // new list without it; `[...list, value]` returns a new list with it added at the end (spread syntax).
  // `{ [key]: … }` uses the variable's content as the property name.
  const toggleInList = useCallback(
    (key: string, value: string) => {
      const list = getList(key);
      update({ [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] });
    },
    [getList, update],
  );

  // Kind: function. Clears every filter by going to the bare comparator URL.
  const reset = useCallback(() => {
    startTransition(() => router.replace(COMPARATOR_PATH, { scroll: false }));
  }, [router]);

  // Hand everything back to the component. `{ get, getList, … }` is shorthand for `{ get: get, … }`.
  return { get, getList, update, toggleInList, reset, isPending, pathname };
}
