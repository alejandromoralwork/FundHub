/**
 * FILE: apps/admin/src/components/wordmark.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Draws the "FundHub" text logo (with "Hub" in emerald green) plus a small label such as
 *   "ADMIN" after it. It is used in the Console sidebar and on the login page.
 * WHERE IT RUNS: both. It has no "use client" line and no browser-only code, so it can be rendered on the
 *   server and also inside browser (client) components that import it.
 * FRAMEWORK NOTES: A React component is a function that returns JSX (HTML-like markup). Its inputs are
 *   called "props" and arrive as one object. `style={{ … }}` sets inline CSS: the outer braces mean "a
 *   JavaScript value goes here", the inner braces are the object of CSS properties (written in camelCase).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - an inline object type for the props `{ light?: boolean; suffix?: string }` (`?` = optional).
 *   - destructuring with default values `{ light = false, suffix = "Admin" }`.
 *   - ternary `c ? x : y` and logical `&&` ("show this only if the left side is truthy").
 */

/**
 * Kind: React component.
 * @param light   type `boolean`, optional, default `false` — `true` draws white text for dark backgrounds.
 * @param suffix  type `string`, optional, default "Admin" — small label after the name; an empty string hides it.
 * @returns JSX: a <span> containing "Fund", a green "Hub" and the optional label.
 */
export function Wordmark({ light = false, suffix = "Admin" }: { light?: boolean; suffix?: string }) {
  // The text colour is white on dark backgrounds (`light` true) or the brand "ink" colour otherwise.
  return (
    <span style={{ fontWeight: 700, letterSpacing: -0.5, fontSize: 20, color: light ? "#fff" : "#1e2632", whiteSpace: "nowrap" }}>
      {/* "Fund" in the base colour, then "Hub" wrapped in its own span coloured emerald. */}
      Fund<span style={{ color: "#0f9d78" }}>Hub</span>
      {/* `suffix && <span>…` renders the label only when suffix is a non-empty string. */}
      {suffix && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 }}>{suffix}</span>}
    </span>
  );
}
