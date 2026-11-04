"use server";
/**
 * FILE: apps/admin/src/lib/gdpr-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Handles data-protection (GDPR) requests from people: export everything we hold about an
 *   email address (right of access / portability), erase or anonymise it (right to be forgotten), and
 *   update the status of a logged GDPR request.
 * WHERE IT RUNS: only on the server (Node.js), because it reads and deletes personal data in the database.
 * FRAMEWORK NOTES: `"use server"` (which must be the first line) makes every exported async function here a
 *   Next.js "server action": the Console's browser code can call it, but it actually runs on the server.
 *   Since such calls can be sent by anyone, each one starts with a permission check (`requireStaff`).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional properties (`ok?: string`).
 *   - `async`/`await`, `Promise<T>`, `Promise.all` for parallel queries.
 *   - array destructuring `const [account] = …` (take the first item).
 *   - tagged template strings `` sql`…` `` for raw, safely parameterised SQL.
 *   - `?.`, `??`, ternary `a ? b : c`, inline object types `{ id: number; resolution?: string }`.
 */

// `import { a } from "b"` brings named exports from another module into this file.
// From the Drizzle ORM library: `eq` (=), `inArray` (SQL "IN (…)"), and `sql` for raw SQL fragments.
import { eq, inArray, sql } from "drizzle-orm";
// Next.js: marks a page's cached copy as stale so it is rebuilt with fresh data.
import { revalidatePath } from "next/cache";
// Zod: checks that input values have the expected shape (e.g. a valid email).
import { z } from "zod";
// The allowed statuses for a GDPR request (shared list from our own core package).
import { GDPR_REQUEST_STATUSES } from "@fundhub/core/enums";
// The shared database connection.
import { db } from "@fundhub/db/client";
// Every table that can contain personal data about someone, plus the GDPR requests table itself.
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
// Audit log writer: records which staff member did what. Essential here, as GDPR work must be provable.
import { audit } from "./audit";
// Permission check and the role table (`CAN.gdpr` = owner and operations).
import { CAN, requireStaff } from "./auth";

/**
 * Kind: type alias (exported).
 * The standard result of an action: a success message in `ok` or a problem in `error` (both optional).
 */
export type ActionResult = { ok?: string; error?: string };

/**
 * Kind: server action (async function).
 * Everything FundHub's database holds about an email address (GDPR Art. 15 / 20).
 * @param email  `string` — the person's email address, as typed by staff.
 * @returns      `Promise<string>` — a nicely indented JSON text file the staff member can download and send.
 */
export async function exportPersonalData(email: string): Promise<string> {
  // Only staff allowed to handle GDPR may pull someone's full data.
  const staff = await requireStaff(CAN.gdpr);
  // Normalise: remove surrounding spaces and lower-case it, so "Ana@X.com " matches "ana@x.com".
  const e = email.trim().toLowerCase();
  // The website account (if any) with this email. Only safe columns are selected: no password hash.
  const [account] = await db
    .select({ id: users.id, email: users.email, name: users.name, company: users.company, accountType: users.accountType, newsletterOptIn: users.newsletterOptIn, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.email, e));
  // If there is no account, use -1, an id that never exists, so the account-linked queries below find nothing.
  const userId = account?.id ?? -1;
  // Seven queries in parallel. `sql\`lower(${column}) = ${e}\`` compares emails case-insensitively;
  // Drizzle inserts the column name and sends `e` as a safe parameter.
  const [requests, reviewRows, claims, saved, edits, emails, billing] = await Promise.all([
    // Information requests (RFIs) the person sent to providers.
    db.select().from(rfiRequests).where(sql`lower(${rfiRequests.email}) = ${e}`),
    // Reviews they wrote, matched by email OR by their account id.
    db.select().from(reviews).where(sql`lower(${reviews.reviewerEmail}) = ${e} or ${reviews.userId} = ${userId}`),
    // Provider profiles they claimed, providers they saved, and profile edits they proposed.
    db.select().from(providerClaims).where(eq(providerClaims.userId, userId)),
    db.select().from(savedProviders).where(eq(savedProviders.userId, userId)),
    db.select().from(profileEdits).where(eq(profileEdits.userId, userId)),
    // Emails we sent them: only a summary (subject, template, status, date), not the full content.
    db.select({ subject: emailMessages.subject, template: emailMessages.template, status: emailMessages.status, createdAt: emailMessages.createdAt }).from(emailMessages).where(sql`lower(${emailMessages.toEmail}) = ${e}`),
    // Billing customer records (mirrored from Stripe).
    db.select().from(billingCustomers).where(sql`lower(${billingCustomers.email}) = ${e}`),
  ]);
  // Audit the export: who looked at whose personal data.
  await audit(staff, "gdpr-export", "personal_data", e);
  // `JSON.stringify(value, null, 2)` turns the object into JSON text indented by 2 spaces (readable for humans).
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      subject: e,
      // `?? null` so a missing account shows as `null` in the JSON rather than being left out.
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
 * Kind: server action.
 * Erasure (GDPR Art. 17): deletes the account (sessions, saved providers and claims cascade),
 * anonymises requests, reviews and email logs. Billing records are kept for the 10-year legal
 * retention period and are not touched.
 * "Cascade" means the database itself deletes rows that point at the deleted account.
 * Reviews and requests are anonymised rather than deleted so provider scores and statistics stay correct.
 * @param email  `string` — the person's email address.
 * @returns      `Promise<ActionResult>` — a summary of what was erased, or an error.
 */
export async function erasePersonalData(email: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.gdpr);
  const e = email.trim().toLowerCase();
  // Refuse anything that is not a valid email, so a typo (or empty text) cannot match lots of rows.
  if (!z.string().email().safeParse(e).success) return { error: "Enter a valid email." };
  // A replacement address that cannot receive mail: ".invalid" is a reserved, never-real domain.
  // `Date.now().toString(36)` = the current time in milliseconds written in base 36 (short letters+digits).
  const erased = `erased-${Date.now().toString(36)}@erased.invalid`;

  // Find the account id (if any) before anything is deleted.
  const [account] = await db.select({ id: users.id }).from(users).where(eq(users.email, e));
  // Collect the ids of all their reviews. The SQL condition is built from pieces: the email match, plus
  // (only if an account exists) "or user_id = …"; the ternary picks that extra fragment or an empty `sql\`\``.
  // The `( await … )` brackets wait for the query first, then `.map` keeps just each row's id number.
  const reviewIds = (
    await db.select({ id: reviews.id }).from(reviews).where(sql`lower(${reviews.reviewerEmail}) = ${e}${account ? sql` or ${reviews.userId} = ${account.id}` : sql``}`)
  ).map((r) => r.id);

  // Tally of what was changed, reported back to staff and saved in the audit log.
  const counts = { account: 0, requests: 0, reviews: reviewIds.length, emails: 0 };
  if (reviewIds.length) {
    // Anonymise the reviews: wipe name, email, company and evidence, and unlink them from the account.
    // `inArray(column, list)` = SQL "WHERE id IN (1, 2, 3)".
    await db
      .update(reviews)
      .set({ reviewerName: "Erased", reviewerEmail: erased, reviewerCompany: "Erased", evidence: "", userId: null })
      .where(inArray(reviews.id, reviewIds));
  }
  // Anonymise their information requests. `rowCount` = how many rows the UPDATE changed (`?? 0` if unknown).
  counts.requests =
    (await db.update(rfiRequests).set({ contactName: "Erased", email: erased, company: "Erased", message: "" }).where(sql`lower(${rfiRequests.email}) = ${e}`)).rowCount ?? 0;
  // Anonymise the email log: keep that an email was sent, but drop who it went to and its content (`payload`).
  counts.emails =
    (await db.update(emailMessages).set({ toEmail: erased, toName: null, payload: null }).where(sql`lower(${emailMessages.toEmail}) = ${e}`)).rowCount ?? 0;
  if (account) {
    // Finally delete the account itself; linked rows go with it through the database's cascade rules.
    await db.delete(users).where(eq(users.id, account.id));
    counts.account = 1;
  }
  // Note the email itself is NOT stored in the audit entry (it passes `null`), so the log does not keep the
  // personal data we just erased; only the counts are kept as proof the erasure happened.
  await audit(staff, "gdpr-erase", "personal_data", null, { counts });
  return {
    ok: `Erased: ${counts.account} account, ${counts.requests} request(s), ${counts.reviews} review(s) anonymised, ${counts.emails} email log entr(ies). Billing records kept (legal retention). Also remove the person from the CRM, newsletter and Stripe.`,
  };
}

/**
 * Kind: server action.
 * Changes the status (and optional resolution note) of a GDPR request in the tracking list.
 * @param input  `{ id: number; status: string; resolution?: string }` — the request's id, its new status,
 *               and optionally (`?`) a note on how it was resolved.
 * @returns      `Promise<ActionResult>`.
 */
export async function updateGdprRequest(input: { id: number; status: string; resolution?: string }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.gdpr);
  // `.parse` (unlike `.safeParse`) throws an error if the status is not one of the allowed values,
  // which stops the action right here.
  const status = z.enum(GDPR_REQUEST_STATUSES).parse(input.status);
  await db
    .update(gdprRequests)
    .set({
      status,
      // `?? undefined`: if no resolution was given, Drizzle leaves the column unchanged (undefined = "skip").
      resolution: input.resolution ?? undefined,
      // Remember which staff member handled it.
      handledBy: staff.id,
      // Set the completion time when the request is closed either way; otherwise clear it.
      completedAt: status === "completed" || status === "rejected" ? new Date() : null,
    })
    .where(eq(gdprRequests.id, input.id));
  await audit(staff, "update", "gdpr_requests", input.id, { status });
  // Refresh the GDPR page.
  revalidatePath("/gdpr");
  return { ok: "Saved." };
}
