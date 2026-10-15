import { render } from "@react-email/components";
import { eq } from "drizzle-orm";
import { createElement, type ComponentType } from "react";
import { Resend } from "resend";
import { db } from "@fundhub/db/client";
import { emailMessages } from "@fundhub/db/schema";
import { TEMPLATES, type TemplateName, type TemplateProps } from "./templates";

export { TEMPLATES, type TemplateName, type TemplateProps };

export type SendOptions<T extends TemplateName> = {
  to: string;
  toName?: string;
  template: T;
  props: TemplateProps<T>;
  /** What the email is about, for the admin email log (e.g. "provider_claims", "12"). */
  related?: { entity: string; id: string | number };
  /** Staff user who sent it from the admin platform. */
  sentBy?: number;
};

export type SendResult = { ok: true; id: number } | { ok: false; id: number; error: string };

const fromAddress = () => process.env.EMAIL_FROM ?? "FundHub <hello@fundhub.lu>";

/**
 * Renders a template, logs it in `email_messages`, and sends it through Resend.
 * Without RESEND_API_KEY (local development) the email is printed to the console instead.
 */
export async function sendEmail<T extends TemplateName>(opts: SendOptions<T>): Promise<SendResult> {
  const def = TEMPLATES[opts.template];
  const subject = (def.subject as (p: TemplateProps<T>) => string)(opts.props);
  // Template unions don't narrow through generics; the public signature keeps callers type-safe.
  const Component = def.component as unknown as ComponentType<Record<string, unknown>>;
  const html = await render(createElement(Component, opts.props as Record<string, unknown>));

  const [row] = await db
    .insert(emailMessages)
    .values({
      toEmail: opts.to,
      toName: opts.toName,
      subject,
      template: opts.template,
      payload: opts.props as Record<string, unknown>,
      relatedEntity: opts.related?.entity,
      relatedId: opts.related ? String(opts.related.id) : null,
      sentBy: opts.sentBy,
    })
    .returning({ id: emailMessages.id });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email:console] to=${opts.to} subject="${subject}"\n${JSON.stringify(opts.props, null, 2)}`);
    await db.update(emailMessages).set({ status: "sent", providerMessageId: "console" }).where(eq(emailMessages.id, row.id));
    return { ok: true, id: row.id };
  }

  const { data, error } = await new Resend(key).emails.send({
    from: fromAddress(),
    to: opts.toName ? `${opts.toName} <${opts.to}>` : opts.to,
    subject,
    html,
  });
  if (error || !data) {
    const message = error?.message ?? "Unknown Resend error";
    await db.update(emailMessages).set({ status: "failed", error: message }).where(eq(emailMessages.id, row.id));
    return { ok: false, id: row.id, error: message };
  }
  await db.update(emailMessages).set({ status: "sent", providerMessageId: data.id }).where(eq(emailMessages.id, row.id));
  return { ok: true, id: row.id };
}
