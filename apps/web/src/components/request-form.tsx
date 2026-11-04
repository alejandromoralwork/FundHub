"use client";
/**
 * FILE: apps/web/src/components/request-form.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: One contact form reused for five kinds of request: "rfi" (ask providers for a quote), "advisory"
 *   (book FundHub's selection/negotiation advice), "data" (bespoke data analyses), "awards" (nominate a
 *   provider) and "claim" (a provider wanting to claim/update its profile). The fields are the same; the
 *   wording, the service checkboxes and whether fund details are asked for change with the request type.
 *   After submitting it shows a confirmation with a reference number.
 * WHERE IT RUNS: in the browser ("use client" on the first line) because it keeps the submission result in
 *   state. Validation and saving happen on the server in the `submitRequest` server action.
 * FRAMEWORK NOTES:
 *   - `useActionState(action, initialState)` wires a <form> to a server action and remembers its last result.
 *     When the server rejects the form it returns the typed `values`, so the fields are re-filled.
 *   - Fields are "uncontrolled" (`defaultValue`/`defaultChecked`): the browser keeps the typed text.
 *   - `noValidate` turns off the browser's pop-up checks so errors come from the server, shown per field.
 *   - React fragments `<>…</>` group elements without adding an extra HTML element.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type ProviderOption = { … }`; `import type` = types only.
 *   - `Record<RequestType, { … }>` = an object with exactly one entry per request type, each with that shape.
 *     TypeScript reports an error if a request type is missing, so a new type cannot be forgotten here.
 *   - discriminated union `RequestFormState` told apart by `status` ("idle" | "error" | "success").
 *   - chained `??` (`a ?? b ?? c` = first one that is not null/undefined); nested ternaries.
 *   - `Array.isArray`, `typeof`, type assertions `as string[]`, default prop value `defaultServices = []`.
 */

// `import X from "b"` imports a default export; `{ a }` picks named exports.
// Next.js's link component.
import Link from "next/link";
// React's hook for wiring a form to a server action.
import { useActionState } from "react";
// Icons from `lucide-react` (npm): tick in a circle, spinner, paper-plane "send".
import { CheckCircle2, Loader2, Send } from "lucide-react";
// The type listing the allowed request kinds: "rfi" | "advisory" | "data" | "awards" | "claim" (packages/db).
import type { RequestType } from "@fundhub/db/schema";
// `cn` (this app's src/lib/cn.ts) joins class names, skipping false/undefined ones.
import { cn } from "@/lib/cn";
// From this app's src/lib/request-actions.ts: the server action and the type of its result.
import { submitRequest, type RequestFormState } from "@/lib/request-actions";
// Shared option lists from packages/core: assets-under-management bands and their labels, fund structures,
// which request types skip the fund questions (NO_FUND_FIELDS), and the service checkbox groups per type.
import { AUM_BAND_LABELS, AUM_BANDS, FUND_STRUCTURES, NO_FUND_FIELDS, SERVICE_GROUPS } from "@fundhub/core/request-options";

/**
 * Kind: type alias. One entry in the provider dropdown: database `id`, URL `slug` and display `name`.
 */
type ProviderOption = { id: number; slug: string; name: string };

/**
 * Kind: constant (string). Tailwind classes shared by inputs, dropdowns and the textarea: full width, rounded
 * border, grey placeholder text, green focus ring, and a red border when the field has `aria-invalid="true"`
 * (the `aria-[invalid=true]:` variant), which `invalid()` below sets on fields with a server error.
 */
const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

/**
 * Kind: constant lookup table (the form's wording per request type).
 * Type: `Record<RequestType, {…}>` — one entry for each request type, each with these text fields:
 *   providerLabel / providerEmpty   label of the provider dropdown and its "none" option;
 *   companyLabel                    label of the company field;
 *   servicesLegend                  heading above the service checkboxes;
 *   messageLabel / messagePlaceholder  label and example text of the free-text box;
 *   privacy                         the reassurance line next to the submit button;
 *   submit                          the submit button text;
 *   successTitle / successNote      texts on the confirmation screen;
 *   again                           the URL that "Submit another" goes to (this form's page).
 * The privacy lines reflect business rules, e.g. advisory requests are never shared with providers.
 */
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

/**
 * Kind: React component (private to this file).
 * Wraps one form control with its label and optional error message.
 * Props: label (`string`), name (`string`, must equal the control's id), error (`string`, optional),
 *   children (`React.ReactNode`, the control itself), className (`string`, optional extra classes).
 * Returns: JSX. The error paragraph gets the id "<name>-error" so the control can point to it with
 *   `aria-describedby`, letting screen readers read the error together with the field.
 */
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
      {/* `htmlFor` (JSX's name for HTML `for`) links this label to the control with id = name. */}
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

/**
 * Kind: React component (client component, exported).
 * Props:
 *   - requestType        `RequestType` — which of the five request kinds this form is for.
 *   - providers          `ProviderOption[]` — the providers to list in the dropdown.
 *   - defaultProviderId  `number`, optional — pre-select this provider (e.g. from a "Request Quote" link).
 *   - defaultServices    `string[]`, optional, default `[]` (empty list) — services to pre-tick.
 * Returns: JSX — the confirmation screen after success, otherwise the form.
 */
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
  // `state` = last server result, starting as { status: "idle" }; `formAction` = what the <form> calls;
  // `pending` = true while submitting.
  const [state, formAction, pending] = useActionState<RequestFormState, FormData>(submitRequest, { status: "idle" });
  // Pick this request type's wording and service checkbox groups from the lookup tables.
  const copy = COPY[requestType];
  const groups = SERVICE_GROUPS[requestType];

  // After success, show the confirmation box instead of the form (an "early return").
  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-emerald/30 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald" />
        <h2 className="mt-3 text-lg font-semibold text-ink">{copy.successTitle}</h2>
        <p className="mt-1 text-sm text-ink-600">
          {/* The reference number generated by the server, in a monospace font (`font-mono`). */}
          Reference <span className="font-mono font-medium text-ink">{state.reference}</span>
          {/* Nested ternary: for a quote request, say whether it went to a named provider or into the matching
              queue; for every other type just say it was logged. */}
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
          {/* (A plain <a> is used on purpose instead of <Link>: <Link> would keep this component and its
              "success" state alive, whereas a full page load starts fresh.) */}
          <a href={copy.again} className="rounded-md bg-ink-900 px-3 py-2 text-xs font-medium text-white hover:bg-ink-800">
            Submit another
          </a>
        </div>
      </div>
    );
  }

  // Only an "error" result carries field errors and previously typed values; otherwise use empty objects.
  const errors = state.status === "error" ? state.fieldErrors : {};
  const values = state.status === "error" ? state.values : {};
  // Kind: helper function. `v("email")` = the previously typed text for that field, or undefined.
  // Values arrive as `unknown`, so we check they are text at run time before asserting `as string`.
  const v = (k: string) => (typeof values[k] === "string" ? (values[k] as string) : undefined);
  // The services to tick: the ones submitted last time (if the server sent back a list), else the defaults.
  const selectedServices = Array.isArray(values.servicesNeeded) ? (values.servicesNeeded as string[]) : defaultServices;
  // Kind: helper function. For a field with an error, returns the accessibility attributes marking it invalid
  // and pointing to its error text (`${k}-error`, the id set in Field); otherwise an empty object.
  // Used as {...invalid("email")} to spread those attributes onto the control.
  const invalid = (k: string) => (errors[k] ? { "aria-invalid": true, "aria-describedby": `${k}-error` } : {});

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-slate-200 bg-white p-5" noValidate>
      {/* General error message at the top; `role="alert"` makes screen readers announce it immediately. */}
      {state.status === "error" && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      {/* Hidden field telling the server which kind of request this is. */}
      <input type="hidden" name="requestType" value={requestType} />
      {/* Honeypot */}
      {/* (An invisible "website" field: humans never fill it in, spam bots do, so the server can discard them.) */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {/* Provider dropdown. Starting value: last submitted choice, else the pre-selected provider, else ""
          (the "none / match me" option). Each <option>'s `value` is the provider's id. */}
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

      {/* Contact details in a two-column grid from small screens; the company field spans both columns. */}
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
        {/* Fund questions only for request types that concern a fund (not data / awards / claim).
            `!list.includes(x)` = "x is not in the list". The fragment <>…</> groups the two fields. */}
        {!NO_FUND_FIELDS.includes(requestType) && (
          <>
            {/* Dropdowns start on a disabled "Select…" placeholder so the user has to choose. */}
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
            {/* AUM band: the option's value is a short code (e.g. "lt-100m"), the visible text its label ("< €100m"). */}
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

      {/* Service checkboxes, grouped. When the server reports an error for them, the whole block gets a thin
          red ring (`cn` adds those classes only when `errors.servicesNeeded` has a value). */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-600">{copy.servicesLegend}</legend>
        <div className={cn("space-y-4", errors.servicesNeeded && "rounded-md p-2 ring-1 ring-red-300")}>
          {/* Some groups have no label, so the key falls back to the position `i` (`g.label ?? i`). */}
          {groups.map((g, i) => (
            <div key={g.label ?? i}>
              {g.label && (
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.label}</p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {/* All checkboxes share the name "servicesNeeded", so the server receives the ticked ones as a list. */}
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

      {/* Optional free-text message, with type-specific label and example placeholder. */}
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

      {/* Footer: privacy note and submit button (stacked on phones, side by side from small screens). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-slate-500">{copy.privacy}</p>
        {/* Disabled while sending; spinner icon replaces the send icon during that time. */}
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
