"use client";

/**
 * FILE: apps/web/src/components/claim-form.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "claim your company" form on a provider account's page. A provider employee either
 *   picks their company from the list of providers already on FundHub, or (if it is not listed) proposes a
 *   new one with name, main service category and website. They add their job title and an optional note.
 *   The claim is sent to the server, where FundHub staff review it before giving the account access.
 * WHERE IT RUNS: in the browser (`"use client"`), because it switches between the two modes, shows a
 *   spinner while sending and redraws with errors. Saving happens on the server in the `submitClaim`
 *   server action.
 * FRAMEWORK NOTES: `useActionState(serverAction, initialState)` connects a <form> to a server action
 *   (a function marked "use server" that runs on the server). On submit React sends the form fields as
 *   `FormData`, waits, and stores the returned value as `state` (success or error messages), and
 *   `pending` is true while waiting. Each field's `name` attribute is the key the server reads it by.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generics (`useActionState<ActionState, FormData>`, `useState<"existing" | "new">`).
 *   - union of literal strings (`"existing" | "new"`) and `as const` (keep the exact literal values).
 *   - optional props (`msg?: string`), ternaries returning markup or `null` (draw nothing).
 */

// `import { a } from "b"` pulls named things from a module. Plain names = npm libraries,
// `@/...` = this app's src folder, `@fundhub/...` = our shared packages.

// React hooks: useActionState (form + server action), useState (remembered value).
import { useActionState, useState } from "react";
// Icons: a success tick and a spinner.
import { CheckCircle2, Loader2 } from "lucide-react";
// The server action that saves the claim, and `ActionState`, the type of what it returns.
import { submitClaim, type ActionState } from "@/lib/account-actions";
// Joins class names, skipping false/undefined ones.
import { cn } from "@/lib/cn";
// The list of service categories, for the "main service category" dropdown.
import { TAXONOMY } from "@fundhub/core/taxonomy";

/**
 * Kind: constant (string). Tailwind classes shared by every input, select and textarea in this form:
 * full width, light border, rounded, padding, and a green border plus soft ring while focused.
 */
const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20";

/**
 * Kind: React component. One field's error message.
 * Props: msg?: string, optional message.
 * Returns: a red line of text, or `null` (React draws nothing for null) when there is no message.
 */
function Err({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;
}

/**
 * Kind: React component (exported; used on the provider account page).
 * Props: providers: an array of `{ id: number; name: string }`, the published providers to choose from
 *   (loaded on the server by the page and passed in).
 * Returns: JSX for the claim form.
 */
export function ClaimForm({ providers }: { providers: { id: number; name: string }[] }) {
  // `state` = last answer from submitClaim (starts empty `{}`), `action` = for <form action>,
  // `pending` = true while the server is working. Destructured from the array useActionState returns.
  const [state, action, pending] = useActionState<ActionState, FormData>(submitClaim, {});
  // Which half of the form is shown: claim an existing listing, or propose a new company.
  const [mode, setMode] = useState<"existing" | "new">("existing");
  // Per-field errors, or an empty object so `fe.jobTitle` etc. are always safe to read (`??`).
  const fe = state.fieldErrors ?? {};

  return (
    // `space-y-4` = even vertical gaps between the form's parts.
    <form action={action} className="space-y-4">
      {/* Green success message and red error message from the server, each shown only if present (`&&`). */}
      {state.ok && (
        <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> {state.ok}
        </p>
      )}
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

      {/* Tell the server which mode was used, so it knows which fields to expect. */}
      <input type="hidden" name="mode" value={mode} />
      {/* A two-button toggle ("segmented control"). `["existing", "new"] as const` is an array whose
          items keep their exact types ("existing" and "new" rather than just string), so `setMode(m)`
          type-checks. `type="button"` means clicking does not submit the form. */}
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

      {/* The ternary shows either the company dropdown or the "new company" fields. The hidden half is
          not drawn at all, so its fields are not sent. */}
      {mode === "existing" ? (
        <div>
          {/* `htmlFor` (JSX's name for the HTML `for` attribute) links the label to the field with that id. */}
          <label htmlFor="providerId" className="mb-1 block text-xs font-medium text-ink-600">
            Company
          </label>
          {/* Dropdown of providers. `defaultValue=""` starts on the disabled "Select…" placeholder, so the
              visitor must actively choose. Each option's value is the provider's database id. */}
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
        // Two-column grid from small-tablet width up; the name field spans both columns (`sm:col-span-2`).
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
            {/* One option per category in the shared taxonomy; the value sent is the category slug. */}
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

      {/* Fields shown in both modes: job title and an optional free-text note for the reviewers. */}
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
        {/* `rows={3}` = three lines tall. Numbers in JSX are passed inside braces. */}
        <textarea id="message" name="message" rows={3} className={inputClass} />
      </div>
      {/* Submit button: disabled and showing a spinner while the server action runs. */}
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
