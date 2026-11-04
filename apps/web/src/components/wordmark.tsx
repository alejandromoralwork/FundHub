/**
 * FILE: apps/web/src/components/wordmark.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Draws the FundHub logo as styled text: "Fund" in the main colour and "Hub" in the emerald
 *   accent colour. It is used in the header and footer.
 * WHERE IT RUNS: on the server by default. There is no "use client" line at the top, so in Next.js this is a
 *   "server component": its HTML is produced on the server and sent to the browser ready-made, with no
 *   JavaScript needed in the browser.
 * FRAMEWORK NOTES: A React "component" is a function whose name starts with a capital letter and which returns
 *   JSX (HTML-like markup inside JavaScript). Other files use it like an HTML tag: <Wordmark tone="light" />.
 *   The attributes passed to it are called "props". `className` holds Tailwind CSS utility classes: each class
 *   is one small style, e.g. `font-bold` = bold text, `tracking-tight` = letters slightly closer together.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - inline object types `{ className?: string }` describing the props; `?` = optional.
 *   - union of string literals `"dark" | "light"` = only these two exact words are allowed.
 *   - default values in destructuring `tone = "dark"` = used when the prop is not passed.
 *   - ternary `condition ? a : b` = "if condition then a else b".
 */

// `import { a } from "b"` brings a named thing `a` from another file or library into this file.
// `@/lib/cn` = the file src/lib/cn.ts in this app (`@/` is a shortcut for this app's src folder).
// `cn` joins several CSS class names into one string, skipping any that are empty/false/undefined.
import { cn } from "@/lib/cn";

/**
 * The FundHub logo is the name itself: no symbol. "Hub" carries the accent.
 *
 * Kind: React component (server component).
 * Props (the `{ … }: { … }` part destructures the props object straight into variables):
 *   - className  type `string`, optional — extra Tailwind classes from the caller (e.g. a text size).
 *   - tone       type `"dark" | "light"`, optional, default "dark" — "light" gives white text for dark
 *                backgrounds (like the footer); "dark" uses the brand ink colour for light backgrounds.
 * Returns: JSX — a <span> containing the word "FundHub".
 * `export` makes the function usable from other files.
 */
export function Wordmark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  // `return ( … )` hands back the markup. The brackets just let the JSX span several lines.
  // In JSX, `{ … }` inside an attribute means "evaluate this JavaScript". Here `cn(…)` builds the class list:
  // always bold + tight, then white or ink depending on `tone`, then whatever the caller added last
  // (later classes can override earlier ones).
  return (
    <span className={cn("font-bold tracking-tight", tone === "light" ? "text-white" : "text-ink", className)}>
      {/* Plain text "Fund", then a nested <span> that colours "Hub" with the brand's emerald green. */}
      Fund<span className="text-emerald">Hub</span>
    </span>
  );
}
