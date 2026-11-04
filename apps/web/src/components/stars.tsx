/**
 * FILE: apps/web/src/components/stars.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shows a rating as five stars, filling each star in amber up to the score. Fractions are drawn
 *   as partly-filled stars, so 4.3 shows four full stars and a fifth one 30% filled.
 * WHERE IT RUNS: on the server (no "use client" line, so Next.js treats it as a server component and sends
 *   ready-made HTML). It has no interactivity, so it needs no browser JavaScript.
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). When JSX shows a list of
 *   elements, each needs a unique `key` prop so React can tell them apart when the list changes.
 *   `className` holds Tailwind utility classes (one small style each); `style={{ … }}` sets inline CSS values
 *   that are computed in code (here, sizes and fill widths).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - prop types `{ score: number; size?: number }` (`?` = optional) and a default value `size = 14`.
 *   - arrow functions `(_, i) => …`; `_` is a conventional name for a parameter we do not use.
 *   - template strings `` `${…}` ``; logical AND `a && b` used to show something only when a condition holds.
 */

// `import { a } from "b"` brings a named thing from a library. `lucide-react` (from npm) is an icon library;
// each icon is a React component that draws an SVG picture. `Star` is the star outline icon.
import { Star } from "lucide-react";

/**
 * Five-star rating with partial fill, e.g. 4.3 fills 30% of the fifth star.
 *
 * Kind: React component (server component).
 * Props:
 *   - score  type `number` — the rating from 0 to 5 (may have decimals).
 *   - size   type `number`, optional, default 14 — width and height of each star in pixels.
 * Returns: JSX — a row of five stars, labelled for screen readers as e.g. "4.3 out of 5".
 */
export function Stars({ score, size = 14 }: { score: number; size?: number }) {
  return (
    // Outer wrapper: `inline-flex items-center gap-0.5` = sit in a line, centred vertically, small gap.
    // `role="img"` + `aria-label` tell screen readers to treat the five stars as one picture with this text.
    // `score.toFixed(1)` turns the number into text with one decimal place, e.g. 4.25 -> "4.3".
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${score.toFixed(1)} out of 5`}>
      {/* `Array.from({ length: 5 }, fn)` makes a list of 5 items by calling fn with each index i = 0..4.
          Each call returns the JSX for one star, so React renders the resulting list of five stars. */}
      {Array.from({ length: 5 }, (_, i) => {
        // How much of star number i to fill, between 0 and 1. With score 4.3: star 0..3 get 1 (full),
        // star 4 gets 0.3. `Math.min(1, …)` caps at 1, `Math.max(0, …)` stops negatives for empty stars.
        // `const` declares a value that will not be reassigned.
        const fill = Math.max(0, Math.min(1, score - i));
        return (
          // `key={i}` gives each star a unique identity in the list (required by React for lists).
          // `relative` lets the two stacked stars inside be positioned on top of each other.
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            {/* Bottom layer: a grey (slate-300) star outline, always shown. `absolute inset-0` = cover the box. */}
            <Star className="absolute inset-0 text-slate-300" style={{ width: size, height: size }} />
            {/* Top layer, only when there is something to fill (`fill > 0 && …` renders nothing otherwise).
                The wrapper's width is cut to fill×100% and `overflow-hidden` hides the rest, so only the left
                part of the amber star shows — that is how a "30% star" is drawn. */}
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                {/* A solid amber star (`fill-amber-400` fills the shape, `text-amber-400` colours its outline). */}
                <Star className="fill-amber-400 text-amber-400" style={{ width: size, height: size }} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
