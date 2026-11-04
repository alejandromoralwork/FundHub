"use client";
/**
 * FILE: apps/web/src/components/newsletter-form.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The small "Your work email + Subscribe" form (shown in the footer). It sends the email to the
 *   server, shows an error under the form if something is wrong, and replaces itself with a thank-you message
 *   once the subscription worked.
 * WHERE IT RUNS: in the browser ("use client" on the first line makes it a client component, because it keeps
 *   state between clicks). The actual subscribing happens on the server in the `subscribe` server action.
 * FRAMEWORK NOTES:
 *   - A "server action" is a function in a file marked "use server" (here src/lib/newsletter.ts). The browser
 *     can call it through a <form action={…}>; Next.js sends the form data to the server and runs it there.
 *   - `useActionState` is a React hook that wires a form to such an action and remembers the last result
 *     ("state") so the component can show it.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generics `useActionState<NewsletterState, FormData>(…)` = telling a function which types it works with.
 *   - array destructuring `const [a, b, c] = …` = name the items of a returned list.
 *   - `import { type X }` = import only a type.
 */

// `import { a } from "b"` brings named things from another file or library into this one.
// `react` (from npm) provides the `useActionState` hook.
import { useActionState } from "react";
// From this app's src/lib/newsletter.ts: `subscribe` (the server action) and `NewsletterState`, the type of
// its result: `{ ok?: string; error?: string }` — a success message or an error message.
import { subscribe, type NewsletterState } from "@/lib/newsletter";

/**
 * Kind: React component (client component). Takes no props.
 * Returns: JSX — either the success message or the form.
 */
export function NewsletterForm() {
  // `useActionState(action, initialState)` returns three things, which we name by array destructuring:
  //   - state:   the latest result from `subscribe` (starts as `{}`, the empty initial state given here).
  //   - action:  a wrapped version of `subscribe` to pass to the <form>.
  //   - pending: `true` while the server is still working, so we can disable the button.
  // `<NewsletterState, FormData>` = the state type and the type of what the form sends (browser form data).
  const [state, action, pending] = useActionState<NewsletterState, FormData>(subscribe, {});
  // Early return: once the server reported success, show only the green thank-you text instead of the form.
  if (state.ok) return <p className="text-xs font-medium text-emerald-700">{state.ok}</p>;
  return (
    // `action={action}` makes submitting the form call the server action with the form's fields.
    // `flex max-w-sm gap-2` = lay the input and button side by side, at most "small" width, small gap.
    <form action={action} className="flex max-w-sm gap-2">
      {/* Honeypot spam trap: a hidden "website" field humans never see or fill in (`hidden`, skipped by Tab
          with tabIndex={-1}, ignored by screen readers with aria-hidden). Spam bots fill every field, so if
          it arrives filled, the server quietly pretends success and does nothing. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {/* The email field. `type="email"` + `required` let the browser check the format and that it is not
          empty before sending. `name="email"` is the key the server reads with formData.get("email").
          `min-w-0 flex-1` = take the remaining width but allow shrinking; `focus:` classes apply while typing. */}
      <input
        type="email"
        name="email"
        required
        aria-label="Email for the newsletter"
        placeholder="Your work email"
        className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs focus:border-emerald focus:outline-none"
      />
      {/* Submit button, disabled while `pending` to stop double submissions. `disabled:opacity-60` fades it
          then; `hover:` changes the colour when the mouse is over it. */}
      <button type="submit" disabled={pending} className="rounded-md bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60">
        Subscribe
      </button>
      {/* If the server returned an error message, show it in red. `a && b` renders b only when a has a value. */}
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
