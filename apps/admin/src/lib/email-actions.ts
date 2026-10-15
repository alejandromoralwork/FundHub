"use server";

import { and, eq, exists, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RFI_STATUSES } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { providerClaims, rfiRequests, users } from "@fundhub/db/schema";
import { sendEmail } from "@fundhub/email/send";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { createLead, crmConfigured } from "./crm";
import { SEGMENTS, type Segment } from "./segments";

export type ActionResult = { ok?: string; error?: string };

async function recipients(segment: Segment) {
  const base = db.select({ email: users.email, name: users.name }).from(users);
  switch (segment) {
    case "newsletter":
      return base.where(eq(users.newsletterOptIn, true));
    case "providers":
      return base.where(eq(users.accountType, "provider"));
    case "visitors_service":
      return base.where(eq(users.accountType, "visitor"));
    case "approved_providers":
      return base.where(
        exists(
          db
            .select({ one: sql`1` })
            .from(providerClaims)
            .where(and(eq(providerClaims.userId, users.id), eq(providerClaims.status, "approved"))),
        ),
      );
  }
}

export async function countSegment(segment: Segment): Promise<number> {
  await requireStaff(CAN.email);
  return (await recipients(segment)).length;
}

const composeSchema = z.object({
  mode: z.enum(["single", "segment"]),
  to: z.string().trim().optional(),
  toName: z.string().trim().optional(),
  segment: z.enum(Object.keys(SEGMENTS) as [Segment, ...Segment[]]).optional(),
  subject: z.string().trim().min(3, "Add a subject").max(200),
  body: z.string().trim().min(10, "Write a message").max(20_000),
  ctaLabel: z.string().trim().max(60).optional(),
  ctaUrl: z.string().trim().url().optional().or(z.literal("")),
});

const MAX_BULK = 2000;

export async function composeEmail(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  let list: { email: string; name: string | null }[];
  if (d.mode === "single") {
    const email = z.string().email().safeParse(d.to);
    if (!email.success) return { error: "Enter a valid recipient email" };
    list = [{ email: email.data, name: d.toName || null }];
  } else {
    if (!d.segment) return { error: "Choose a segment" };
    list = await recipients(d.segment);
    if (!list.length) return { error: "That segment has no recipients." };
    if (list.length > MAX_BULK) return { error: `Segment has ${list.length} recipients; the limit per send is ${MAX_BULK}.` };
  }

  let sent = 0;
  const failed: string[] = [];
  // Sequential with a small pause: stays well under Resend's rate limit.
  for (const r of list) {
    const res = await sendEmail({
      to: r.email,
      toName: r.name ?? undefined,
      template: "message",
      props: { subject: d.subject, name: r.name ?? undefined, body: d.body, ctaLabel: d.ctaLabel || undefined, ctaUrl: d.ctaUrl || undefined },
      related: d.mode === "segment" ? { entity: "segment", id: d.segment! } : undefined,
      sentBy: staff.id,
    });
    if (res.ok) sent++;
    else failed.push(r.email);
    if (list.length > 1) await new Promise((ok) => setTimeout(ok, 120));
  }
  await audit(staff, "send-email", "email_messages", null, { mode: d.mode, segment: d.segment, subject: d.subject, sent, failed: failed.length });
  revalidatePath("/email");
  return failed.length ? { error: `Sent ${sent}, failed ${failed.length}: ${failed.slice(0, 5).join(", ")}` } : { ok: `Sent ${sent} email(s).` };
}

// ---------------------------------------------------------------- inbox

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(RFI_STATUSES).optional(),
  assignToMe: z.boolean().optional(),
  internalNotes: z.string().max(10_000).optional(),
});

export async function updateRequest(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { id, status, assignToMe, internalNotes } = parsed.data;
  const set: Partial<typeof rfiRequests.$inferInsert> = {};
  if (status) set.status = status;
  if (assignToMe) set.assignedTo = staff.id;
  if (internalNotes !== undefined) set.internalNotes = internalNotes;
  await db.update(rfiRequests).set(set).where(eq(rfiRequests.id, id));
  await audit(staff, "update", "rfi_requests", id, set);
  revalidatePath("/requests");
  return { ok: "Saved." };
}

export async function replyToRequest(input: { id: number; subject: string; body: string }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  const [req] = await db.select().from(rfiRequests).where(eq(rfiRequests.id, input.id));
  if (!req) return { error: "Request not found" };
  if (input.body.trim().length < 5) return { error: "Write a reply" };
  const res = await sendEmail({
    to: req.email,
    toName: req.contactName,
    template: "message",
    props: { subject: input.subject, name: req.contactName, body: input.body },
    related: { entity: "rfi_requests", id: req.id },
    sentBy: staff.id,
  });
  if (!res.ok) return { error: res.error };
  if (req.status === "open") await db.update(rfiRequests).set({ status: "responded", assignedTo: req.assignedTo ?? staff.id }).where(eq(rfiRequests.id, req.id));
  await audit(staff, "reply", "rfi_requests", req.id, { subject: input.subject });
  revalidatePath("/requests");
  return { ok: `Reply sent to ${req.email}.` };
}

/** Creates the contact and an opportunity in the CRM (Twenty) for an inbox request. */
export async function sendToCrm(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  if (!crmConfigured()) return { error: "The CRM isn't connected yet (TWENTY_URL and TWENTY_API_KEY)." };
  const [req] = await db.select().from(rfiRequests).where(eq(rfiRequests.id, id));
  if (!req) return { error: "Request not found" };
  if (req.crmRef) return { ok: "Already in the CRM." };
  try {
    const label = { rfi: "Quote request", advisory: "Advisory", data: "Data services", awards: "Awards", claim: "Provider" }[req.requestType];
    const { opportunityId } = await createLead({
      name: req.contactName,
      email: req.email,
      company: req.company,
      title: `${label}: ${req.company}`,
    });
    await db.update(rfiRequests).set({ crmRef: opportunityId ?? "created" }).where(eq(rfiRequests.id, id));
    await audit(staff, "crm-sync", "rfi_requests", id, { opportunityId });
    revalidatePath("/requests");
    return { ok: "Contact and opportunity created in the CRM." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "CRM sync failed" };
  }
}
