/**
 * FILE: packages/core/src/format.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Small helpers that turn raw values into text for display: euro amounts ("€1,500"), numbers
 *   with thousands separators, price ranges, signed percentages ("+12%"), URL slugs
 *   ("Société Générale" → "societe-generale") and name initials ("Vianden Corporate" → "VC").
 *   Keeping them in one place makes every page format numbers the same way.
 * WHERE IT RUNS: both (server and browser); it only uses features built into JavaScript.
 * FRAMEWORK NOTES: `Intl.NumberFormat` is JavaScript's built-in number formatter. It knows the conventions
 *   of each language/region ("locale"), such as currency symbols and separators.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `new X(...)` = create an object from a class (here the built-in formatter class).
 *   - arrow functions `(n: number) => …` and normal `function name(p: type) { … }` declarations.
 *   - parameter type annotations `n: number`, `s: string`.
 *   - template strings `` `${a} – ${b}` ``: text with values inserted where `${…}` appears.
 *   - ternary `cond ? x : y`; method chaining `a.b().c()`; regular expressions `/…/g`.
 *   - non-null assertion `x!`: "trust me, this is not undefined".
 */

// Created once when the file loads and reused for every call (creating a formatter is relatively slow).
// "en-LU" = English as used in Luxembourg; `style: "currency"` with `currency: "EUR"` adds the € sign;
// `maximumFractionDigits: 0` drops cents, so 1500.4 shows as "€1,500".
const eur = new Intl.NumberFormat("en-LU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
// Plain number formatter with US conventions: 12345 → "12,345".
const num = new Intl.NumberFormat("en-US");

/**
 * Kind: function (arrow function). Formats a euro amount, e.g. 2500 → "€2,500".
 * @param n  type `number` — the amount in euros. @returns `string`.
 */
export const formatEur = (n: number) => eur.format(n);
/**
 * Kind: function. Formats a plain number with thousands separators, e.g. 1250 → "1,250".
 * @param n  type `number`. @returns `string`.
 */
export const formatNumber = (n: number) => num.format(n);
/**
 * Kind: function. Formats a fee range, e.g. (1000, 3000) → "€1,000 – €3,000".
 * @param min  type `number` — lower bound in euros.
 * @param max  type `number` — upper bound in euros.
 * @returns `string`, built with a template string: each `${…}` is replaced by the value inside it.
 */
export const formatPriceRange = (min: number, max: number) => `${formatEur(min)} – ${formatEur(max)}`;

/**
 * Kind: function. Formats a change as a whole-number percentage with a sign, e.g. 12.4 → "+12%", -3 → "-3%".
 * @param n  type `number` — the percentage (already multiplied by 100).
 * @returns `string`. TypeScript infers the return type from the `return` line, so it is not written out.
 */
export function formatPercent(n: number) {
  // `Math.round` rounds to the nearest whole number (12.4 → 12, 12.5 → 13).
  const rounded = Math.round(n);
  // Ternary: if rounded > 0, put "+" in front; otherwise nothing ("" = empty text). Negative numbers already
  // carry their own "-" sign, and zero gets no sign.
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/**
 * Kind: function. Turns any name or title into a "slug": lowercase letters, digits and dashes only, safe to put
 * in a URL. Example: "Ernst & Young Société" → "ernst-and-young-societe".
 * @param s  type `string` — the original text.
 * @returns  `string` — the slug (may be empty if the text had no letters or digits at all).
 * Each line below is a method call on the result of the previous one ("method chaining").
 */
export function slugify(s: string) {
  return s
    // Unicode normalisation "NFKD" splits accented letters into letter + separate accent mark: "é" → "e" + "´".
    .normalize("NFKD")
    // The regular expression below matches the whole Unicode range of those separate accent marks
    // (U+0300 to U+036F), and replaces them with nothing, so only the plain letter remains. `/g` = every match.
    .replace(/[̀-ͯ]/g, "")
    // All letters to lowercase.
    .toLowerCase()
    // Spell out "&" so "Tax & Legal" becomes "tax-and-legal" rather than "tax-legal".
    .replace(/&/g, " and ")
    // `[^a-z0-9]+` = one or more characters that are NOT a letter a–z or digit 0–9 (`^` inside [ ] means "not").
    // Each such run (spaces, dots, apostrophes…) becomes a single dash.
    .replace(/[^a-z0-9]+/g, "-")
    // `^-+` = dashes at the very start, `-+$` = dashes at the very end, `|` = "or". Remove them.
    .replace(/^-+|-+$/g, "");
}

/**
 * Kind: function. Up to two capital initials from a name, used as a stand-in logo, e.g. "Alter Domus" → "AD".
 * @param name  type `string` — the company or person name.
 * @returns     `string` — 0 to 2 capital letters.
 */
export function initials(name: string) {
  return name
    // Split into words on any run of white space (`\s+`): "Alter  Domus" → ["Alter", "Domus"].
    .split(/\s+/)
    // Keep only words starting with a Latin letter (`.test(w)` returns true when the pattern matches), so
    // words like "&" or "(Lux)" are skipped.
    .filter((w) => /^[A-Za-z]/.test(w))
    // `.slice(0, 2)` returns a new array with only the first two items.
    .slice(0, 2)
    // `w[0]` is the first character of the word. Its type includes `undefined` (an index may be empty), so `!`
    // tells TypeScript "it is definitely there"; that is safe because `.filter` kept only words with a letter.
    .map((w) => w[0]!.toUpperCase())
    // Glue the letters together with nothing between them: ["A", "D"] → "AD".
    .join("");
}
