"use server";

import { z } from "zod";
import { COMPANY } from "@fundhub/core/company";
import { GDPR_REQUEST_TYPES } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
import { gdprRequests } from "@fundhub/db/schema";
import { sendEmail } from "@fundhub/email/send";
import { clientIp } from "./client-ip";

export type GdprState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };

const schema = z.object({
  name: z.string().trim().max(120).default(""),
  email: z.string().trim().toLowerCase().email("Enter the email address the request is about"),
  type: z.enum(GDPR_REQUEST_TYPES, { message: "Choose a request type" }),
  details: z.string().trim().max(4000).default(""),
});

const TYPE_LABEL: Record<(typeof GDPR_REQUEST_TYPES)[number], string> = {
  access: "a copy of your data",
  deletion: "deletion of your data",
  rectification: "correction of your data",
  objection: "objection to processing",
};

export async function submitGdprRequest(_prev: GdprState, formData: FormData): Promise<GdprState> {
  if (formData.get("website")) return { ok: "Request received." }; // honeypot
  if (!(await rateLimit(`gdpr:${await clientIp()}`, 5, 60 * 60))) return { error: "Too many requests. Please try again later." };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const d = parsed.data;
  // GDPR Art. 12(3): answer within one month.
  const dueAt = new Date();
  dueAt.setMonth(dueAt.getMonth() + 1);
  const [row] = await db.insert(gdprRequests).values({ ...d, dueAt }).returning({ id: gdprRequests.id });
  await sendEmail({
    to: d.email,
    toName: d.name || undefined,
    template: "message",
    props: {
      subject: `Your data request (ref. GDPR-${row.id})`,
      name: d.name || undefined,
      body: `We received your request for ${TYPE_LABEL[d.type]} (reference GDPR-${row.id}).\n\nTo protect your data, we will first confirm that this email address belongs to you, then answer within one month, by ${dueAt.toLocaleDateString("en-GB")}.\n\nIf you did not make this request, reply to ${COMPANY.privacyEmail}.`,
    },
    related: { entity: "gdpr_requests", id: row.id },
  });
  return { ok: `Request received (reference GDPR-${row.id}). We've sent a confirmation to ${d.email} and will answer within one month.` };
}
