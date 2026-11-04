/**
 * FILE: apps/web/src/components/badges.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Small "pill" labels used all over the website: the "FundHub Verified" / "Pending review"
 *   badge on providers, the provider size badge (Boutique, Mid-Market, Institutional), a general-purpose
 *   tag, and the "Independent · No referral fees" pill.
 * WHERE IT RUNS: wherever the page using them runs (usually on the server). There is no `"use client"` line
 *   and no interactivity, so they are plain components that just turn props into markup.
 * FRAMEWORK NOTES: A React component is a function whose name starts with a capital letter and which
 *   returns JSX (HTML-like markup). Its inputs are "props", written like HTML attributes:
 *   `<VerifiedBadge verified={true} />`. Tailwind classes style them, e.g. `rounded-full` = pill shape,
 *   `px-2 py-0.5` = horizontal/vertical padding, `text-[11px]` = an exact 11-pixel font size,
 *   `ring-1 ring-emerald/30` = a thin outline in emerald at 30% opacity.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - inline prop types (`{ verified }: { verified: boolean }`) with destructuring.
 *   - optional props (`accent?: boolean`), `React.ReactNode` (anything React can draw).
 *   - `Record<K, V>`: an object with one entry of type V for every key in K.
 *   - ternary `cond ? a : b`, `import type`.
 */

// `import { a } from "b"` pulls named things from a module ("lucide-react" = icon library from npm,
// `@fundhub/...` = our shared packages, `@/...` = this app's src folder).

// Icons: a tick-in-a-badge, a clock and a shield.
import { BadgeCheck, Clock, ShieldCheck } from "lucide-react";
// Type only: the allowed provider size types, taken from the database schema so they always match.
import type { ProviderType } from "@fundhub/db/schema";
// Joins class names into one string, skipping false/undefined ones.
import { cn } from "@/lib/cn";

/**
 * Kind: React component.
 * Props: verified: boolean, whether FundHub staff have verified this provider's profile.
 * Returns: JSX, a green "FundHub Verified" pill, or a grey "Pending review" pill when not verified.
 */
export function VerifiedBadge({ verified }: { verified: boolean }) {
  // The ternary `verified ? (A) : (B)` returns one of two pieces of markup.
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald/30">
      <BadgeCheck className="h-3 w-3" /> FundHub Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
      <Clock className="h-3 w-3" /> Pending review
    </span>
  );
}

/**
 * Kind: constant. Colour classes for each provider type. `Record<ProviderType, string>` means "an object
 * with a string for every ProviderType", so TypeScript complains if a new type is added to the database
 * schema but forgotten here. Keys with a dash or space must be quoted ("Mid-Market").
 */
const TYPE_STYLES: Record<ProviderType, string> = {
  Boutique: "bg-sky-50 text-sky-700 border-sky-200",
  "Mid-Market": "bg-indigo-50 text-indigo-700 border-indigo-200",
  Institutional: "bg-ink-50 text-ink-700 border-slate-300",
};

/**
 * Kind: React component.
 * Props: type: ProviderType, the provider's size category.
 * Returns: JSX, a pill showing the type name in its colour. `TYPE_STYLES[type]` looks up that type's classes.
 */
export function TypeBadge({ type }: { type: ProviderType }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", TYPE_STYLES[type])}>{type}</span>
  );
}

/**
 * Kind: React component. A general small label (e.g. a service name or a fund regime).
 * Props:
 *   children: React.ReactNode, the text (whatever is written between <Tag> and </Tag>).
 *   accent?: boolean, optional: true = green highlighted style, otherwise neutral grey.
 * Returns: JSX.
 */
export function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    // `cn(base, accent ? green : grey)` picks the colour set; a missing `accent` counts as false.
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[11px] font-medium ring-1",
        accent ? "bg-emerald-50 text-emerald-700 ring-emerald/30" : "bg-slate-50 text-ink-600 ring-slate-200",
      )}
    >
      {children}
    </span>
  );
}

/** Small pill stating FundHub's independence; used across marketing sections. */
/**
 * Kind: React component.
 * Props: className?: string, optional extra classes from the caller (e.g. spacing), added after the base
 *   classes so the caller can adjust the look.
 * Returns: JSX.
 */
export function IndependentBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald/30",
        className,
      )}
    >
      <ShieldCheck className="h-3 w-3" /> Independent · No referral fees
    </span>
  );
}
