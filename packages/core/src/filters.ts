/**
 * FILE: packages/core/src/filters.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Defines the search filters of the provider comparator (text search, category, services,
 *   asset classes, price range, sort order…) and turns the raw text from the page address (the "query
 *   string", e.g. `?category=tax&asset=Real%20Estate,Private%20Equity&sort=price`) into a clean,
 *   type-checked object. Anything invalid or unknown is quietly dropped, so a mistyped or tampered URL can
 *   never break the page.
 * WHERE IT RUNS: mainly on the server, when the website builds the comparator page from the URL; it also
 *   works in the browser because it is plain code.
 * FRAMEWORK NOTES: Zod is a library for "schemas": a schema describes what valid data looks like, and
 *   `schema.parse(data)` checks the data and returns a cleaned copy (or throws an error if it cannot).
 *   Next.js hands a page its URL parameters as an object called `searchParams`; `parseFilters` accepts that shape.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import { a, b } from "x"` = take the named things a and b from module x.
 *   - `as const`, `keyof typeof X` (the union of X's key names), `type` aliases.
 *   - generics `<T extends string>`: a function that works for any type T, as long as T is a kind of string.
 *   - `readonly T[]`: an array that may not be modified.
 *   - type predicates `(s): s is T`: a check function that also tells TypeScript the item's type.
 *   - `??` (nullish coalescing): `a ?? b` = a, unless a is null/undefined, then b.
 *   - `||`: `a || b` = a, unless a is "falsy" (empty text, 0, null, undefined, false), then b.
 *   - ternary `cond ? x : y`, arrow functions, array destructuring `([k, v]) => …`.
 *   - tuple types `[A, ...A[]]`: "an array with at least one A".
 *   - `z.infer<typeof schema>`: ask Zod for the TypeScript type of the data a schema produces.
 */

// `import { z } from "zod"`: `z` is the Zod library's main object; all schema builders hang off it
// (z.string(), z.object(), …). "zod" is a plain name, so it is a library installed from npm.
import { z } from "zod";
// The allowed values for several filters, from our own enums file. `./` = "a file in this same folder";
// the `.ts` ending is left out by convention.
import { ASSET_CLASSES, LICENCES, PROVIDER_TYPES, REGULATORY_SCOPES, TECH_STACKS } from "./enums";
// The full list of service names and the list of category slugs, from our taxonomy file.
import { ALL_SERVICES, CATEGORY_SLUGS } from "./taxonomy";

/**
 * Kind: constants (numbers, in euros). Bounds of the price-range slider on the comparator.
 * PRICE_FLOOR is the lowest value the slider shows; PRICE_CEILING is the highest value a price filter may take.
 */
export const PRICE_FLOOR = 500;
export const PRICE_CEILING = 6000;
/** Kind: constant. Highest allowed value for the "density" filter (minimum number of active client mandates). */
export const DENSITY_CEILING = 150;

/**
 * Kind: constant (read-only object). Client-portfolio size bands for the "scale" filter.
 * The key on the left (e.g. "51-250") is what goes in the URL; each value holds the text shown on screen
 * (`label`, with a proper dash and thousands separator) and the numeric range `min`..`max` it covers.
 * Keys with a dash or plus must be written in quotes because they are not plain identifiers.
 * `Number.MAX_SAFE_INTEGER` is JavaScript's largest exact whole number, used here as "no upper limit".
 */
export const SCALE_BANDS = {
  "1-50": { label: "1–50", min: 1, max: 50 },
  "51-250": { label: "51–250", min: 51, max: 250 },
  "251-1000": { label: "251–1,000", min: 251, max: 1000 },
  "1000+": { label: "1,000+", min: 1001, max: Number.MAX_SAFE_INTEGER },
} as const;
/**
 * Kind: type alias. One of the band keys: "1-50" | "51-250" | "251-1000" | "1000+".
 * `typeof SCALE_BANDS` = the type of the object above; `keyof` that type = the union of its key names.
 */
export type ScaleBand = keyof typeof SCALE_BANDS;

/**
 * Kind: constant (read-only object). The sort orders offered on the comparator:
 * URL value (key) → label shown in the sort menu (value).
 */
export const SORTS = {
  score: "FundHub Score",
  quality: "Quality Score",
  price: "Price Score",
  fee: "Lowest Fee",
  headcount: "Headcount",
} as const;
/** Kind: type alias. "score" | "quality" | "price" | "fee" | "headcount" (the keys of SORTS, as above). */
export type Sort = keyof typeof SORTS;

/**
 * Comma-separated list, keeping only allowed values.
 *
 * Kind: function (generic, not exported: a helper for this file only).
 * Builds a Zod schema for a multi-choice URL filter written as comma-separated text, e.g. "?asset=A,B".
 * @param allowed  type `readonly T[]` — the list of permitted values (e.g. ASSET_CLASSES).
 * `<T extends string>` makes the function generic: T is a placeholder type filled in at each call. When it is
 * called with ASSET_CLASSES, T becomes "Private Equity" | "Real Estate" | …, so the result is precisely typed.
 * @returns a Zod schema that turns `"A,B,bogus"` into the array `["A", "B"]` (unknown values dropped),
 *          and a missing parameter into `[]`.
 */
function csvOf<T extends string>(allowed: readonly T[]) {
  return z
    // Accept text…
    .string()
    // …or nothing at all (`undefined`) when the parameter is not in the URL.
    .optional()
    // `.transform(fn)` converts the validated value into something else; `v` is the text or `undefined`.
    .transform((v) =>
      // `v ?? ""` = use an empty string when v is undefined, so `.split` always has text to work on.
      (v ?? "")
        // Cut the text at every comma: "A, B" → ["A", " B"].
        .split(",")
        // `.map` returns a new array; `.trim()` removes spaces at both ends of each piece: ["A", "B"].
        .map((s) => s.trim())
        // `.filter` keeps only the items for which the function returns true (so "" and unknown values go).
        // `(s): s is T` is a "type predicate": besides returning true/false it tells TypeScript that every
        // kept item is of type T, so the result is typed `T[]` and not `string[]`.
        // `allowed as readonly string[]` is a type assertion ("treat it as a list of plain strings") needed
        // because `.includes` on a list of T would otherwise refuse an argument of type `string`.
        .filter((s): s is T => (allowed as readonly string[]).includes(s)),
    );
}

/**
 * Kind: function (arrow function in a constant, file-private).
 * Builds a Zod schema for an optional whole-number URL parameter between `min` and `max`.
 * @param min  type `number` — smallest allowed value.
 * @param max  type `number` — largest allowed value.
 * @returns a schema giving a number, or `undefined` when the value is missing or invalid.
 * `z.coerce.number()` converts the URL text ("1500") into a number (1500) first; `.int()` requires a whole
 * number; `.min/.max` set the range; `.optional()` allows it to be absent; `.catch(undefined)` means
 * "if anything above fails, do not throw an error, just use `undefined`" (i.e. ignore the filter).
 */
const optionalInt = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().catch(undefined);

/**
 * Kind: constant (a Zod object schema, file-private).
 * Describes every comparator filter. `z.object({ … })` = "an object with these properties, each checked by its
 * own schema". The `.catch(…)` on each property supplies a safe fallback, so one bad parameter never makes
 * the whole parse fail; it just falls back to "no filter" (or the default sort).
 */
const filterSchema = z.object({
  // Free-text search: spaces trimmed, max 120 characters (longer input falls back to no search).
  q: z.string().trim().max(120).optional().catch(undefined),
  // One category slug. `z.enum(list)` accepts only values that appear in the list.
  category: z.enum(CATEGORY_SLUGS).optional().catch(undefined),
  // Multi-choice filters, built with the csvOf helper above. `.catch([])` = an empty list if anything goes wrong.
  service: csvOf(ALL_SERVICES).catch([]),
  asset: csvOf(ASSET_CLASSES).catch([]),
  licence: csvOf(LICENCES).catch([]),
  // One scale band. `Object.keys(SCALE_BANDS)` gives the key names as a plain `string[]`. `z.enum` needs a
  // list with at least one item and exact types, so `as [ScaleBand, ...ScaleBand[]]` asserts "this is a
  // non-empty list of ScaleBand values" (a tuple type: a first ScaleBand, then any number more).
  scale: z.enum(Object.keys(SCALE_BANDS) as [ScaleBand, ...ScaleBand[]]).optional().catch(undefined),
  stack: csvOf(TECH_STACKS).catch([]),
  type: csvOf(PROVIDER_TYPES).catch([]),
  reg: csvOf(REGULATORY_SCOPES).catch([]),
  // Price range in euros (lower and upper bound) and density, each an optional whole number in range.
  min: optionalInt(0, PRICE_CEILING),
  max: optionalInt(0, PRICE_CEILING),
  density: optionalInt(0, DENSITY_CEILING),
  // Sort order: one of the SORTS keys (same trick as `scale`), falling back to "score" when missing or unknown.
  sort: z.enum(Object.keys(SORTS) as [Sort, ...Sort[]]).catch("score"),
});

/**
 * Kind: type alias. The cleaned filters object, e.g. `{ q: "lux", category: "tax", asset: ["Real Estate"], … }`.
 * `z.infer<typeof filterSchema>` asks Zod to work out this type from the schema, so the type and the
 * validation rules are written only once and always match.
 */
export type ProviderFilters = z.infer<typeof filterSchema>;

/**
 * Kind: type alias. The raw shape of URL parameters as Next.js provides them: an object whose keys are text
 * and whose values are text, a list of texts (when a parameter is repeated, e.g. `?a=1&a=2`) or `undefined`.
 * `string | string[] | undefined` is a union type: "any one of these three".
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * Kind: function (exported).
 * Turns the page's raw URL parameters into validated comparator filters.
 * @param raw  type `RawSearchParams` — the `searchParams` object from Next.js.
 * @returns    `ProviderFilters` — every filter cleaned, with unknown values removed and safe defaults applied.
 */
export function parseFilters(raw: RawSearchParams): ProviderFilters {
  // `Object.entries(raw)` turns the object into a list of [key, value] pairs.
  // `.map(([k, v]) => …)` handles each pair; `[k, v]` in the parameter is destructuring (naming both halves).
  // For each pair: if the value is a list (`Array.isArray(v)`), join it into one comma-separated text;
  // otherwise keep it, but turn an empty text into `undefined` (`v || undefined`).
  // `Object.fromEntries(...)` turns the list of pairs back into an object. The result `flat` has only plain
  // text values, which is what the schema expects.
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v || undefined]),
  );
  // Validate and clean. Thanks to the `.catch` fallbacks above this does not throw in practice.
  return filterSchema.parse(flat);
}
