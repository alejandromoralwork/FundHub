"use server";

import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { GDPR_REQUEST_STATUSES } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import {
  billingCustomers,
  emailMessages,
  gdprRequests,
  profileEdits,
  providerClaims,
  reviews,
  rfiRequests,
  savedProviders,
  users,
} from "@fundhub/db/schema";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

export type ActionResult = { ok?: string; error?: string };

/** Everything FundHub's database holds about an email address (GDPR Art. 15 / 20). */
export async function exportPersonalData(email: string): Promise<string> {
  const staff = await requireStaff(CAN.gdpr);
  const e = email.trim().toLowerCase();
  const [account] = await db
    .select({ id: users.id, email: users.email, name: users.name, company: users.company, accountType: users.accountType, newsletterOptIn: users.newsletterOptIn, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.email, e));
  const userId = account?.id ?? -1;
  const [requests, reviewRows, claims, saved, edits, emails, billing] = await Promise.all([
    db.select().from(rfiRequests).where(sql`lower(${rfiRequests.email}) = ${e}`),
    db.select().from(reviews).where(sql`lower(${reviews.reviewerEmail}) = ${e} or ${reviews.userId} = ${userId}`),
    db.select().from(providerClaims).where(eq(providerClaims.userId, userId)),
    db.select().from(savedProviders).where(eq(savedProviders.userId, userId)),
    db.select().from(profileEdits).where(eq(profileEdits.userId, userId)),
    db.select({ subject: emailMessages.subject, template: emailMessages.template, status: emailMessages.status, createdAt: emailMessages.createdAt }).from(emailMessages).where(sql`lower(${emailMessages.toEmail}) = ${e}`),
    db.select().from(billingCustomers).where(sql`lower(${billingCustomers.email}) = ${e}`),
  ]);
  await audit(staff, "gdpr-export", "personal_data", e);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      subject: e,
      account: account ?? null,
      requests,
      reviews: reviewRows,
      providerClaims: claims,
      savedProviders: saved,
      profileEdits: edits,
      emailsSent: emails,
      billing,
      note: "Data held in FundHub's other tools (CRM, newsletter, drive) and in Stripe must be exported there.",
    },
    null,
    2,
  );
}

/**
 * Erasure (GDPR Art. 17): deletes the account (sessions, saved providers and claims cascade),
 * anonymises requests, reviews and email logs. Billing records are kept for the 10-year legal
 * retention period and are not touched.
 */
export async function erasePersonalData(email: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.gdpr);
  const e = email.trim().toLowerCase();
  if (!z.string().email().safeParse(e).success) return { error: "Enter a valid email." };
  const erased = `erased-${Date.now().toString(36)}@erased.invalid`;

  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, e));
  const reviewIds = (
    await db.select({ id: reviews.id }).from(reviews).where(sql`lower(${reviews.reviewerEmail}) = ${e}${account ? sql` or ${reviews.userId} = ${account.id}` : sql``}`)
  ).map((r) => r.id);

  const counts = { account: 0, requests: 0, reviews: reviewIds.length, emails: 0 };
  if (reviewIds.length) {
    await db
      .update(reviews)
      .set({ reviewerName: "Erased", reviewerEmail: erased, reviewerCompany: "Erased", evidence: "", userId: null })
      .where(inArray(reviews.id, reviewIds));
  }
  counts.requests =
    (await db.update(rfiRequests).set({ contactName: "Erased", email: erased, company: "Erased", message: "" }).where(sql`lower(${rfiRequests.email}) = ${e}`)).rowCount ?? 0;
  counts.emails =
    (await db.update(emailMessages).set({ toEmail: erased, toName: null, payload: null }).where(sql`lower(${emailMessages.toEmail}) = ${e}`)).rowCount ?? 0;
  if (account) {
    await db.delete(users).where(eq(users.id, account.id));
    counts.account = 1;
  }
  await audit(staff, "gdpr-erase", "personal_data", null, { counts });
  return {
    ok: `Erased: ${counts.account} account, ${counts.requests} request(s), ${counts.reviews} review(s) anonymised, ${counts.emails} email log entr(ies). Billing records kept (legal retention). Also remove the person from the CRM, newsletter and Stripe.`,
  };
}

export async function updateGdprRequest(input: { id: number; status: string; resolution?: string }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.gdpr);
  const status = z.enum(GDPR_REQUEST_STATUSES).parse(input.status);
  await db
    .update(gdprRequests)
    .set({
      status,
      resolution: input.resolution ?? undefined,
      handledBy: staff.id,
      completedAt: status === "completed" || status === "rejected" ? new Date() : null,
    })
    .where(eq(gdprRequests.id, input.id));
  await audit(staff, "update", "gdpr_requests", input.id, { status });
  revalidatePath("/gdpr");
  return { ok: "Saved." };
}
