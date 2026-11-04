"use client";
/**
 * FILE: apps/web/src/components/sort-select.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "Sort: FundHub Score / Quality Score / …" dropdown above the provider list. Choosing an
 *   option changes the `?sort=` part of the page URL, which makes the page reload its list in the new order.
 * WHERE IT RUNS: in the browser. The `"use client"` line at the very top tells Next.js this is a "client
 *   component": its JavaScript is shipped to the browser so it can react to clicks and read/change the URL.
 *   (That directive must be the first statement in the file, which is why this comment comes after it.)
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). Functions whose names
 *   start with `use` are "hooks": special React functions that may only be called at the top of a component.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - object destructuring `const { get, update } = …` = pull two named fields out of an object.
 *   - arrow functions `(sort) => …` = a short way to write a function.
 *   - array destructuring in parameters `([value, label]) => …`.
 *   - template strings `` `Sort: ${label}` `` = text with a value inserted at `${…}`.
 */

// `import { a } from "b"` brings named things from another file or library into this one.
// `@fundhub/core/filters` = our own shared package in packages/core. SORTS is a fixed object mapping each
// sort key to its human label, e.g. { score: "FundHub Score", fee: "Lowest Fee", … }.
import { SORTS } from "@fundhub/core/filters";
// `./filter-bar` = the file filter-bar.tsx in this same folder; `Select` is our styled dropdown component.
import { Select } from "./filter-bar";
// Our own hook (use-filter-params.ts in this folder) to read and change filter values in the URL.
import { useFilterParams } from "./use-filter-params";

/**
 * Kind: React component (client component). Takes no props.
 * Returns: JSX — a <Select> dropdown wired to the `sort` value in the URL.
 * Why: keeping the sort order in the URL means a sorted list can be bookmarked or shared as a link.
 */
export function SortSelect() {
  // Call our hook. It returns an object; we keep `get` (read a URL value) and `update` (change URL values).
  const { get, update } = useFilterParams();
  return (
    <Select
      // `label` is read out by screen readers to describe the dropdown.
      label="Sort providers"
      // The current choice: the `sort` value from the URL, or "score" if there is none.
      // `a || b` = use `a` unless it is empty/missing, in which case use `b`.
      value={get("sort") || "score"}
      // `onChange` is an event handler: a function React calls when the user picks a new option.
      // "score" is the default order, so we remove `sort` from the URL (`undefined`) instead of writing
      // `?sort=score` — this keeps the default URL clean. Any other choice is written into the URL.
      onChange={(sort) => update({ sort: sort === "score" ? undefined : sort })}
      // `Object.entries(SORTS)` turns the object into a list of [key, label] pairs.
      // `.map(…)` builds a new list by transforming each pair into the { value, label } shape <Select> expects,
      // adding "Sort: " in front of the label shown to the user.
      options={Object.entries(SORTS).map(([value, label]) => ({ value, label: `Sort: ${label}` }))}
    />
  );
}
