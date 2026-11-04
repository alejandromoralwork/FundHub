"use client";
/**
 * FILE: apps/web/src/components/review-form.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The form a fund manager fills in to review a service provider: (1) 1–5 ratings on five
 *   dimensions, (2) a title and written experience, (3) private verification details (name, work email,
 *   company, role, relationship, evidence) plus a signed statement. On success it shows a "pending
 *   verification" message instead of the form. Reviews are only published after FundHub verifies the reviewer.
 * WHERE IT RUNS: in the browser ("use client" on the first line) because it keeps the submission result in
 *   state. The checking and saving happen on the server in the `submitReview` server action.
 * FRAMEWORK NOTES:
 *   - `useActionState(action, initialState)` wires a <form> to a server action and remembers its last result.
 *     When the server rejects the form it sends back the typed `values`, so fields are re-filled and the user
 *     does not lose what they wrote.
 *   - Fields are "uncontrolled" (`defaultValue`): the browser keeps the typed text; React reads it on submit.
 *   - `noValidate` on the form turns off the browser's own pop-up checks, so all errors come from the server
 *     and are shown in one consistent style next to each field.
 *   - Tailwind "peer" classes: an element marked `peer` lets its following sibling style itself based on the
 *     peer's state, e.g. `peer-checked:bg-emerald` = "turn green when the radio button before me is checked".
 *   - `&apos;` in JSX text is the HTML code for an apostrophe ('), used to avoid a lint warning.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `as const` = freeze a constant so TypeScript knows its exact values (and that they never change).
 *   - discriminated union: `ReviewFormState` is one of several shapes told apart by `status` ("idle", "error",
 *     "success"); checking `state.status === "error"` lets TypeScript know `state.fieldErrors` exists.
 *   - `typeof x === "string"` runtime type check; `as string` type assertion; `!!x` = convert to true/false.
 *   - spread of an object into JSX attributes `{...inv("title")}`.
 */

// `import X from "b"` imports a default export; `{ a }` picks named exports.
// Next.js's link component.
import Link from "next/link";
// React's hook for wiring a form to a server action.
import { useActionState } from "react";
// Icons from `lucide-react` (npm): a tick in a circle, a spinner, and a paper-plane "send".
import { CheckCircle2, Loader2, Send } from "lucide-react";
// The fixed list of client relationship options (e.g. "Current client"), from our database package.
import { CLIENT_RELATIONSHIPS } from "@fundhub/db/schema";
// From this app's src/lib/review-actions.ts: the server action and the type of its result.
import { submitReview, type ReviewFormState } from "@/lib/review-actions";
// The list of fund structure options (e.g. SICAV, RAIF…), from packages/core.
import { FUND_STRUCTURES } from "@fundhub/core/request-options";

/**
 * Kind: constant (string). Tailwind classes shared by the text inputs, textarea and dropdowns: full width,
 * rounded border, green focus ring, and — via the `aria-[invalid=true]:` variant — a red border whenever the
 * field carries `aria-invalid="true"` (set by `inv()` below when the server reports an error for it).
 */
const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

/**
 * Kind: constant (exported, read-only list). The five rating dimensions of a review. `name` is the form field
 * name (and database column), `label` the text shown. `as const` makes the list and its strings read-only and
 * exact. Exported so other files (e.g. pages showing reviews) use the same names and labels.
 */
export const REVIEW_DIMENSIONS = [
  { name: "overall", label: "Overall satisfaction" },
  { name: "serviceQuality", label: "Service quality & accuracy" },
  { name: "responsiveness", label: "Responsiveness" },
  { name: "pricingTransparency", label: "Pricing transparency" },
  { name: "technology", label: "Technology & reporting" },
] as const;

/**
 * Kind: React component (private to this file).
 * Wraps one form control with its label and optional error message.
 * Props: label (`string`), name (`string`, must match the control's id so the label points to it),
 *   error (`string`, optional), children (`React.ReactNode`, the actual input/select/textarea).
 * Returns: JSX — label, the control, then the error in red if any.
 */
function Field({ label, name, error, children }: { label: string; name: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      {/* `htmlFor` (JSX's name for HTML `for`) links this label to the control with id = name. */}
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Kind: React component (client component, exported).
 * Props:
 *   - providerId    `number` — database id of the provider being reviewed (sent in a hidden field).
 *   - providerName  `string` — shown in the texts ("a client of …").
 *   - providerSlug  `string` — used for the "Back to provider" link after success.
 * Returns: JSX — the success message, or the review form.
 */
export function ReviewForm({ providerId, providerName, providerSlug }: { providerId: number; providerName: string; providerSlug: string }) {
  // `state` = last server result, starting as { status: "idle" }; `action` = what the <form> calls;
  // `pending` = true while submitting.
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(submitReview, { status: "idle" });

  // After a successful submission, replace the whole form with a thank-you box (an "early return").
  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-emerald/30 bg-white p-8 text-center">
        {/* `mx-auto` centres the icon horizontally. */}
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

  // Only an "error" result carries field errors and the previously typed values; otherwise use empty objects.
  // The ternary `state.status === "error" ? … : {}` also lets TypeScript know those fields exist.
  const fe = state.status === "error" ? state.fieldErrors : {};
  const vals = state.status === "error" ? state.values : {};
  // Kind: helper function. `v("title")` returns the previously typed text for that field, or undefined.
  // The server sends values as `unknown` (could be anything), so we check `typeof … === "string"` at run
  // time, and then `as string` tells TypeScript we have confirmed it is text.
  const v = (k: string) => (typeof vals[k] === "string" ? (vals[k] as string) : undefined);
  // Kind: helper function. Returns `{ "aria-invalid": true }` when field k has an error, else
  // `{ "aria-invalid": undefined }` (React then leaves the attribute out). `!!x` turns a message into true and
  // a missing one into false; `|| undefined` turns false into undefined. Spread into an input with {...inv(k)}.
  const inv = (k: string) => ({ "aria-invalid": !!fe[k] || undefined });

  return (
    <form action={action} className="space-y-5" noValidate>
      {/* The general error message at the top. `role="alert"` makes screen readers announce it at once. */}
      {state.status === "error" && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      {/* Hidden field: which provider this review is about. */}
      <input type="hidden" name="providerId" value={providerId} />
      {/* Honeypot spam trap: invisible to humans, but bots fill it in, and the server then discards the submission. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {/* SECTION 1: ratings. A <fieldset> groups related fields; its <legend> is the group's caption. */}
      <fieldset className="rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">1. Your ratings</legend>
        <div className="mt-2 space-y-3">
          {/* One row per dimension: label on the left, five numbered buttons on the right (stacked on phones). */}
          {REVIEW_DIMENSIONS.map((d) => (
            <div key={d.name} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-ink-600">{d.label}</span>
              {/* `role="radiogroup"` tells assistive technology these five options belong together. */}
              <div role="radiogroup" aria-label={d.label} className="flex gap-1">
                {/* `[1, 2, 3, 4, 5].map(…)` draws one option per score. Each is a real radio button (all with
                    the same `name`, so only one can be chosen) that is visually hidden (`sr-only`) but still
                    usable by keyboard; the <span> after it is the visible square. Because the input has class
                    `peer`, the square turns green when checked (`peer-checked:`) and shows a ring when focused
                    by keyboard (`peer-focus-visible:`). Clicking the square clicks the radio because both are
                    inside the same <label>. After an error, the previous choice is re-ticked via v(d.name). */}
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

      {/* SECTION 2: the written review. Each control gets its previous value via v(…) and its red-border flag
          via {...inv(…)}. `maxLength` limits the title to 120 characters in the browser. */}
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

      {/* SECTION 3: private verification details. Business rule: only role and fund type are ever published;
          name, email and company are used solely to check the reviewer is a genuine client. */}
      <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">3. Verification (kept private)</legend>
        <p className="text-xs text-ink-600">
          We publish your role and fund type only, never your name, email or company. These details let us verify you
          are a genuine client.
        </p>
        {/* Two-column grid from small screens. `autoComplete` hints let the browser offer saved details. */}
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
          {/* Dropdown starting on a disabled "Select…" placeholder (value ""), so the user must pick one.
              `v(…) ?? ""` falls back to the placeholder when there is no previous value. */}
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
          {/* Optional: "Prefer not to say" sends an empty value. */}
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
        {/* The signed statement. A ticked checkbox sends "attest=on"; an unticked one sends nothing, and the
            server rejects the review with an error for "attest". */}
        <label className="flex gap-2 text-xs leading-relaxed text-ink-600">
          <input type="checkbox" name="attest" className="check mt-0.5 h-4 w-4 shrink-0" />
          I confirm I am (or was in the last 3 years) a client of {providerName}, I don&apos;t work for it or a
          competitor, and I have received no payment or benefit for this review.
        </label>
        {fe.attest && <p className="text-xs text-red-600">{fe.attest}</p>}
      </fieldset>

      {/* Submit button: disabled while sending, with a spinner instead of the send icon during that time. */}
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
