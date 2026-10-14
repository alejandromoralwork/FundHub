"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { createRfi, type RfiFormState } from "./actions";
import { AUM_BAND_LABELS, AUM_BANDS, FUND_STRUCTURES, RFI_SERVICES } from "./options";

type ProviderOption = { id: number; slug: string; name: string };

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

function Field({
  label,
  name,
  error,
  children,
  className,
}: {
  label: string;
  name: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${name}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function RfiForm({ providers, defaultProviderId }: { providers: ProviderOption[]; defaultProviderId?: number }) {
  const [state, formAction, pending] = useActionState<RfiFormState, FormData>(createRfi, { status: "idle" });

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-emerald/30 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald" />
        <h2 className="mt-3 text-lg font-semibold text-ink">RFI submitted</h2>
        <p className="mt-1 text-sm text-ink-600">
          Reference <span className="font-mono font-medium text-ink">{state.reference}</span>
          {state.providerName ? ` has been routed to ${state.providerName}.` : " has been logged for matching."}
        </p>
        <p className="mt-1 text-xs text-slate-500">Providers typically respond within 3–5 business days.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50">
            Back to comparator
          </Link>
          {/* Full reload resets the action state to a blank form. */}
          <a href="/rfi" className="rounded-md bg-ink-900 px-3 py-2 text-xs font-medium text-white hover:bg-ink-800">
            Submit another
          </a>
        </div>
      </div>
    );
  }

  const errors = state.status === "error" ? state.fieldErrors : {};
  const values = state.status === "error" ? state.values : {};
  const v = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : undefined);
  const selectedServices = Array.isArray(values.servicesNeeded) ? (values.servicesNeeded as string[]) : [];
  const invalid = (k: string) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `${k}-error` } : {});

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-slate-200 bg-white p-5" noValidate>
      {state.status === "error" && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      {/* Honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <Field label="Provider (optional — leave blank to be matched)" name="providerId">
        <select
          id="providerId"
          name="providerId"
          defaultValue={v("providerId") ?? defaultProviderId ?? ""}
          className={inputClass}
        >
          <option value="">Match me with suitable providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" name="contactName" error={errors.contactName}>
          <input id="contactName" name="contactName" defaultValue={v("contactName")} autoComplete="name" className={inputClass} {...invalid("contactName")} />
        </Field>
        <Field label="Work email" name="email" error={errors.email}>
          <input id="email" name="email" type="email" defaultValue={v("email")} autoComplete="email" className={inputClass} {...invalid("email")} />
        </Field>
        <Field label="Company / fund" name="company" error={errors.company} className="sm:col-span-2">
          <input id="company" name="company" defaultValue={v("company")} autoComplete="organization" className={inputClass} {...invalid("company")} />
        </Field>
        <Field label="Fund structure" name="fundStructure" error={errors.fundStructure}>
          <select id="fundStructure" name="fundStructure" defaultValue={v("fundStructure") ?? ""} className={inputClass} {...invalid("fundStructure")}>
            <option value="" disabled>
              Select…
            </option>
            {FUND_STRUCTURES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Assets under management" name="aumBand" error={errors.aumBand}>
          <select id="aumBand" name="aumBand" defaultValue={v("aumBand") ?? ""} className={inputClass} {...invalid("aumBand")}>
            <option value="" disabled>
              Select…
            </option>
            {AUM_BANDS.map((s) => (
              <option key={s} value={s}>
                {AUM_BAND_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-600">Services needed</legend>
        <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-3", errors.servicesNeeded && "rounded-md ring-1 ring-red-300 p-2")}>
          {RFI_SERVICES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
              <input type="checkbox" name="servicesNeeded" value={s} defaultChecked={selectedServices.includes(s)} className="check h-4 w-4" />
              {s}
            </label>
          ))}
        </div>
        {errors.servicesNeeded && <p className="mt-1 text-xs text-red-600">{errors.servicesNeeded}</p>}
      </fieldset>

      <Field label="Scope & context (optional)" name="message">
        <textarea
          id="message"
          name="message"
          rows={5}
          defaultValue={v("message")}
          placeholder="e.g. Launching a RAIF sub-fund in Q1, quarterly NAV, ~40 LPs, need eFront connectivity for investor reporting."
          className={inputClass}
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">Your details are shared only with the provider(s) you request.</p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit RFI
        </button>
      </div>
    </form>
  );
}
