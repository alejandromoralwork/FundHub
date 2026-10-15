"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import type { RequestType } from "@fundhub/db/schema";
import { cn } from "@/lib/cn";
import { submitRequest, type RequestFormState } from "@/lib/request-actions";
import { AUM_BAND_LABELS, AUM_BANDS, FUND_STRUCTURES, NO_FUND_FIELDS, SERVICE_GROUPS } from "@fundhub/core/request-options";

type ProviderOption = { id: number; slug: string; name: string };

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

const COPY: Record<
  RequestType,
  {
    providerLabel: string;
    providerEmpty: string;
    companyLabel: string;
    servicesLegend: string;
    messageLabel: string;
    messagePlaceholder: string;
    privacy: string;
    submit: string;
    successTitle: string;
    successNote: string;
    again: string;
  }
> = {
  rfi: {
    providerLabel: "Provider (optional; leave blank to be matched)",
    providerEmpty: "Match me with suitable providers",
    companyLabel: "Company / fund",
    servicesLegend: "Services needed",
    messageLabel: "Scope & context (optional)",
    messagePlaceholder:
      "e.g. Launching a RAIF sub-fund in Q1, quarterly NAV, ~40 LPs, need eFront connectivity for investor reporting.",
    privacy: "Your details are shared only with the provider(s) you request. FundHub receives no referral fee.",
    submit: "Submit request",
    successTitle: "Request submitted",
    successNote: "Providers typically respond within 3–5 business days.",
    again: "/rfi",
  },
  advisory: {
    providerLabel: "Provider concerned (optional)",
    providerEmpty: "Not about a specific provider",
    companyLabel: "Company / fund",
    servicesLegend: "How can we help?",
    messageLabel: "Context (optional)",
    messagePlaceholder:
      "e.g. We received two administration proposals for a €300m RE RAIF and want them audited before our pricing meeting next month.",
    privacy: "Confidential. Your request is never shared with service providers.",
    submit: "Request a consultation",
    successTitle: "Consultation requested",
    successNote: "A senior FundHub advisor will contact you within one business day.",
    again: "/advisory#contact",
  },
  data: {
    providerLabel: "Your company (if listed on FundHub)",
    providerEmpty: "Not listed / not a provider",
    companyLabel: "Company",
    servicesLegend: "What are you interested in?",
    messageLabel: "Describe what you need (optional)",
    messagePlaceholder: "e.g. Fee benchmark for depositary-lite services on RE funds above €500m, by provider size.",
    privacy: "Confidential. Bespoke analyses use anonymized, aggregated data only.",
    submit: "Request a proposal",
    successTitle: "Request received",
    successNote: "Our Data Intelligence team will send you a proposal within three business days.",
    again: "/data-intelligence#private-services",
  },
  awards: {
    providerLabel: "Company to nominate (if listed on FundHub)",
    providerEmpty: "Not listed yet",
    companyLabel: "Your company",
    servicesLegend: "Award categories",
    messageLabel: "Why this provider? (optional)",
    messagePlaceholder: "Key achievements, client feedback, innovations this year…",
    privacy: "Nominations are reviewed against verified data. Fees never decide the outcome.",
    submit: "Submit nomination / register interest",
    successTitle: "Nomination received",
    successNote: "We'll confirm eligibility and next steps by email.",
    again: "/awards#nominate",
  },
  claim: {
    providerLabel: "Your firm (if already listed)",
    providerEmpty: "Not listed yet",
    companyLabel: "Firm name",
    servicesLegend: "I'm interested in",
    messageLabel: "Message (optional)",
    messagePlaceholder: "e.g. Our headcount and tech stack have changed. We'd like to update the profile and start the verification process.",
    privacy: "Subscriptions never influence rankings, scores or the Verified badge.",
    submit: "Send",
    successTitle: "Request received",
    successNote: "Our provider-relations team will be in touch within two business days.",
    again: "/for-providers#contact",
  },
};

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

export function RequestForm({
  requestType,
  providers,
  defaultProviderId,
  defaultServices = [],
}: {
  requestType: RequestType;
  providers: ProviderOption[];
  defaultProviderId?: number;
  defaultServices?: string[];
}) {
  const [state, formAction, pending] = useActionState<RequestFormState, FormData>(submitRequest, { status: "idle" });
  const copy = COPY[requestType];
  const groups = SERVICE_GROUPS[requestType];

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-emerald/30 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald" />
        <h2 className="mt-3 text-lg font-semibold text-ink">{copy.successTitle}</h2>
        <p className="mt-1 text-sm text-ink-600">
          Reference <span className="font-mono font-medium text-ink">{state.reference}</span>
          {requestType === "rfi"
            ? state.providerName
              ? ` has been routed to ${state.providerName}.`
              : " has been logged for matching."
            : " has been logged."}
        </p>
        <p className="mt-1 text-xs text-slate-500">{copy.successNote}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href="/compare"
            className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50"
          >
            Back to comparator
          </Link>
          {/* Full reload resets the action state to a blank form. */}
          <a href={copy.again} className="rounded-md bg-ink-900 px-3 py-2 text-xs font-medium text-white hover:bg-ink-800">
            Submit another
          </a>
        </div>
      </div>
    );
  }

  const errors = state.status === "error" ? state.fieldErrors : {};
  const values = state.status === "error" ? state.values : {};
  const v = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : undefined);
  const selectedServices = Array.isArray(values.servicesNeeded) ? (values.servicesNeeded as string[]) : defaultServices;
  const invalid = (k: string) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `${k}-error` } : {});

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-slate-200 bg-white p-5" noValidate>
      {state.status === "error" && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      <input type="hidden" name="requestType" value={requestType} />
      {/* Honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <Field label={copy.providerLabel} name="providerId">
        <select id="providerId" name="providerId" defaultValue={v("providerId") ?? defaultProviderId ?? ""} className={inputClass}>
          <option value="">{copy.providerEmpty}</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" name="contactName" error={errors.contactName}>
          <input
            id="contactName"
            name="contactName"
            defaultValue={v("contactName")}
            autoComplete="name"
            className={inputClass}
            {...invalid("contactName")}
          />
        </Field>
        <Field label="Work email" name="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={v("email")}
            autoComplete="email"
            className={inputClass}
            {...invalid("email")}
          />
        </Field>
        <Field label={copy.companyLabel} name="company" error={errors.company} className="sm:col-span-2">
          <input
            id="company"
            name="company"
            defaultValue={v("company")}
            autoComplete="organization"
            className={inputClass}
            {...invalid("company")}
          />
        </Field>
        {!NO_FUND_FIELDS.includes(requestType) && (
          <>
            <Field label="Fund structure" name="fundStructure" error={errors.fundStructure}>
              <select
                id="fundStructure"
                name="fundStructure"
                defaultValue={v("fundStructure") ?? ""}
                className={inputClass}
                {...invalid("fundStructure")}
              >
                <option value="" disabled>
                  Select…
                </option>
                {FUND_STRUCTURES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Assets under management" name="aumBand" error={errors.aumBand}>
              <select
                id="aumBand"
                name="aumBand"
                defaultValue={v("aumBand") ?? ""}
                className={inputClass}
                {...invalid("aumBand")}
              >
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
          </>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-600">{copy.servicesLegend}</legend>
        <div className={cn("space-y-4", errors.servicesNeeded && "rounded-md p-2 ring-1 ring-red-300")}>
          {groups.map((g, i) => (
            <div key={g.label ?? i}>
              {g.label && (
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {g.options.map((s) => (
                  <label key={s} className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
                    <input
                      type="checkbox"
                      name="servicesNeeded"
                      value={s}
                      defaultChecked={selectedServices.includes(s)}
                      className="check h-4 w-4 shrink-0"
                    />
                    {s}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {errors.servicesNeeded && <p className="mt-1 text-xs text-red-600">{errors.servicesNeeded}</p>}
      </fieldset>

      <Field label={copy.messageLabel} name="message">
        <textarea
          id="message"
          name="message"
          rows={5}
          defaultValue={v("message")}
          placeholder={copy.messagePlaceholder}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-slate-500">{copy.privacy}</p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {copy.submit}
        </button>
      </div>
    </form>
  );
}
