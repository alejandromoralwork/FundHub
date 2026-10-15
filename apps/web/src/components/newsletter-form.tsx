"use client";

import { useActionState } from "react";
import { subscribe, type NewsletterState } from "@/lib/newsletter";

export function NewsletterForm() {
  const [state, action, pending] = useActionState<NewsletterState, FormData>(subscribe, {});
  if (state.ok) return <p className="text-xs font-medium text-emerald-700">{state.ok}</p>;
  return (
    <form action={action} className="flex max-w-sm gap-2">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <input
        type="email"
        name="email"
        required
        aria-label="Email for the newsletter"
        placeholder="Your work email"
        className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs focus:border-emerald focus:outline-none"
      />
      <button type="submit" disabled={pending} className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60">
        Subscribe
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
