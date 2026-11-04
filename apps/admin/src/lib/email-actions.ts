"use server";

/**
 * FILE: apps/admin/src/lib/email-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Server actions for the Console's Email page and Requests inbox. Staff can write an email to
 *   one person or to a whole segment (e.g. newsletter subscribers), see how many people a segment contains,
 *   update an incoming request (status, assignee, internal notes), reply to it by email, and push it into the
 *   Twenty CRM as a contact plus opportunity.
 * WHERE IT RUNS: only on the server (Node.js): it reads user lists from the database and sends email.
 * FRAMEWORK NOTES: `"use server";` (must stay the first line) marks every exported function as a Next.js
 *   "server action": callable from the browser, executed on the server. Each one starts with
 *   `requireStaff(CAN.email)`, so only signed-in staff with email rights (owner, operations, sales) can use it.
 *   `revalidatePath(path)` refreshes the cached version of a Console page after a change.
 *   Zod (`z`) validates the data the browser sends. Emails go out through our email package
 *   (React Email templates, delivered by the Resend service), which also logs every message.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `switch`/`case`, `let` (a variable that changes) vs `const`, `++` (add one).
 *   - array types `{ … }[]`, tuple types `[Segment, ...Segment[]]`, `Partial<T>` (all fields optional),
 *     `typeof table.$inferInsert` (Drizzle's type for a row you insert).
 *   - `new Promise(...)` with `setTimeout` (a pause), `try/catch`, `instanceof`, non-null `!`.
 *   - Drizzle `exists(subquery)` and the raw `sql` tag.
 */

// `import { a } from "b"` brings named things from module b into this file.
// Drizzle ORM: `and`, `eq` (=), `exists` (SQL EXISTS (subquery)), `sql` (safe raw SQL pieces).
import { and, eq, exists, sql } from "drizzle-orm";
// Next.js: refresh a page's cached version.
import { revalidatePath } from "next/cache";
// Zod: input validation.
import { z } from "zod";
// `@fundhub/…` = our shared packages. The allowed statuses of an inbox request.
import { RFI_STATUSES } from "@fundhub/core/enums";
// Database connection and the tables used here.
import { db } from "@fundhub/db/client";
import { providerClaims, rfiRequests, users } from "@fundhub/db/schema";
// Sends one templated email and logs it.
import { sendEmail } from "@fundhub/email/send";
// `./…` = this folder. Audit log; permissions; CRM client; the list of segments and its type.
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { createLead, crmConfigured } from "./crm";
import { SEGMENTS, type Segment } from "./segments";

/**
 * Kind: type alias (exported).
 * Returned to the page: an `ok` message or an `error` message (both optional).
 */
export type ActionResult = { ok?: string; error?: string };

/**
 * Kind: async function (private).
 * Works out who belongs to a segment.
 * @param segment  type `Segment` — one of the names in ./segments.ts.
 * @returns `Promise<{ email: string; name: string | null }[]>`: the recipients' emails and names.
 * GDPR rule: marketing ("newsletter") only reaches people who opted in; the other segments are for service
 * messages to account holders.
 */
async function recipients(segment: Segment) {
  // The common start of every query: SELECT email, name FROM users. Each case adds its own WHERE.
  const base = db.select({ email: users.email, name: users.name }).from(users);
  // `switch` picks the `case` matching the segment name. Each case returns, so no `break` is needed.
  // Because `Segment` lists every possible name, TypeScript knows all cases are covered.
  switch (segment) {
    case "newsletter":
      return base.where(eq(users.newsletterOptIn, true));
    case "providers":
      return base.where(eq(users.accountType, "provider"));
    case "visitors_service":
      return base.where(eq(users.accountType, "visitor"));
    case "approved_providers":
      // Users for whom at least one approved company claim exists:
      // WHERE EXISTS (SELECT 1 FROM provider_claims WHERE user_id = users.id AND status = 'approved').
      // `sql\`1\`` writes the literal SQL value 1 (the subquery's content does not matter, only whether a row exists).
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

/**
 * Kind: server action.
 * @param segment  type `Segment`.
 * @returns `Promise<number>`: how many people are in the segment (shown before sending).
 */
export async function countSegment(segment: Segment): Promise<number> {
  await requireStaff(CAN.email);
  // `.length` = number of items in the array of recipients.
  return (await recipients(segment)).length;
}

/**
 * Kind: constant (Zod schema).
 * The compose form: `mode` "single" (one address) or "segment"; recipient fields for single mode; the
 * segment name for segment mode; subject; body; and an optional button (label + link, link may be "").
 * `Object.keys(SEGMENTS) as [Segment, ...Segment[]]` turns the segment names into the "at least one value"
 * list type that `z.enum` requires (a tuple: one Segment followed by any number more).
 */
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

/** Kind: constant. Safety cap: at most 2000 recipients in one send, to avoid accidental mass mailings. */
const MAX_BULK = 2000;

/**
 * Kind: server action.
 * Sends a message to one person or to every member of a segment.
 * @param input  type `Record<string, unknown>` — see composeSchema.
 * @returns `Promise<ActionResult>`: how many were sent, and which addresses failed (first 5).
 */
export async function composeEmail(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  const parsed = composeSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  // `let` = this variable is given its value later (in one of the two branches below).
  let list: { email: string; name: string | null }[];
  if (d.mode === "single") {
    // Check the single address is a valid email.
    const email = z.string().email().safeParse(d.to);
    if (!email.success) return { error: "Enter a valid recipient email" };
    list = [{ email: email.data, name: d.toName || null }];
  } else {
    if (!d.segment) return { error: "Choose a segment" };
    list = await recipients(d.segment);
    if (!list.length) return { error: "That segment has no recipients." };
    if (list.length > MAX_BULK) return { error: `Segment has ${list.length} recipients; the limit per send is ${MAX_BULK}.` };
  }

  // Counters for the result message. `failed` is a `const` array: the name cannot be reassigned, but items
  // can still be added to it.
  let sent = 0;
  const failed: string[] = [];
  // Sequential with a small pause: stays well under Resend's rate limit.
  // One email per person (never one email with everyone in "To", which would expose addresses to each other).
  for (const r of list) {
    const res = await sendEmail({
      to: r.email,
      // `?? undefined` turns null into "not given".
      toName: r.name ?? undefined,
      template: "message",
      // `|| undefined` turns empty strings into "not given", so the template hides the button.
      props: { subject: d.subject, name: r.name ?? undefined, body: d.body, ctaLabel: d.ctaLabel || undefined, ctaUrl: d.ctaUrl || undefined },
      // For bulk sends, link the log entry to the segment. `d.segment!` — we checked above that it is set.
      related: d.mode === "segment" ? { entity: "segment", id: d.segment! } : undefined,
      sentBy: staff.id,
    });
    // `sent++` adds one to sent.
    if (res.ok) sent++;
    else failed.push(r.email);
    // Wait 120 ms between emails when sending to several people. `new Promise((ok) => setTimeout(ok, 120))`
    // creates a promise that is fulfilled after 120 ms; `await` pauses until then.
    if (list.length > 1) await new Promise((ok) => setTimeout(ok, 120));
  }
  // One audit row for the whole send, with the counts.
  await audit(staff, "send-email", "email_messages", null, { mode: d.mode, segment: d.segment, subject: d.subject, sent, failed: failed.length });
  revalidatePath("/email");
  return failed.length ? { error: `Sent ${sent}, failed ${failed.length}: ${failed.slice(0, 5).join(", ")}` } : { ok: `Sent ${sent} email(s).` };
}

// ---------------------------------------------------------------- inbox

/**
 * Kind: constant (Zod schema).
 * Changes to an inbox request: the id plus any of a new status, "assign to me", or internal notes.
 */
const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  status: z.enum(RFI_STATUSES).optional(),
  assignToMe: z.boolean().optional(),
  internalNotes: z.string().max(10_000).optional(),
});

/**
 * Kind: server action.
 * Updates an inbox request.
 * @param input  type `Record<string, unknown>` — see updateSchema.
 * @returns `Promise<ActionResult>`.
 */
export async function updateRequest(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { id, status, assignToMe, internalNotes } = parsed.data;
  // Build the list of columns to change. `Partial<…>` = "some of the columns of an rfi_requests row", so we
  // only set what was actually sent.
  const set: Partial<typeof rfiRequests.$inferInsert> = {};
  if (status) set.status = status;
  if (assignToMe) set.assignedTo = staff.id;
  // `!== undefined` so that an empty string (clearing the notes) is still saved.
  if (internalNotes !== undefined) set.internalNotes = internalNotes;
  await db.update(rfiRequests).set(set).where(eq(rfiRequests.id, id));
  await audit(staff, "update", "rfi_requests", id, set);
  revalidatePath("/requests");
  return { ok: "Saved." };
}

/**
 * Kind: server action.
 * Emails a reply to the person who sent an inbox request.
 * @param input  an object: `id` (`number`, the request), `subject` and `body` (`string`).
 * @returns `Promise<ActionResult>`.
 */
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
  // An open request becomes "responded"; if nobody was assigned yet, the person replying takes it.
  if (req.status === "open") await db.update(rfiRequests).set({ status: "responded", assignedTo: req.assignedTo ?? staff.id }).where(eq(rfiRequests.id, req.id));
  await audit(staff, "reply", "rfi_requests", req.id, { subject: input.subject });
  revalidatePath("/requests");
  return { ok: `Reply sent to ${req.email}.` };
}

/**
 * Kind: server action.
 * Creates the contact and an opportunity in the CRM (Twenty) for an inbox request.
 * @param id  type `number` — the request id.
 * @returns `Promise<ActionResult>`.
 */
export async function sendToCrm(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.email);
  if (!crmConfigured()) return { error: "The CRM isn't connected yet (TWENTY_URL and TWENTY_API_KEY)." };
  const [req] = await db.select().from(rfiRequests).where(eq(rfiRequests.id, id));
  if (!req) return { error: "Request not found" };
  // `crmRef` is set after a successful push, so pressing the button twice does not create duplicates.
  if (req.crmRef) return { ok: "Already in the CRM." };
  try {
    // A lookup object indexed straight away: `{ … }[req.requestType]` picks the label for this request type.
    const label = { rfi: "Quote request", advisory: "Advisory", data: "Data services", awards: "Awards", claim: "Provider" }[req.requestType];
    // Destructuring: take only `opportunityId` from the result.
    const { opportunityId } = await createLead({
      name: req.contactName,
      email: req.email,
      company: req.company,
      title: `${label}: ${req.company}`,
    });
    // Remember the CRM link (or "created" if Twenty did not return an id).
    await db.update(rfiRequests).set({ crmRef: opportunityId ?? "created" }).where(eq(rfiRequests.id, id));
    await audit(staff, "crm-sync", "rfi_requests", id, { opportunityId });
    revalidatePath("/requests");
    return { ok: "Contact and opportunity created in the CRM." };
  } catch (err) {
    // `err instanceof Error` checks it is a real error object before reading `.message`.
    return { error: err instanceof Error ? err.message : "CRM sync failed" };
  }
}
