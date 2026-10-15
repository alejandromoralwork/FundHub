"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { PROVIDER_TYPES } from "@/db/schema";
import { approveNewListing, uploadReport, type AdminState } from "@/lib/admin-actions";
import { TAXONOMY } from "@/lib/taxonomy";

const input =
  "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-ink focus:border-emerald focus:outline-none";

function Status({ state }: { state: AdminState }) {
  if (state.ok) return <p className="text-xs text-emerald-700">{state.ok}</p>;
  if (state.error) return <p className="text-xs text-red-600">{state.error}</p>;
  return null;
}

export function NewListingForm({ claimId, category }: { claimId: number; category: string | null }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(approveNewListing, {});
  return (
    <form action={action} className="mt-2 grid gap-2 sm:grid-cols-6">
      <input type="hidden" name="claimId" value={claimId} />
      <select name="category" defaultValue={category ?? ""} className={`${input} sm:col-span-2`} aria-label="Category">
        {TAXONOMY.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.label}
          </option>
        ))}
      </select>
      <select name="providerType" defaultValue="Boutique" className={input} aria-label="Provider type">
        {PROVIDER_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <input name="headcount" type="number" min={1} placeholder="Headcount" className={input} aria-label="Headcount" />
      <input name="priceMin" type="number" min={1} placeholder="Fee min €/qtr" className={input} aria-label="Minimum fee" />
      <input name="priceMax" type="number" min={1} placeholder="Fee max €/qtr" className={input} aria-label="Maximum fee" />
      <div className="flex items-center gap-3 sm:col-span-6">
        <button
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />} Create listing & approve
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ReportUploadForm() {
  const [state, action, pending] = useActionState<AdminState, FormData>(uploadReport, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input name="title" placeholder="Title, e.g. Depositary Fees Deep-Dive" className={input} required />
      <input name="period" placeholder="Period, e.g. Q4 2026" className={input} required />
      <textarea name="summary" rows={2} placeholder="Short summary shown on the page" className={`${input} sm:col-span-2`} />
      <select name="visibility" defaultValue="private" className={input} aria-label="Visibility">
        <option value="public">Public: anyone can download</option>
        <option value="private">Private: approved provider accounts</option>
      </select>
      <input name="file" type="file" accept="application/pdf" className="text-xs" required />
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3 w-3 animate-spin" />} Upload PDF (max 4 MB)
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
