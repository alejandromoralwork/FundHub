"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Building2, CheckCircle2, Loader2, UserRound } from "lucide-react";
import type { AccountType } from "@fundhub/core/enums";
import { PASSWORD_MIN_LENGTH } from "@fundhub/core/password-rules";
import { login, requestPasswordReset, resetPassword, signup, type AuthFormState } from "@/lib/auth/actions";
import { cn } from "@/lib/cn";

const inputClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/20 aria-[invalid=true]:border-red-400";

function Field({ label, name, error, ...rest }: { label: string; name: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </label>
      <input id={name} name={name} className={inputClass} aria-invalid={!!error} {...rest} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
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

function Alerts({ state }: { state: AuthFormState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="flex gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {state.ok}
        </p>
      )}
    </>
  );
}

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

export function AuthForm({ mode, next, defaultType = "visitor" }: { mode: "login" | "signup"; next?: string; defaultType?: AccountType }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(mode === "login" ? login : signup, {});
  const [type, setType] = useState<AccountType>(defaultType);
  const fe = state.fieldErrors ?? {};
  const nextQs = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Alerts state={state} />
      <input type="hidden" name="next" value={next ?? ""} />

      {mode === "signup" && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-600">I am a…</legend>
          <input type="hidden" name="accountType" value={type} />
          <div className="grid gap-2 sm:grid-cols-2">
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
                <o.icon className={cn("h-4 w-4", type === o.value ? "text-emerald-700" : "text-slate-400")} />
                <span className="mt-1.5 block text-sm font-semibold text-ink">{o.label}</span>
                <span className="block text-[11px] leading-snug text-slate-500">{o.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {mode === "signup" && (
        <Field label="Your name" name="name" autoComplete="name" defaultValue={state.name} error={fe.name} required />
      )}
      <Field label="Email" name="email" type="email" autoComplete="email" defaultValue={state.email} error={fe.email} required />
      {mode === "signup" && (
        <Field
          label={type === "provider" ? "Company" : "Company / fund (optional)"}
          name="company"
          autoComplete="organization"
          error={fe.company}
        />
      )}
      <Field
        label={mode === "signup" ? `Password (min. ${PASSWORD_MIN_LENGTH} characters)` : "Password"}
        name="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
        error={fe.password}
        required
      />
      {mode === "signup" && (
        <label className="flex gap-2 text-xs text-ink-600">
          <input type="checkbox" name="newsletterOptIn" className="check mt-0.5 h-4 w-4 shrink-0" />
          Send me FundHub news and the quarterly market snapshot (unsubscribe anytime).
        </label>
      )}

      <Submit pending={pending}>{mode === "login" ? "Log in" : "Create account"}</Submit>

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

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Alerts state={state} />
      <Field label="Email" name="email" type="email" autoComplete="email" error={state.fieldErrors?.email} required />
      <Submit pending={pending}>Send reset link</Submit>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(resetPassword, {});
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Alerts state={state} />
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
