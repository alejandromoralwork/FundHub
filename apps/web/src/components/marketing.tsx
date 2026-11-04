/**
 * FILE: apps/web/src/components/marketing.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: A small kit of reusable layout pieces for the editorial pages (landing, advisory,
 *   independence…): SectionTitle (eyebrow + heading + intro), Panel (white bordered box), ButtonLink (a link
 *   styled as a button in four looks), CtaBand (dark "call to action" banner with buttons) and CheckList
 *   (bullet list with green or red dots). Using them keeps all these pages visually consistent.
 * WHERE IT RUNS: on the server (no "use client" line, so these are Next.js server components outputting HTML).
 * FRAMEWORK NOTES:
 *   - A React component is a function returning JSX (HTML-like markup); other files use it like a tag.
 *   - `children` is a special prop: whatever is written between a component's opening and closing tags,
 *     e.g. in <Panel>Hello</Panel> the children are "Hello". Its type is `React.ReactNode` (anything React
 *     can display: text, elements, lists, nothing).
 *   - Tailwind classes in `className` are small styles; `sm:`/`md:` apply from small/medium screens upward.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - prop types written inline after the destructured props; `?` = optional; defaults like `variant = "primary"`.
 *   - union of string literals `"primary" | "dark" | …` = only these exact values are accepted.
 *   - destructuring with renaming and a default: `as: Heading = "h2"`.
 *   - `readonly string[]` = a list of strings that this code promises not to modify.
 *   - nested object types `{ href: string; label: string }`.
 */

// `import X from "b"` imports a default export; `{ a }` picks named exports.
// Next.js's link component (page change without a full reload).
import Link from "next/link";
// An arrow icon from the `lucide-react` icon library (npm).
import { ArrowRight } from "lucide-react";
// `cn` (this app's src/lib/cn.ts) joins class names and skips false/undefined ones — handy for conditional styles.
import { cn } from "@/lib/cn";

/** Building blocks for the editorial pages (landing, advisory, independence…). */

/**
 * Kind: React component (server component).
 * Props:
 *   - eyebrow    `string`, optional — small green upper-case text above the heading.
 *   - title      `string` — the heading text.
 *   - lead       `string`, optional — an introductory paragraph under the heading.
 *   - className  `string`, optional — extra classes from the caller.
 *   - as         `"h1" | "h2"`, optional, default "h2" — which HTML heading level to use. It is renamed to
 *                `Heading` (capitalised) so JSX treats it as a tag to render: <Heading> becomes <h1> or <h2>.
 *                Each page should have exactly one h1, so the page's top section passes as="h1".
 * Returns: JSX — a block up to "3xl" wide with the eyebrow, heading and lead.
 */
export function SectionTitle({
  eyebrow,
  title,
  lead,
  className,
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {/* Only drawn if an eyebrow was given (`a && b` renders b only when a has a value). */}
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">{eyebrow}</p>}
      {/* An h1 gets a bigger font (larger again from `sm:` screens); an h2 gets `text-xl`. */}
      <Heading className={cn("mt-1 font-semibold text-ink", Heading === "h1" ? "text-2xl sm:text-3xl" : "text-xl")}>
        {title}
      </Heading>
      {lead && <p className="mt-2 text-sm leading-relaxed text-ink-600">{lead}</p>}
    </div>
  );
}

/**
 * Kind: React component (server component).
 * Props: children (`React.ReactNode`, the content), className (`string`, optional extra classes).
 * Returns: JSX — the content inside a white, rounded, bordered box with padding.
 */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-slate-200 bg-white p-5", className)}>{children}</div>;
}

/**
 * Kind: React component (server component).
 * Props:
 *   - href       `string` — where the link goes.
 *   - children   `React.ReactNode` — the button's content (text, maybe an icon).
 *   - variant    `"primary" | "dark" | "outline" | "ghost"`, optional, default "primary" — the look:
 *                primary = green, dark = near-black, outline = white with a border,
 *                ghost = transparent with white text (for use on dark backgrounds).
 *   - className  `string`, optional.
 * Returns: JSX — a Next.js <Link> styled as a button.
 * Why a link and not a <button>: these take you to another page, and links are the correct HTML for that.
 */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "dark" | "outline" | "ghost";
  className?: string;
}) {
  return (
    <Link
      href={href}
      // Base button styles first, then exactly one of the four variant lines applies:
      // `variant === "primary" && "…"` gives the classes when true, or `false` (which cn ignores) otherwise.
      // `transition-colors` animates the colour change on hover; `white/20` = white at 20% opacity.
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors",
        variant === "primary" && "bg-emerald text-white hover:bg-emerald-700",
        variant === "dark" && "bg-ink-900 text-white hover:bg-ink-800",
        variant === "outline" && "border border-slate-300 bg-white text-ink hover:bg-slate-50",
        variant === "ghost" && "border border-white/20 text-white hover:bg-white/10",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Kind: React component (server component).
 * Props:
 *   - title      `string` — banner heading.
 *   - body       `string` — banner text.
 *   - primary    `{ href: string; label: string }` — the main (green) button: where it goes and its text.
 *   - secondary  same shape, optional — a second, "ghost" style button.
 * Returns: JSX — a dark rounded banner: text on the left, buttons on the right (stacked on phones).
 */
export function CtaBand({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="rounded-xl bg-ink-900 px-6 py-8 text-white sm:px-10">
      {/* Stacked vertically on phones (`flex-col`); side by side from medium screens (`md:flex-row`). */}
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{body}</p>
        </div>
        {/* `shrink-0` stops the buttons being squeezed when the text is long. */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* Primary button with an arrow icon after the label (default "primary" variant). */}
          <ButtonLink href={primary.href}>
            {primary.label} <ArrowRight className="h-4 w-4" />
          </ButtonLink>
          {/* Second button only if one was passed. */}
          {secondary && (
            <ButtonLink href={secondary.href} variant="ghost">
              {secondary.label}
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Kind: React component (server component).
 * Props:
 *   - items  `readonly string[]` — the bullet texts.
 *   - tone   `"positive" | "negative"`, optional, default "positive" — green dots for "what we do",
 *            red dots for "what we never do" style lists.
 * Returns: JSX — an unordered list (<ul>) with one <li> per item.
 */
export function CheckList({ items, tone = "positive" }: { items: readonly string[]; tone?: "positive" | "negative" }) {
  return (
    <ul className="space-y-2">
      {/* One list item per text. The text itself is used as the `key`, so items should be unique. */}
      {items.map((i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
          {/* The coloured dot: a tiny (1.5 = 6px) circle (`rounded-full`) that will not shrink (`shrink-0`). */}
          <span
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              tone === "positive" ? "bg-emerald" : "bg-red-400",
            )}
          />
          {i}
        </li>
      ))}
    </ul>
  );
}
