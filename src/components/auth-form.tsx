"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { login, signup, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";

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

export function AuthForm({ mode, next }: { mode: "login" | "signup"; next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(mode === "login" ? login : signup, {});
  const fe = state.fieldErrors ?? {};
  const nextQs = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <input type="hidden" name="next" value={next ?? ""} />
      {mode === "signup" && (
        <Field label="Your name" name="name" autoComplete="name" defaultValue={state.name} error={fe.name} required />
      )}
      <Field label="Work email" name="email" type="email" autoComplete="email" defaultValue={state.email} error={fe.email} required />
      <Field
        label={mode === "signup" ? `Password (min. ${PASSWORD_MIN_LENGTH} characters)` : "Password"}
        name="password"
        type="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
        error={fe.password}
        required
      />
      <button
        type="submit"
        disabled={pending}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === "login" ? "Log in" : "Create provider account"}
      </button>
      <p className="text-center text-xs text-ink-600">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href={`/account/signup${nextQs}`} className="font-medium text-emerald-700 hover:underline">
              Create a provider account
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
        <p className="text-center text-[11px] text-slate-400">Forgot your password? Contact FundHub and we&apos;ll reset it.</p>
      )}
    </form>
  );
}
