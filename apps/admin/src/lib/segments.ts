/**
 * FILE: apps/admin/src/lib/segments.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Names the groups of people ("segments") a bulk email can be sent to from the Console, with
 *   the label shown in the UI for each.
 * WHERE IT RUNS: both. It has no secrets or database access, so the browser (the segment picker) and the
 *   server (the code that actually works out who is in each segment) can both import it.
 * FRAMEWORK NOTES: none specific; this is a plain shared constant.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `as const`: freezes the object so TypeScript knows its exact keys and texts, not just "some strings".
 *   - `keyof typeof X`: `typeof X` is the type of the constant; `keyof` gives the union of its key names.
 */

/**
 * Kind: constant (exported).
 * Email recipient segments. Marketing goes only to people who opted in; account segments
 * are for service messages (product changes, terms), as GDPR requires.
 * Each key is the internal segment name; each value is its human-readable label.
 */
export const SEGMENTS = {
  newsletter: "Newsletter subscribers (opted in)",
  providers: "All provider accounts (service message)",
  approved_providers: "Provider accounts with an approved company (service message)",
  visitors_service: "All visitor accounts (service message)",
} as const;
/**
 * Kind: type alias (exported).
 * Any valid segment name: "newsletter" | "providers" | "approved_providers" | "visitors_service".
 * Using this type means a misspelt segment name is caught by TypeScript before the code runs.
 */
export type Segment = keyof typeof SEGMENTS;
