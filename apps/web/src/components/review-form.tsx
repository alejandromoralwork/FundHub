"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { CLIENT_RELATIONSHIPS } from "@fundhub/db/schema";
import { submitReview, type ReviewFormState } from "@/lib/review-actions";
import { FUND_STRUCTURES } from "@fundhub/core/request-options";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

export const REVIEW_DIMENSIONS = [
  { name: "overall", label: "Overall satisfaction" },
  { name: "serviceQuality", label: "Service quality & accuracy" },
  { name: "responsiveness", label: "Responsiveness" },
  { name: "pricingTransparency", label: "Pricing transparency" },
  { name: "technology", label: "Technology & reporting" },
] as const;

function Field({ label, name, error, children }: { label: string; name: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function ReviewForm({ providerId, providerName, providerSlug }: { providerId: number; providerName: string; providerSlug: string }) {
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(submitReview, { status: "idle" });

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-emerald/30 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald" />
        <h2 className="mt-3 text-lg font-semibold text-ink">Thank you, your review is pending verification</h2>
        <p className="mt-1 text-sm text-ink-600">
          FundHub will contact you at your work email to confirm you&apos;re a client of {providerName}. Once verified,
          your review is published anonymously.
        </p>
        <Link href={`/providers/${providerSlug}`} className="mt-5 inline-block text-sm font-medium text-emerald-700 hover:underline">
          Back to {providerName}
        </Link>
      </div>
    );
  }

  const fe = state.status === "error" ? state.fieldErrors : {};
  const vals = state.status === "error" ? state.values : {};
  const v = (k: string) => (typeof vals[k] === "string" ? (vals[k] as string) : undefined);
  const inv = (k: string) => ({ "aria-invalid": !!fe[k] || undefined });

  return (
    <form action={action} className="space-y-5" noValidate>
      {state.status === "error" && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      <input type="hidden" name="providerId" value={providerId} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">1. Your ratings</legend>
        <div className="mt-2 space-y-3">
          {REVIEW_DIMENSIONS.map((d) => (
            <div key={d.name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-ink-600">{d.label}</span>
              <div role="radiogroup" aria-label={d.label} className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n} className="cursor-pointer">
                    <input type="radio" name={d.name} value={n} defaultChecked={v(d.name) === String(n)} className="peer sr-only" />
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-sm font-medium text-ink-600 peer-checked:border-emerald peer-checked:bg-emerald peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-emerald/40">
                      {n}
                    </span>
                  </label>
                ))}
              </div>
              {fe[d.name] && <p className="text-xs text-red-600">{fe[d.name]}</p>}
            </div>
          ))}
          <p className="text-[11px] text-slate-400">1 = very poor · 5 = excellent</p>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">2. Your review</legend>
        <Field label="Title" name="title" error={fe.title}>
          <input id="title" name="title" defaultValue={v("title")} maxLength={120} className={inputClass} {...inv("title")} />
        </Field>
        <Field label="Your experience (min. 80 characters)" name="body" error={fe.body}>
          <textarea
            id="body"
            name="body"
            rows={6}
            defaultValue={v("body")}
            placeholder="What works well, what doesn't, how they handle issues, how fees evolved…"
            className={inputClass}
            {...inv("body")}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">3. Verification (kept private)</legend>
        <p className="text-xs text-ink-600">
          We publish your role and fund type only, never your name, email or company. These details let us verify you
          are a genuine client.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" name="reviewerName" error={fe.reviewerName}>
            <input id="reviewerName" name="reviewerName" defaultValue={v("reviewerName")} autoComplete="name" className={inputClass} {...inv("reviewerName")} />
          </Field>
          <Field label="Work email" name="reviewerEmail" error={fe.reviewerEmail}>
            <input id="reviewerEmail" name="reviewerEmail" type="email" defaultValue={v("reviewerEmail")} autoComplete="email" className={inputClass} {...inv("reviewerEmail")} />
          </Field>
          <Field label="Company (asset manager / fund)" name="reviewerCompany" error={fe.reviewerCompany}>
            <input id="reviewerCompany" name="reviewerCompany" defaultValue={v("reviewerCompany")} autoComplete="organization" className={inputClass} {...inv("reviewerCompany")} />
          </Field>
          <Field label="Your role (published)" name="reviewerRole" error={fe.reviewerRole}>
            <input id="reviewerRole" name="reviewerRole" defaultValue={v("reviewerRole")} placeholder="e.g. CFO, Head of Fund Operations" className={inputClass} {...inv("reviewerRole")} />
          </Field>
          <Field label="Relationship" name="relationship" error={fe.relationship}>
            <select id="relationship" name="relationship" defaultValue={v("relationship") ?? ""} className={inputClass} {...inv("relationship")}>
              <option value="" disabled>
                Select…
              </option>
              {CLIENT_RELATIONSHIPS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Client since (year, optional)" name="clientSince" error={fe.clientSince}>
            <input id="clientSince" name="clientSince" type="number" defaultValue={v("clientSince")} className={inputClass} />
          </Field>
          <Field label="Fund structure (published, optional)" name="fundStructure">
            <select id="fundStructure" name="fundStructure" defaultValue={v("fundStructure") ?? ""} className={inputClass}>
              <option value="">Prefer not to say</option>
              {FUND_STRUCTURES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="How can we verify you're a client?" name="evidence" error={fe.evidence}>
            <input
              id="evidence"
              name="evidence"
              defaultValue={v("evidence")}
              placeholder="e.g. Fund name, contract year, your contact at the provider"
              className={inputClass}
              {...inv("evidence")}
            />
          </Field>
        </div>
        <label className="flex gap-2 text-xs leading-relaxed text-ink-600">
          <input type="checkbox" name="attest" className="check mt-0.5 h-4 w-4 shrink-0" />
          I confirm I am (or was in the last 3 years) a client of {providerName}, I don&apos;t work for it or a
          competitor, and I have received no payment or benefit for this review.
        </label>
        {fe.attest && <p className="text-xs text-red-600">{fe.attest}</p>}
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Submit for verification
      </button>
    </form>
  );
}
