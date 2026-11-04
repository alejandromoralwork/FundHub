"use client";
/**
 * FILE: apps/admin/src/components/account-forms.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The forms a staff member uses to look after their own login: "forgot password" (asks for a
 *   reset email), "choose a new password" (opened from the link in that email), and, once signed in, the
 *   "Account security" page (change password, move two-factor codes to a new authenticator app).
 * WHERE IT RUNS: in the browser. The `"use client"` line above tells Next.js to send this file to the browser,
 *   because it uses React hooks (`useActionState`) that react to clicks and typing. The actual work (checking
 *   passwords, sending email, writing to the database) happens on the server inside "server actions" that
 *   these forms call.
 * FRAMEWORK NOTES:
 *   - A React component is a function whose name starts with a capital letter and which returns JSX: the
 *     HTML-like markup (`<Card>…</Card>`) that React turns into real page elements.
 *   - Ant Design ("antd") is a library of ready-made UI pieces: `Card`, `Form`, `Input`, `Button`, `Alert`…
 *   - A "server action" is a function marked `"use server"` that lives on the server. When a plain HTML
 *     `<form action={someAction}>` is submitted, React sends the form fields to that function over the network
 *     and gives back whatever it returns. No hand-written API calls are needed.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - inline object types for props, e.g. `{ token: string }` = "an object with a text field called token";
 *   - destructuring in parameters `({ state }: …)` = "pull the `state` field out of the object passed in";
 *   - generics `useActionState<AccountState, FormData>` = telling a function which types it works with;
 *   - array destructuring `const [a, b, c] = …` = name the items of a returned array;
 *   - `import { type X }` = import only a type (it disappears when compiled to JavaScript).
 */

// `import { a } from "b"` loads the named thing `a` from module `b` so this file can use it.
// Plain names ("next/link", "react", "antd") are libraries installed from npm; `@/…` is this app's own
// src folder; `./…` is a file in the same folder as this one.

// `Link` is Next.js's link component: like an HTML <a>, but it changes page without a full reload.
import Link from "next/link";
// `useActionState` is a React hook that wires a form to a server action and remembers its last result.
import { useActionState } from "react";
// Ready-made Ant Design UI pieces used below (alert boxes, buttons, cards, grid columns/rows, form layout,
// text inputs, and typography: titles and paragraphs).
import { Alert, Button, Card, Col, Form, Input, Row, Typography } from "antd";
// The server actions these forms submit to, plus `AccountState`: the type of the result they send back
// (an object that may contain an `error` message or an `ok` message).
import {
  changeOwnPassword,
  changeOwnTotp,
  requestStaffPasswordReset,
  resetStaffPassword,
  type AccountState,
} from "@/lib/account-actions";
// `Frame` is the centred box with the Console logo used by the login pages; reused here for the same look.
import { Frame } from "./login-forms";

/**
 * Kind: React component (private to this file, because it is not `export`ed).
 * Shows the outcome of the last form submission as a red (error) or green (success) banner.
 * @param state  type `AccountState` — the object returned by a server action; `{ state }` destructures it
 *               from the props object, and `{ state: AccountState }` is the props' inline type.
 * @returns      JSX for an antd `Alert`, or `null` (React's "render nothing") when there is no message yet.
 */
function Result({ state }: { state: AccountState }) {
  // If the server action reported an error, show it in a red alert box. `showIcon` adds the warning icon;
  // `style={{ … }}` sets inline CSS: the outer braces mean "JavaScript value here", the inner ones are an object.
  if (state.error) return <Alert type="error" message={state.error} showIcon style={{ marginBottom: 16 }} />;
  // Otherwise, if it reported success, show a green alert box.
  if (state.ok) return <Alert type="success" message={state.ok} showIcon style={{ marginBottom: 16 }} />;
  // Nothing to report (e.g. the form has not been submitted yet): render nothing.
  return null;
}

// ---------------------------------------------------------------- signed out

/**
 * Kind: React component (exported, so pages can use it).
 * The "Forgot your password?" page: the staff member types their work email and the server emails them a
 * reset link. It also explains that a lost authenticator app cannot be reset by email (an owner must do it).
 * @returns JSX for the whole form inside the login `Frame`.
 */
export function ForgotForm() {
  // `useActionState(serverAction, initialState)` returns three things, unpacked by array destructuring:
  //   `state`   = the latest result returned by the action (starts as `{}`: no error, no ok message);
  //   `action`  = a wrapped version of the action to give to `<form action={…}>`;
  //   `pending` = `true` while the request is on its way to the server (used to show a spinner).
  // `<AccountState, FormData>` are generics: the state type, and the type of what the form sends (FormData,
  // the browser's bundle of form fields).
  const [state, action, pending] = useActionState<AccountState, FormData>(requestStaffPasswordReset, {});
  return (
    <Frame title="Forgot your password?">
      {/* `type="secondary"` makes antd draw the text in grey. `&apos;` is how JSX writes an apostrophe. */}
      <Typography.Paragraph type="secondary">Enter your work email and we&apos;ll send you a link to choose a new password.</Typography.Paragraph>
      {/* The red/green result banner from the component above. */}
      <Result state={state} />
      {/* A plain HTML form whose `action` is the server action: submitting sends the fields to the server. */}
      <form action={action}>
        {/* antd `Form` is used only for its tidy vertical layout; `component="div"` stops it drawing a second
            <form> tag (forms cannot be nested), so the real submission is handled by the <form> above. */}
        <Form layout="vertical" component="div">
          {/* `Form.Item` draws a label above its field; `required` adds the red asterisk. */}
          <Form.Item label="Work email" required>
            {/* `name="email"` is the key the server action reads from FormData. `autoComplete="username"`
                helps password managers. `required` makes the browser refuse an empty submission. */}
            <Input name="email" type="email" autoComplete="username" required />
          </Form.Item>
          {/* `htmlType="submit"` makes this a real submit button; `loading={pending}` shows a spinner while
              waiting; `block` stretches it to full width. */}
          <Button type="primary" htmlType="submit" loading={pending} block>
            Send reset link
          </Button>
        </Form>
      </form>

      {/* `id="2fa"` lets other pages link straight to this section with "#2fa" in the URL. */}
      <Typography.Title level={5} id="2fa" style={{ marginTop: 28 }}>
        Lost your authenticator app?
      </Typography.Title>
      {/* Security rule: two-factor can only be reset by an owner, never by email. `{" "}` inserts a space
          that JSX would otherwise drop at the line break. */}
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        For security, two-factor can&apos;t be reset by email. Ask an owner to open <strong>Staff</strong> and click{" "}
        <strong>Reset 2FA</strong> next to your name. At your next login you&apos;ll scan a new QR code.
      </Typography.Paragraph>
      <Link href="/login" style={{ fontSize: 13 }}>
        ← Back to login
      </Link>
    </Frame>
  );
}

/**
 * Kind: React component.
 * The "Choose a new password" page, opened from the link in the reset email.
 * @param token  type `string` — the secret one-time code from the email link; the server checks it to prove
 *               the person really received the email.
 * @returns      JSX for the new-password form.
 */
export function ResetForm({ token }: { token: string }) {
  // Same pattern as above: connect the form to the `resetStaffPassword` server action.
  const [state, action, pending] = useActionState<AccountState, FormData>(resetStaffPassword, {});
  return (
    <Frame title="Choose a new password">
      <Result state={state} />
      <form action={action}>
        {/* A hidden field: invisible to the user but sent with the form, so the server receives the token. */}
        <input type="hidden" name="token" value={token} />
        <Form layout="vertical" component="div">
          {/* `extra` shows a small hint under the field. `Input.Password` hides the typing behind dots and
              adds an eye icon to reveal it. The 10-character rule is enforced on the server. */}
          <Form.Item label="New password" required extra="At least 10 characters.">
            <Input.Password name="password" autoComplete="new-password" required />
          </Form.Item>
          {/* Typed twice; the server action checks both match. */}
          <Form.Item label="Repeat the new password" required>
            <Input.Password name="confirm" autoComplete="new-password" required />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending} block>
            Save new password
          </Button>
        </Form>
      </form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        You&apos;ll still need your two-factor code to log in.
      </Typography.Paragraph>
    </Frame>
  );
}

// ---------------------------------------------------------------- signed in

/**
 * Kind: React component.
 * The signed-in "Account security" page with two cards: change password, and move two-factor (TOTP: the
 * 6-digit codes from an authenticator app) to a new phone or app.
 * @param email   type `string` — the signed-in staff member's email, shown under the title.
 * @param enrol   type `{ secret: string; qrDataUrl: string }` — a freshly generated two-factor secret made by
 *                the server, and the same secret drawn as a QR code image (a "data URL" is an image stored
 *                inside a text string, so no separate file is needed).
 * @returns       JSX for the page layout.
 */
export function AccountSecurity({ email, enrol }: { email: string; enrol: { secret: string; qrDataUrl: string } }) {
  // Two independent forms on one page, so two `useActionState` hooks, each with its own result and spinner.
  const [pwState, pwAction, pwPending] = useActionState<AccountState, FormData>(changeOwnPassword, {});
  const [mfaState, mfaAction, mfaPending] = useActionState<AccountState, FormData>(changeOwnTotp, {});
  return (
    // antd's grid: a `Row` holds `Col`umns. The row is 24 units wide. `gutter={[16, 16]}` = 16px gaps
    // horizontally and vertically.
    <Row gutter={[16, 16]}>
      {/* `span={24}` = full width: the page title and the email under it. */}
      <Col span={24}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Account security
        </Typography.Title>
        {/* `{email}` inserts the value of the JavaScript variable into the markup. */}
        <Typography.Text type="secondary">{email}</Typography.Text>
      </Col>
      {/* Responsive widths: `xs={24}` full width on phones, `lg={12}` half width on large screens. */}
      <Col xs={24} lg={12}>
        <Card title="Change password">
          <Result state={pwState} />
          <form action={pwAction}>
            {/* Hidden username field: not used by the server, it just helps password managers know which
                account the new password belongs to. */}
            <input type="hidden" name="username" value={email} autoComplete="username" />
            <Form layout="vertical" component="div">
              {/* The current password is required so someone at an unlocked computer cannot change it. */}
              <Form.Item label="Current password" required>
                <Input.Password name="current" autoComplete="current-password" required />
              </Form.Item>
              <Form.Item label="New password" required extra="At least 10 characters.">
                <Input.Password name="password" autoComplete="new-password" required />
              </Form.Item>
              <Form.Item label="Repeat the new password" required>
                <Input.Password name="confirm" autoComplete="new-password" required />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={pwPending}>
                Change password
              </Button>
            </Form>
          </form>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="Move two-factor to a new app">
          <Typography.Paragraph type="secondary">
            New phone or authenticator app? Scan this code with the new app, then confirm with your password and the code it
            shows. The old app stops working.
          </Typography.Paragraph>
          {/* The next comment is an instruction to ESLint (the code-style checker): it would normally prefer
              Next.js's <Image>, but a plain <img> is fine for an inline QR data URL. It must stay directly
              above the <img>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qrDataUrl} alt="New authenticator QR code" width={160} height={160} style={{ display: "block", margin: "0 auto 8px" }} />
          {/* The secret as text, for apps that cannot scan. `copyable` adds antd's copy-to-clipboard icon;
              `className="mono"` applies a fixed-width font defined in the Console's CSS. */}
          <Typography.Paragraph copyable={{ text: enrol.secret }} type="secondary" style={{ textAlign: "center", fontSize: 12 }}>
            <span className="mono">{enrol.secret}</span>
          </Typography.Paragraph>
          <Result state={mfaState} />
          <form action={mfaAction}>
            {/* The new secret goes back to the server, which only saves it once the code below proves the
                new app was set up correctly. */}
            <input type="hidden" name="secret" value={enrol.secret} />
            <Form layout="vertical" component="div">
              <Form.Item label="Your password" required>
                <Input.Password name="current" autoComplete="current-password" required />
              </Form.Item>
              {/* `inputMode="numeric"` shows a number keypad on phones; `autoComplete="one-time-code"` lets
                  phones auto-fill the code; `maxLength={7}` allows "123 456" with a space. */}
              <Form.Item label="6-digit code from the new app" required>
                <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={mfaPending}>
                Switch to the new app
              </Button>
            </Form>
          </form>
        </Card>
      </Col>
    </Row>
  );
}
