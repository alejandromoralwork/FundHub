"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert, Button, Card, Col, Form, Input, Row, Typography } from "antd";
import {
  changeOwnPassword,
  changeOwnTotp,
  requestStaffPasswordReset,
  resetStaffPassword,
  type AccountState,
} from "@/lib/account-actions";
import { Frame } from "./login-forms";

function Result({ state }: { state: AccountState }) {
  if (state.error) return <Alert type="error" message={state.error} showIcon style={{ marginBottom: 16 }} />;
  if (state.ok) return <Alert type="success" message={state.ok} showIcon style={{ marginBottom: 16 }} />;
  return null;
}

// ---------------------------------------------------------------- signed out

export function ForgotForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(requestStaffPasswordReset, {});
  return (
    <Frame title="Forgot your password?">
      <Typography.Paragraph type="secondary">Enter your work email and we&apos;ll send you a link to choose a new password.</Typography.Paragraph>
      <Result state={state} />
      <form action={action}>
        <Form layout="vertical" component="div">
          <Form.Item label="Work email" required>
            <Input name="email" type="email" autoComplete="username" required />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={pending} block>
            Send reset link
          </Button>
        </Form>
      </form>

      <Typography.Title level={5} id="2fa" style={{ marginTop: 28 }}>
        Lost your authenticator app?
      </Typography.Title>
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

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(resetStaffPassword, {});
  return (
    <Frame title="Choose a new password">
      <Result state={state} />
      <form action={action}>
        <input type="hidden" name="token" value={token} />
        <Form layout="vertical" component="div">
          <Form.Item label="New password" required extra="At least 10 characters.">
            <Input.Password name="password" autoComplete="new-password" required />
          </Form.Item>
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

export function AccountSecurity({ email, enrol }: { email: string; enrol: { secret: string; qrDataUrl: string } }) {
  const [pwState, pwAction, pwPending] = useActionState<AccountState, FormData>(changeOwnPassword, {});
  const [mfaState, mfaAction, mfaPending] = useActionState<AccountState, FormData>(changeOwnTotp, {});
  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Account security
        </Typography.Title>
        <Typography.Text type="secondary">{email}</Typography.Text>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="Change password">
          <Result state={pwState} />
          <form action={pwAction}>
            <input type="hidden" name="username" value={email} autoComplete="username" />
            <Form layout="vertical" component="div">
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qrDataUrl} alt="New authenticator QR code" width={160} height={160} style={{ display: "block", margin: "0 auto 8px" }} />
          <Typography.Paragraph copyable={{ text: enrol.secret }} type="secondary" style={{ textAlign: "center", fontSize: 12 }}>
            <span className="mono">{enrol.secret}</span>
          </Typography.Paragraph>
          <Result state={mfaState} />
          <form action={mfaAction}>
            <input type="hidden" name="secret" value={enrol.secret} />
            <Form layout="vertical" component="div">
              <Form.Item label="Your password" required>
                <Input.Password name="current" autoComplete="current-password" required />
              </Form.Item>
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
