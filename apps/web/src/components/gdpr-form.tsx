"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitGdprRequest, type GdprState } from "@/lib/gdpr-actions";

const input =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20";

const TYPES = [
  { value: "access", label: "Send me a copy of my data" },
  { value: "deletion", label: "Delete my data" },
  { value: "rectification", label: "Correct my data" },
  { value: "objection", label: "Stop using my data (objection)" },
];

export function GdprForm() {
  const [state, action, pending] = useActionState<GdprState, FormData>(submitGdprRequest, {});
  const fe = state.fieldErrors ?? {};
  if (state.ok)
    return (
      <p className="flex gap-2 rounded-lg border border-emerald/30 bg-white p-5 text-sm text-ink-600">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald" /> {state.ok}
      </p>
    );
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-600">What would you like?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <label key={t.value} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-ink-600 has-[:checked]:border-emerald has-[:checked]:bg-emerald-50">
              <input type="radio" name="type" value={t.value} className="check" /> {t.label}
            </label>
          ))}
        </div>
        {fe.type && <p className="mt-1 text-xs text-red-600">{fe.type}</p>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="g-name" className="mb-1 block text-xs font-medium text-ink-600">Name (optional)</label>
          <input id="g-name" name="name" className={input} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="g-email" className="mb-1 block text-xs font-medium text-ink-600">Email the request is about</label>
          <input id="g-email" name="email" type="email" className={input} autoComplete="email" required />
          {fe.email && <p className="mt-1 text-xs text-red-600">{fe.email}</p>}
        </div>
      </div>
      <div>
        <label htmlFor="g-details" className="mb-1 block text-xs font-medium text-ink-600">Details (optional)</label>
        <textarea id="g-details" name="details" rows={4} className={input} placeholder="e.g. which data should be corrected" />
      </div>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Send request
      </button>
    </form>
  );
}
