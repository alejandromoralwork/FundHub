"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { staffLogin, staffMfa, type LoginState } from "@/lib/auth-actions";
import { Wordmark } from "./wordmark";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
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

/** Plain <form> + server action (works without JS); antd only styles the inputs. */
export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(staffLogin, {});
  return (
    <Frame title="Staff login">
      {state.error && <Alert type="error" message={state.error} showIcon style={{ marginBottom: 16 }} />}
      <form action={action}>
        <Form layout="vertical" component="div">
          <Form.Item label="Email" required>
            <Input name="email" type="email" autoComplete="username" required />
          </Form.Item>
          <Form.Item label="Password" required>
            <Input.Password name="password" autoComplete="current-password" required />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending} block>
            Continue
          </Button>
        </Form>
      </form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        Internal platform for FundHub staff. Website accounts can&apos;t log in here.
      </Typography.Paragraph>
    </Frame>
  );
}

export function MfaForm({ enrol }: { enrol?: { secret: string; qrDataUrl: string } }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(staffMfa, {});
  return (
    <Frame title={enrol ? "Set up two-factor authentication" : "Two-factor authentication"}>
      {enrol && (
        <>
          <Typography.Paragraph>
            Scan this QR code with an authenticator app (Google Authenticator, 1Password, Microsoft Authenticator…), then
            enter the 6-digit code. Two-factor is mandatory for all staff.
          </Typography.Paragraph>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qrDataUrl} alt="Authenticator QR code" width={180} height={180} style={{ display: "block", margin: "0 auto 8px" }} />
          <Typography.Paragraph copyable={{ text: enrol.secret }} type="secondary" style={{ textAlign: "center", fontSize: 12 }}>
            <span className="mono">{enrol.secret}</span>
          </Typography.Paragraph>
        </>
      )}
      {state.error && <Alert type="error" message={state.error} showIcon style={{ marginBottom: 16 }} />}
      <form action={action}>
        {enrol && <input type="hidden" name="secret" value={enrol.secret} />}
        <Form layout="vertical" component="div">
          <Form.Item label="6-digit code" required>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus required />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending} block>
            Verify
          </Button>
        </Form>
      </form>
    </Frame>
  );
}
