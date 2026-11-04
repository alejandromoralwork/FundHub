"use client";

/**
 * FILE: apps/admin/src/components/login-forms.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's sign-in screens. `LoginForm` asks a staff member for email + password;
 *   `MfaForm` then asks for the 6-digit two-factor (2FA) code, and the first time also shows a QR code to set
 *   up an authenticator app. `Frame` is the shared centred card both screens sit in.
 * WHERE IT RUNS: in the browser ("use client"), because it uses the React hook `useActionState`. The actual
 *   password and code checks happen on the server, in the server actions `staffLogin` and `staffMfa`.
 * FRAMEWORK NOTES:
 *   - A plain HTML `<form action={serverAction}>` sends the form fields (as `FormData`) to a Next.js server
 *     action. This works even before the page's JavaScript has loaded ("progressive enhancement").
 *   - `useActionState(action, initialState)` is a React hook for such forms. It returns
 *     `[state, formAction, pending]`: the latest result the action returned (e.g. `{ error: "Wrong password" }`),
 *     a wrapped action to give to `<form action>`, and `true` while the server is working.
 *   - antd's `Form` is used here only for layout and styling (`component="div"` stops it drawing its own
 *     <form>), so the real submission goes through the plain <form> around it.
 *   - Next.js `Link` is a link that changes page without a full browser reload.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - inline prop types (`{ title: string; children: React.ReactNode }`), optional props `?`, default values.
 *   - generics `useActionState<LoginState, FormData>` = "state is LoginState, the action receives FormData".
 *   - `type LoginState` inside an import = import only a type (it disappears from the compiled JavaScript).
 *   - `&&` to show something conditionally, ternary `c ? x : y`, `!` (not).
 */

// `import { a } from "b"` brings named things from another module; `import X from "b"` takes its default export.
// Next.js' client-side link component.
import Link from "next/link";
// React hook that connects a <form> to a server action and keeps its returned state.
import { useActionState } from "react";
// Ant Design components for the card, banners, inputs and buttons.
import { Alert, Button, Card, Form, Input, Typography } from "antd";
// Server actions that check the password and the 2FA code, plus the type of what they return.
// `@/…` = this app's src folder.
import { staffLogin, staffMfa, type LoginState } from "@/lib/auth-actions";
// The FundHub text logo shown at the top of the card.
import { Wordmark } from "./wordmark";

/**
 * Kind: React component (exported so other auth pages, e.g. "forgot password", can reuse the same frame).
 * @param title     type `string` — heading shown under the logo.
 * @param children  type `React.ReactNode` — the form or text placed inside the frame.
 * @returns JSX: a full-height page with a centred, max 400px wide card containing logo, heading and children.
 */
export function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  // CSS grid with `placeItems: "center"` centres the card both horizontally and vertically.
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <Card style={{ width: "100%", maxWidth: 400 }}>
        <Wordmark />
        <Typography.Title level={4} style={{ marginTop: 20 }}>
          {title}
        </Typography.Title>
        {children}
      </Card>
    </div>
  );
}

/**
 * Kind: React component.
 * Plain <form> + server action (works without JS); antd only styles the inputs.
 * @param resetDone  type `boolean`, optional, default `false` — `true` when the user just reset their password,
 *                   so a green "Password changed" banner is shown.
 * @returns JSX: the email/password form inside a Frame. On success the server action redirects onwards
 *          (to the 2FA step); on failure it returns `{ error }`, which is shown in a red banner.
 */
export function LoginForm({ resetDone = false }: { resetDone?: boolean }) {
  // `state` starts as `{}` (the second argument) and becomes whatever `staffLogin` returns.
  const [state, action, pending] = useActionState<LoginState, FormData>(staffLogin, {});
  return (
    <Frame title="Staff login">
      {/* Show the "password changed" banner only if a reset just happened and there is no new error. */}
      {resetDone && !state.error && (
        <Alert type="success" message="Password changed. Log in with your new password." showIcon style={{ marginBottom: 16 }} />
      )}
      {state.error && <Alert type="error" message={state.error} showIcon style={{ marginBottom: 16 }} />}
      {/* Submitting sends the inputs' `name`d values (email, password) to the server action. */}
      <form action={action}>
        <Form layout="vertical" component="div">
          {/* `autoComplete` hints let password managers fill these fields correctly. */}
          <Form.Item label="Email" required>
            <Input name="email" type="email" autoComplete="username" required />
          </Form.Item>
          <Form.Item label="Password" required>
            <Input.Password name="password" autoComplete="current-password" required />
          </Form.Item>
          {/* `htmlType="submit"` makes this a real submit button; `loading` shows a spinner while pending. */}
          <Button type="primary" htmlType="submit" loading={pending} block>
            Continue
          </Button>
        </Form>
      </form>
      <div style={{ marginTop: 12, textAlign: "center" }}>
        <Link href="/login/forgot" style={{ fontSize: 13 }}>
          Forgot your password or lost your 2FA?
        </Link>
      </div>
      {/* `&apos;` is the HTML code for an apostrophe (JSX text should not contain a raw ' in this project). */}
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        Internal platform for FundHub staff. Website accounts can&apos;t log in here.
      </Typography.Paragraph>
    </Frame>
  );
}

/**
 * Kind: React component.
 * The second login step: enter the 6-digit code from an authenticator app.
 * @param enrol  optional object `{ secret: string; qrDataUrl: string }`. Present only when the staff member has
 *               not set up 2FA yet: `secret` is the new 2FA key and `qrDataUrl` a QR-code image of it (as a
 *               "data:" URL, i.e. the image itself encoded as text). When missing, the user already has 2FA.
 * @returns JSX: the code form (plus the QR code when enrolling) inside a Frame.
 * Why: two-factor authentication is mandatory for every staff account.
 */
export function MfaForm({ enrol }: { enrol?: { secret: string; qrDataUrl: string } }) {
  // Same pattern as LoginForm, but connected to the `staffMfa` server action.
  const [state, action, pending] = useActionState<LoginState, FormData>(staffMfa, {});
  return (
    <Frame title={enrol ? "Set up two-factor authentication" : "Two-factor authentication"}>
      {/* Set-up instructions, QR code and the secret in text form, shown only while enrolling.
          `<>…</>` is a React "fragment": groups several elements without adding an extra HTML element. */}
      {enrol && (
        <>
          <Typography.Paragraph>
            Scan this QR code with an authenticator app (Google Authenticator, 1Password, Microsoft Authenticator…), then
            enter the 6-digit code. Two-factor is mandatory for all staff.
          </Typography.Paragraph>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qrDataUrl} alt="Authenticator QR code" width={180} height={180} style={{ display: "block", margin: "0 auto 8px" }} />
          {/* `copyable` adds a copy-to-clipboard icon, for people who type the secret in by hand. */}
          <Typography.Paragraph copyable={{ text: enrol.secret }} type="secondary" style={{ textAlign: "center", fontSize: 12 }}>
            <span className="mono">{enrol.secret}</span>
          </Typography.Paragraph>
        </>
      )}
      {state.error && <Alert type="error" message={state.error} showIcon style={{ marginBottom: 16 }} />}
      <form action={action}>
        {/* While enrolling, the secret travels back to the server in a hidden field so it can be saved once the
            first code proves the app was set up correctly. */}
        {enrol && <input type="hidden" name="secret" value={enrol.secret} />}
        <Form layout="vertical" component="div">
          {/* `inputMode="numeric"` shows a number keypad on phones; `one-time-code` lets phones autofill codes.
              maxLength 7 allows a code typed as "123 456". */}
          <Form.Item label="6-digit code" required>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus required />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending} block>
            Verify
          </Button>
        </Form>
      </form>
      {/* Recovery link for users who already have 2FA but lost their phone/app. */}
      {!enrol && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Link href="/login/forgot#2fa" style={{ fontSize: 13 }}>
            Lost access to your authenticator app?
          </Link>
        </div>
      )}
    </Frame>
  );
}
