"use client";

/**
 * FILE: apps/web/src/components/filter-bar.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The row of quick filters above the provider comparator: a "service category" dropdown, a
 *   "scale / headcount" dropdown and clickable "chips" (pill buttons). With no category chosen, the chips
 *   are the five most common tech stacks; once a category is chosen, a second row shows chips for that
 *   category's sub-services. All filters live in the page URL (e.g. /compare?category=depositary&stack=eFront),
 *   so a filtered view can be bookmarked or shared.
 * WHERE IT RUNS: in the browser (`"use client"`), because it reacts to clicks and changes the URL.
 * FRAMEWORK NOTES: The URL handling lives in our own hook `useFilterParams` (a "custom hook": a function
 *   starting with `use` that uses other React hooks). It reads the query string (`?a=1&b=2`) and, on change,
 *   tells the Next.js router to go to the new URL; the server then re-renders the results for it.
 *   Tailwind: `flex flex-wrap gap-2` = a row of items that wraps onto new lines with small gaps.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - multi-line inline prop types; function types (`(v: string) => void` = takes a string, returns nothing).
 *   - optional chaining `a?.b`, nullish coalescing `a ?? b`, spread inside arrays `[x, ...list]`.
 *   - `Object.entries(obj)` (list of [key, value] pairs) with array destructuring `([value, b]) => ...`.
 *   - fragments `<>...</>`, `.map`, `.slice`, `.includes`.
 */

// `import { a } from "b"` pulls named things from a module. Plain names = npm libraries,
// `@fundhub/...` = our shared packages, `@/...` = this app's src folder, `./...` = same folder.

// A small down-arrow icon for the dropdowns.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
// The list of known tech stacks (fund software such as eFront), defined with the database schema.
import { TECH_STACKS } from "@fundhub/db/schema";
// The client-portfolio size bands for the "scale" filter (e.g. "1-50" → label "1–50").
import { SCALE_BANDS } from "@fundhub/core/filters";
// The service categories (`TAXONOMY`) and a lookup by slug (`getCategory`).
import { getCategory, TAXONOMY } from "@fundhub/core/taxonomy";
// Joins class names, skipping false/undefined ones.
import { cn } from "@/lib/cn";
// Our custom hook for reading and changing the filter values in the URL.
import { useFilterParams } from "./use-filter-params";

/**
 * Kind: React component (exported; also reused elsewhere). A styled dropdown with a custom arrow.
 * Props:
 *   label: string, read out by screen readers (`aria-label`), since there is no visible label.
 *   value: string, the currently selected option's value.
 *   onChange: `(v: string) => void`, a function called with the newly chosen value.
 *   options: array of `{ value, label }` to choose from.
 *   className?: string, optional extra classes for the wrapper.
 * Returns: JSX. This is a "controlled" select: it always shows `value` from its parent, and reports changes.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    // `relative` lets the arrow icon below be positioned on top of the select.
    <div className={cn("relative", className)}>
      {/* `appearance-none` hides the browser's own arrow; `pr-8` leaves room on the right for ours.
          `onChange={(e) => onChange(e.target.value)}` passes the chosen value up to the parent. */}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-ink-600 focus:border-emerald focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {/* Our arrow, placed at the right and vertically centred (`top-1/2 -translate-y-1/2`).
          `pointer-events-none` lets clicks pass through it to the select underneath. */}
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

/**
 * Kind: React component. A pill-shaped on/off filter button.
 * Props: active: boolean (is this filter on?), onClick: `() => void` (what to do when clicked),
 *   children: React.ReactNode (the chip's text).
 * Returns: JSX. Green when active, white when not; `aria-pressed` tells screen readers its on/off state.
 */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-emerald bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-white text-ink-600 hover:border-slate-300",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Kind: React component (exported; shown above the comparator results). Props: none (it reads the URL).
 * Returns: JSX for the filter rows.
 */
export function FilterBar() {
  // The hook returns an object; `{ get, getList, update, toggleInList }` destructures the helpers we need:
  //   get(key)              → one URL value as a string ("" when missing),
  //   getList(key)          → a comma-separated URL value as an array of strings,
  //   update({ key: v })    → change URL values (undefined or "" removes the key),
  //   toggleInList(key, v)  → add v to that list, or remove it if already there.
  const { get, getList, update, toggleInList } = useFilterParams();
  // The chosen category object (or undefined if none / unknown slug).
  const category = getCategory(get("category"));
  // Currently selected sub-services and tech stacks.
  const services = getList("service");
  const stacks = getList("stack");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [activeCategorySlug, setActiveCategorySlug] = useState(category?.slug ?? TAXONOMY[0].slug);
  const activeCategory = TAXONOMY.find((item) => item.slug === activeCategorySlug) ?? TAXONOMY[0];

  function selectCategory(slug: string, service?: string) {
    update({ category: slug, service });
    setCategoryMenuOpen(false);
  }

  return (
    // `space-y-2.5` = gap between the two rows; `sm:px-6` = more side padding from small-tablet width.
    <div className="space-y-2.5 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* Main-category selection also exposes each category's taxonomy services on hover or focus. */}
        <div
          className="relative z-20"
          onKeyDown={(event) => {
            if (event.key === "Escape") setCategoryMenuOpen(false);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCategoryMenuOpen(false);
          }}
        >
          <button
            type="button"
            aria-label="Service category"
            aria-haspopup="true"
            aria-expanded={categoryMenuOpen}
            onClick={() => {
              if (!categoryMenuOpen) setActiveCategorySlug(category?.slug ?? TAXONOMY[0].slug);
              setCategoryMenuOpen((open) => !open);
            }}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-white py-1.5 pl-3 pr-2 text-xs font-medium text-ink-600 hover:bg-slate-50 focus:border-emerald focus:outline-none"
          >
            {category?.label ?? "All service categories"}
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          {categoryMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 flex w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              <div className="max-h-[70vh] w-1/2 overflow-y-auto border-r border-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => selectCategory("")}
                  className={`w-full rounded px-2 py-2 text-left text-xs hover:bg-slate-50 ${
                    !category ? "font-semibold text-emerald-700" : "text-ink-600"
                  }`}
                >
                  All service categories
                </button>
                {TAXONOMY.map((item) => (
                  <div
                    key={item.slug}
                    className={`flex items-center rounded ${
                      activeCategorySlug === item.slug ? "bg-slate-50" : ""
                    }`}
                    onMouseEnter={() => setActiveCategorySlug(item.slug)}
                  >
                    <button
                      type="button"
                      onFocus={() => setActiveCategorySlug(item.slug)}
                      onClick={() => selectCategory(item.slug)}
                      className={`min-w-0 flex-1 px-2 py-2 text-left text-xs hover:text-emerald-700 ${
                        category?.slug === item.slug ? "font-semibold text-emerald-700" : "text-ink-600"
                      }`}
                    >
                      {item.label}
                    </button>
                    <button
                      type="button"
                      aria-label={`Show ${item.label} subcategories`}
                      aria-expanded={activeCategorySlug === item.slug}
                      onFocus={() => setActiveCategorySlug(item.slug)}
                      onClick={() => setActiveCategorySlug(item.slug)}
                      className="px-2 py-2 text-slate-400 hover:text-emerald-700"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="max-h-[70vh] w-1/2 overflow-y-auto p-1">
                <p className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {activeCategory.label}
                </p>
                {activeCategory.services.map((service) => (
                  <button
                    key={service}
                    type="button"
                    onClick={() => selectCategory(activeCategory.slug, service)}
                    className={`w-full rounded px-2 py-2 text-left text-xs hover:bg-emerald-50 hover:text-emerald-700 ${
                      category?.slug === activeCategory.slug && services.includes(service)
                        ? "font-semibold text-emerald-700"
                        : "text-ink-600"
                    }`}
                  >
                    {service}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Scale dropdown. `update({ scale })` is shorthand for `update({ scale: scale })`.
            `Object.entries(SCALE_BANDS)` gives pairs like ["1-50", { label: "1–50", ... }], destructured
            into `value` (the key) and `b` (the band). */}
        <Select
          label="Scale / headcount"
          value={get("scale")}
          onChange={(scale) => update({ scale })}
          options={[
            { value: "", label: "Scale / Headcount: Any" },
            ...Object.entries(SCALE_BANDS).map(([value, b]) => ({ value, label: `${b.label} staff` })),
          ]}
        />

        {/* No category chosen: show a thin divider (`w-px` = 1 pixel wide), a "Tech stack" caption (both
            only from `sm:` width up) and chips for the first five tech stacks (`.slice(0, 5)`).
            `<>...</>` is a fragment: it groups several elements without adding an HTML tag. */}
        {!category && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
            <span className="hidden text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:inline">
              Tech stack
            </span>
            {TECH_STACKS.slice(0, 5).map((s) => (
              <Chip key={s} active={stacks.includes(s)} onClick={() => toggleInList("stack", s)}>
                {s}
              </Chip>
            ))}
          </>
        )}
      </div>

      {/* Category chosen: a second row with a chip for each of its sub-services. */}
      {category && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Services</span>
          {category.services.map((s) => (
            <Chip key={s} active={services.includes(s)} onClick={() => toggleInList("service", s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
