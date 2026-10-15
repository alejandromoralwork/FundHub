"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const COOKIE = "fh_consent";
export type Consent = "analytics" | "essential";

export function readConsent(): Consent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )fh_consent=(analytics|essential)/);
  return (m?.[1] as Consent) ?? null;
}

function writeConsent(c: Consent) {
  document.cookie = `${COOKIE}=${c}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  // Analytics scripts listen for this and load only after consent.
  window.dispatchEvent(new CustomEvent("fh:consent", { detail: c }));
}

/** Banner shown until a choice is made; "Cookie settings" in the footer reopens it. */
export function CookieConsent() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(readConsent() === null);
    const reopen = () => setOpen(true);
    window.addEventListener("fh:cookie-settings", reopen);
    return () => window.removeEventListener("fh:cookie-settings", reopen);
  }, []);
  if (!open) return null;

  const choose = (c: Consent) => {
    writeConsent(c);
    setOpen(false);
  };
  return (
    <div role="dialog" aria-label="Cookie choices" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl sm:inset-x-6">
      <p className="text-sm text-ink-600">
        We use cookies needed to run FundHub (like keeping you logged in). With your consent we also use analytics cookies to
        understand how the site is used. <Link href="/legal/cookies" className="font-medium text-emerald-700 underline">Cookie policy</Link>
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => choose("essential")} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-50">
          Essential only
        </button>
        <button type="button" onClick={() => choose("analytics")} className="rounded-md bg-ink-900 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-800">
          Accept analytics
        </button>
      </div>
    </div>
  );
}

export function CookieSettingsLink() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("fh:cookie-settings"))} className="text-xs text-ink-600 hover:text-ink hover:underline">
      Cookie settings
    </button>
  );
}
