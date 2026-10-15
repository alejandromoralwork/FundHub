"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitClaim, type ActionState } from "@/lib/account-actions";
import { cn } from "@/lib/cn";
import { TAXONOMY } from "@fundhub/core/taxonomy";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20";

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;
}

export function ClaimForm({ providers }: { providers: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitClaim, {});
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4">
      {state.ok && (
        <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> {state.ok}
        </p>
      )}
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      <input type="hidden" name="mode" value={mode} />
      <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs font-medium">
        {(["existing", "new"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn("rounded px-3 py-1.5", mode === m ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-slate-50")}
          >
            {m === "existing" ? "My company is listed" : "My company isn't listed"}
          </button>
        ))}
      </div>

      {mode === "existing" ? (
        <div>
          <label htmlFor="providerId" className="mb-1 block text-xs font-medium text-ink-600">
            Company
          </label>
          <select id="providerId" name="providerId" defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select your company…
            </option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Err msg={fe.providerId} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="proposedName" className="mb-1 block text-xs font-medium text-ink-600">
              Company name
            </label>
            <input id="proposedName" name="proposedName" className={inputClass} />
            <Err msg={fe.proposedName} />
          </div>
          <div>
            <label htmlFor="proposedCategory" className="mb-1 block text-xs font-medium text-ink-600">
              Main service category
            </label>
            <select id="proposedCategory" name="proposedCategory" defaultValue="" className={inputClass}>
              <option value="" disabled>
                Select…
              </option>
              {TAXONOMY.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </select>
            <Err msg={fe.proposedCategory} />
          </div>
          <div>
            <label htmlFor="proposedWebsite" className="mb-1 block text-xs font-medium text-ink-600">
              Website
            </label>
            <input id="proposedWebsite" name="proposedWebsite" placeholder="https://" className={inputClass} />
            <Err msg={fe.proposedWebsite} />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="jobTitle" className="mb-1 block text-xs font-medium text-ink-600">
          Your job title
        </label>
        <input id="jobTitle" name="jobTitle" placeholder="e.g. Head of Business Development" className={inputClass} />
        <Err msg={fe.jobTitle} />
      </div>
      <div>
        <label htmlFor="message" className="mb-1 block text-xs font-medium text-ink-600">
          Anything that helps us confirm you represent the company (optional)
        </label>
        <textarea id="message" name="message" rows={3} className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Submit claim
      </button>
    </form>
  );
}
