"use client";

/**
 * FILE: apps/web/src/components/gdpr-form.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The form on the privacy page where anyone can exercise their GDPR rights: get a copy of
 *   their data, have it deleted, have it corrected, or object to its use. The visitor picks one request
 *   type, gives the email the request is about, optionally a name and details, and sends it. On success
 *   the form is replaced by a confirmation message with a reference number.
 * WHERE IT RUNS: in the browser (`"use client"`), for the spinner and the in-place confirmation. The request
 *   is saved on the server by the `submitGdprRequest` server action.
 * FRAMEWORK NOTES: `useActionState(serverAction, initialState)` connects the <form> to a server action (a
 *   function marked "use server" that runs on the server). On submit, React sends the fields as `FormData`,
 *   waits, keeps the returned value as `state`, and sets `pending` to true while waiting.
 *   Tailwind's `has-[:checked]:` prefix styles an element when something inside it is checked (used to
 *   highlight the chosen option card).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generics (`useActionState<GdprState, FormData>`), `import type`-style named imports (`type GdprState`).
 *   - an early `return` from a component to show something else, logical `&&`, nullish coalescing `??`.
 */

// `import { a } from "b"` pulls named things from a module. Plain names = npm libraries,
// `@/...` = this app's src folder.

// React hook that runs a server action from a form (see header).
import { useActionState } from "react";
// Icons: a success tick and a spinner.
import { CheckCircle2, Loader2 } from "lucide-react";
// The server action that stores the request, and `GdprState`, the type of what it returns.
import { submitGdprRequest, type GdprState } from "@/lib/gdpr-actions";

/**
 * Kind: constant (string). Tailwind classes shared by the text inputs and the textarea: full width, light
 * border, rounded corners, padding, green border plus soft ring while focused.
 */
const input =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20";

/**
 * Kind: constant. The four request types offered: `value` is what is sent to the server, `label` is the
 * plain-English text shown to the visitor. They match the rights in GDPR articles 15, 17, 16 and 21.
 */
const TYPES = [
  { value: "access", label: "Send me a copy of my data" },
  { value: "deletion", label: "Delete my data" },
  { value: "rectification", label: "Correct my data" },
  { value: "objection", label: "Stop using my data (objection)" },
];

/**
 * Kind: React component (exported; used on the privacy request page). Props: none.
 * Returns: JSX, either the confirmation message (after a successful send) or the form.
 */
export function GdprForm() {
  // `state` = the server action's last answer (starts empty `{}`), `action` = for <form action>,
  // `pending` = true while sending. Destructured from the array that useActionState returns.
  const [state, action, pending] = useActionState<GdprState, FormData>(submitGdprRequest, {});
  // Per-field errors, or an empty object (`??`) so `fe.email` is always safe to read.
  const fe = state.fieldErrors ?? {};
  // Success: return early with only the confirmation (the server's message includes the reference number),
  // so the form disappears and cannot be sent twice by accident.
  if (state.ok)
    return (
      <p className="flex gap-2 rounded-lg border border-emerald/30 bg-white p-5 text-sm text-ink-600">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald" /> {state.ok}
      </p>
    );
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      {/* A form-level error from the server (e.g. too many requests), shown only if present. */}
      {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {/* Spam trap ("honeypot"): a field hidden from people (`hidden`, `aria-hidden`, not reachable with Tab:
          `tabIndex={-1}`). Spam robots tend to fill every field; if "website" arrives filled, the server
          quietly pretends success and stores nothing. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink-600">What would you like?</legend>
        {/* One radio-button card per request type, two columns from small-tablet width up. All radios share
            `name="type"`, so the browser lets only one be chosen and sends its `value`. `key={t.value}` is the
            unique id React needs for list items. The card turns green when its radio is checked. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <label key={t.value} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-ink-600 has-[:checked]:border-emerald has-[:checked]:bg-emerald-50">
              <input type="radio" name="type" value={t.value} className="check" /> {t.label}
            </label>
          ))}
        </div>
        {fe.type && <p className="mt-1 text-xs text-red-600">{fe.type}</p>}
      </fieldset>
      {/* Name and email side by side on wider screens. `htmlFor` (JSX's name for HTML `for`) ties each label
          to its input's id. Email is `required` and `type="email"`, so the browser checks it looks like one. */}
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
      {/* Optional free text, four lines tall. */}
      <div>
        <label htmlFor="g-details" className="mb-1 block text-xs font-medium text-ink-600">Details (optional)</label>
        <textarea id="g-details" name="details" rows={4} className={input} placeholder="e.g. which data should be corrected" />
      </div>
      {/* Send button: disabled and showing a spinner while the server action runs. */}
      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-md bg-emerald px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Send request
      </button>
    </form>
  );
}
