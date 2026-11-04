"use client";

/**
 * FILE: apps/web/src/components/auth-form.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The account forms of the public website: log in, sign up (as a fund manager/visitor or as
 *   a service provider), "forgot your password" (asks for an email to send a reset link to) and "set a new
 *   password" (opened from that email link). Small helpers draw a labelled input, the submit button and the
 *   red error / green success messages.
 * WHERE IT RUNS: in the browser (`"use client"`), because the forms show a spinner while sending, keep the
 *   chosen account type, and redraw with errors. The actual checking of passwords and creating of accounts
 *   happens on the server, in the "server actions" imported from @/lib/auth/actions.
 * FRAMEWORK NOTES: A server action is a function marked `"use server"` that runs on the server but can be
 *   given to a form as `<form action={...}>`. React's `useActionState` hook wires this up: when the form is
 *   submitted, React sends the form fields (as `FormData`) to the server action, waits, and stores what the
 *   action returns as the new `state` (e.g. error messages), then redraws the form. It also gives a
 *   `pending` flag that is true while the request is in flight. The form even works before JavaScript loads.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - intersection types (`A & B`) to combine our own props with all standard <input> attributes.
 *   - generics (`useActionState<AuthFormState, FormData>`, `useState<AccountType>`).
 *   - rest/spread props (`...rest` collects leftover props, `{...rest}` passes them on).
 *   - `typeof UserRound`: "the same type as this value", here meaning "an icon component".
 *   - union of literals (`"login" | "signup"`), optional props (`next?:`), defaults (`= "visitor"`).
 *   - template strings, ternaries, `??`, `?.`, `!!` (turn any value into true/false).
 */

// `import { a } from "b"` pulls named things from a module. Plain names = npm libraries,
// `@fundhub/...` = our shared packages, `@/...` = this app's src folder.

// Next.js link component (page change without full reload).
import Link from "next/link";
// React hooks: useActionState runs a server action from a form (see header); useState remembers a value.
import { useActionState, useState } from "react";
// Icons: building (provider), tick (success), spinner (loading), person (visitor).
import { Building2, CheckCircle2, Loader2, UserRound } from "lucide-react";
// Type only: the allowed account types ("visitor" | "provider"), shared across the whole project.
import type { AccountType } from "@fundhub/core/enums";
// The minimum password length, shared so the browser hint and the server check always agree.
import { PASSWORD_MIN_LENGTH } from "@fundhub/core/password-rules";
// The server actions for each form, plus `AuthFormState`, the type of what they return
// (errors, a success message, and the values to refill the form with).
import { login, requestPasswordReset, resetPassword, signup, type AuthFormState } from "@/lib/auth/actions";
// Joins class names, skipping false/undefined ones.
import { cn } from "@/lib/cn";

/**
 * Kind: constant (string). Tailwind classes shared by every text input. `focus:` styles apply while the
 * box is active (green border and a soft green ring, `ring-emerald/20` = 20% opacity);
 * `aria-[invalid=true]:border-red-400` turns the border red when the input is marked invalid.
 */
const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

/**
 * Kind: React component. A label, a text input and, if there is one, its error message.
 * Props:
 *   label: string (the visible text), name: string (the form field name sent to the server, also used as
 *   the element id), error?: string (optional message to show under the box).
 *   `& React.InputHTMLAttributes<HTMLInputElement>` = it also accepts every normal <input> attribute
 *   (type, required, autoComplete, defaultValue, ...). `...rest` gathers all those extra ones.
 * Returns: JSX.
 */
function Field({ label, name, error, ...rest }: { label: string; name: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      {/* `htmlFor` (JSX's spelling of the HTML `for` attribute) ties the label to the input with that id,
          so clicking the label focuses the box. */}
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      {/* `aria-invalid={!!error}` = true when there is an error (drives the red border above).
          `{...rest}` spreads the remaining attributes onto the real <input>. */}
      <input id={name} name={name} className={inputClass} aria-invalid={!!error} {...rest} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Kind: React component. The full-width green submit button.
 * Props: pending: boolean (true while the server is working: disables the button and shows a spinner);
 *   children: `React.ReactNode` (the button text placed between <Submit> and </Submit>).
 * Returns: JSX.
 */
function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    // Disabled while pending, so the visitor cannot submit twice; `disabled:opacity-60` fades it.
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/**
 * Kind: React component. Shows the form-level error (red) and/or success message (green) from the state.
 * Props: state: AuthFormState, what the last server action returned.
 * Returns: JSX. `<>...</>` is a "fragment": it groups elements without adding an extra HTML tag.
 */
function Alerts({ state }: { state: AuthFormState }) {
  return (
    <>
      {/* `role="alert"` makes screen readers read the error out at once. */}
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {/* `role="status"` announces the success message politely. */}
      {state.ok && (
        <p role="status" className="flex gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {state.ok}
        </p>
      )}
    </>
  );
}

/**
 * Kind: constant. The two account types offered on the sign-up form, as data.
 * Its type is written inline: an array (`[]`) of objects with value (an AccountType), label, hint and
 * icon (`typeof UserRound` = "the type of the UserRound icon", i.e. any icon component).
 */
const ACCOUNT_OPTIONS: { value: AccountType; label: string; hint: string; icon: typeof UserRound }[] = [
  {
    value: "visitor",
    label: "Fund manager / visitor",
    hint: "Save providers, write verified reviews, follow the market",
    icon: UserRound,
  },
  {
    value: "provider",
    label: "Service provider",
    hint: "Manage your company profile and get private reports",
    icon: Building2,
  },
];

/**
 * Kind: React component (exported; used by the /account/login and /account/signup pages).
 * Props:
 *   mode: `"login" | "signup"`: which form to show.
 *   next?: string, optional: the page to return to after logging in (e.g. the page that asked for login).
 *   defaultType?: AccountType, default "visitor": which account type is pre-selected on sign-up.
 * Returns: JSX for the form.
 */
export function AuthForm({ mode, next, defaultType = "visitor" }: { mode: "login" | "signup"; next?: string; defaultType?: AccountType }) {
  // useActionState(action, initialState) returns three things, destructured here:
  //   state   = what the server action last returned (starts as `{}`, an empty object = no messages),
  //   action  = the function to give to <form action>,
  //   pending = true while the server action is running.
  // The `<AuthFormState, FormData>` generics say: the state has type AuthFormState, the input is FormData.
  // The ternary picks the login or the signup server action depending on `mode`.
  const [state, action, pending] = useActionState<AuthFormState, FormData>(mode === "login" ? login : signup, {});
  // Which account type is selected on the sign-up form.
  const [type, setType] = useState<AccountType>(defaultType);
  // Per-field error messages, or an empty object if there are none (`??`), so `fe.email` is always safe.
  const fe = state.fieldErrors ?? {};
  // Carry `next` over when switching between login and signup. `encodeURIComponent` makes the value safe
  // inside a URL (e.g. "/" becomes "%2F"). Empty string when there is no `next`.
  const nextQs = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    // `action={action}` hands the form to the server action via useActionState (see header).
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Alerts state={state} />
      {/* Hidden field: sends `next` to the server with the other fields so it can redirect afterwards. */}
      <input type="hidden" name="next" value={next ?? ""} />

      {/* Sign-up only: two big toggle buttons to choose the account type. */}
      {mode === "signup" && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-600">I am a…</legend>
          {/* The buttons are not real form inputs, so the chosen type is sent through this hidden field. */}
          <input type="hidden" name="accountType" value={type} />
          {/* `grid gap-2 sm:grid-cols-2` = stacked on phones, two columns from small-tablet width up. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {/* `type="button"` stops these buttons from submitting the form; clicking one just records the
                choice. `aria-pressed` tells screen readers which one is selected. */}
            {ACCOUNT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={type === o.value}
                onClick={() => setType(o.value)}
                className={cn(
                  "rounded-md border p-3 text-left transition-colors",
                  type === o.value ? "border-emerald bg-emerald-50" : "border-slate-200 hover:border-slate-300",
                )}
              >
                {/* `<o.icon />` draws the icon component stored in the option's `icon` field. */}
                <o.icon className={cn("h-4 w-4", type === o.value ? "text-emerald-700" : "text-slate-400")} />
                <span className="mt-1.5 block text-sm font-semibold text-ink">{o.label}</span>
                <span className="block text-[11px] leading-snug text-slate-500">{o.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* The text fields. `defaultValue={state.name}` refills what the visitor typed if the server sent the
          form back with errors; `error={fe.name}` shows that field's error; `required` = the browser blocks
          an empty submit. `autoComplete` hints help password managers fill the right values. */}
      {mode === "signup" && (
        <Field label="Your name" name="name" autoComplete="name" defaultValue={state.name} error={fe.name} required />
      )}
      <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state.email} error={fe.email} required />
      {/* Company field: only the label changes with the account type ("(optional)" for visitors). Note the
          box is not `required` for providers either, and the server also accepts it empty. */}
      {mode === "signup" && (
        <Field
          label={type === "provider" ? "Company" : "Company / fund (optional)"}
          name="company"
          autoComplete="organization"
          error={fe.company}
        />
      )}
      {/* Password: on sign-up the label states the minimum length and the browser enforces `minLength`;
          on login there is no minimum (`undefined` = attribute left off). The password itself is never
          sent back in `state`, so it is never refilled. */}
      <Field
        label={mode === "signup" ? `Password (min. ${PASSWORD_MIN_LENGTH} characters)` : "Password"}
        name="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
        error={fe.password}
        required
      />
      {/* Sign-up only: newsletter opt-in checkbox, unticked by default (consent must be active under GDPR). */}
      {mode === "signup" && (
        <label className="flex gap-2 text-xs text-ink-600">
          <input type="checkbox" name="newsletterOptIn" className="check mt-0.5 h-4 w-4 shrink-0" />
          Send me FundHub news and the quarterly market snapshot (unsubscribe anytime).
        </label>
      )}

      <Submit pending={pending}>{mode === "login" ? "Log in" : "Create account"}</Submit>

      {/* Link to the other form (login <-> signup), keeping the `next` query. Each branch of the ternary is a
          fragment `<>...</>` holding text plus a link. */}
      <p className="text-center text-xs text-ink-600">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href={`/account/signup${nextQs}`} className="font-medium text-emerald-700 hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already registered?{" "}
            <Link href={`/account/login${nextQs}`} className="font-medium text-emerald-700 hover:underline">
              Log in
            </Link>
          </>
        )}
      </p>
      {mode === "login" && (
        <p className="text-center text-xs">
          <Link href="/account/forgot" className="text-slate-500 hover:text-ink hover:underline">
            Forgot your password?
          </Link>
        </p>
      )}
    </form>
  );
}

/**
 * Kind: React component (exported; used by the /account/forgot page).
 * Props: none. Returns: JSX for a one-field form that asks the server to email a password-reset link.
 * The server answers with the same success message whether or not the email exists, so the form cannot be
 * used to discover who has an account.
 */
export function ForgotPasswordForm() {
  // Same useActionState pattern as above, wired to the `requestPasswordReset` server action.
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Alerts state={state} />
      {/* `state.fieldErrors?.email` = the email error if fieldErrors exists, else undefined (optional chaining). */}
      <Field label="Email" name="email" type="email" autoComplete="email" error={state.fieldErrors?.email} required />
      <Submit pending={pending}>Send reset link</Submit>
    </form>
  );
}

/**
 * Kind: React component (exported; used by the page opened from the reset email).
 * Props: token: string, the secret one-time code from the email link that proves the visitor received it.
 * Returns: JSX for a form to choose a new password.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  // Wired to the `resetPassword` server action.
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resetPassword, {});
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Alerts state={state} />
      {/* The token travels with the form as a hidden field so the server can check it. */}
      <input type="hidden" name="token" value={token} />
      <Field
        label={`New password (min. ${PASSWORD_MIN_LENGTH} characters)`}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        error={state.fieldErrors?.password}
        required
      />
      <Submit pending={pending}>Set new password</Submit>
    </form>
  );
}
