"use server";
/**
 * FILE: apps/admin/src/lib/ops-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Two groups of operational actions:
 *   - reports: upload a PDF market report (shown on the website's Data Intelligence page), change who may
 *     see it, or delete it;
 *   - staff accounts: create a Console user with a temporary password, and change a user's role, deactivate
 *     them, reset their two-factor login or their password.
 * WHERE IT RUNS: only on the server (Node.js): it writes to the database and generates/hashes passwords.
 * FRAMEWORK NOTES: `"use server"` (must stay the first line) makes each exported async function a Next.js
 *   "server action": the Console's forms and buttons call it and Next.js runs it on the server. Since the
 *   request could be forged by anyone, each action first calls `requireStaff(...)` with the roles allowed.
 *   A server action can receive a `FormData` object: the raw contents of an HTML form, including files.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional properties; `async`/`await`; `Promise<T>`.
 *   - `instanceof` (is this value a File?), `Buffer` (Node.js's raw bytes type).
 *   - `Partial<T>` (all properties of T made optional), `typeof x.$inferInsert` (a type derived from a table).
 *   - `let` (a variable that can be reassigned, unlike `const`), `string | undefined`.
 *   - `Object.fromEntries`, `Object.assign`, spread `{ ...obj }`.
 */

// `import { a } from "b"` brings named exports from another module. "node:crypto" is Node.js's built-in
// cryptography module; `randomBytes` gives unpredictable random bytes (safe for passwords).
import { randomBytes } from "node:crypto";
// Drizzle ORM: `eq(column, value)` = SQL "column = value".
import { eq } from "drizzle-orm";
// Next.js: mark a page's cached data as stale so it is rebuilt.
import { revalidatePath } from "next/cache";
// Zod: validation of incoming input.
import { z } from "zod";
// Shared lists from our core package: who may see a report, and the possible staff roles.
import { REPORT_VISIBILITY, STAFF_ROLES } from "@fundhub/core/enums";
// Turns text into a URL-friendly slug.
import { slugify } from "@fundhub/core/format";
// Turns a password into a one-way hash for storage (see `createStaff`).
import { hashPassword } from "@fundhub/core/password";
// Database connection and the tables used: reports, staff login sessions, staff users.
import { db } from "@fundhub/db/client";
import { reports, staffSessions, staffUsers } from "@fundhub/db/schema";
// Audit log writer, permission check and role table.
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

/**
 * Kind: type alias (exported).
 * Result of an action: `ok` or `error` message, plus an optional `secret` (a new temporary password) that the
 * UI shows exactly once and never stores.
 */
export type ActionResult = { ok?: string; error?: string; secret?: string };

// ---------------------------------------------------------------- reports

/**
 * Kind: constant. Maximum PDF size: 4 × 1024 × 1024 bytes = 4 MB.
 * PDFs are stored inside the database, so a limit keeps it from growing too fast.
 */
const MAX_PDF_BYTES = 4 * 1024 * 1024;
/**
 * Kind: constant (Zod schema).
 * The text fields of the upload form. `min(3, "Add a title")`: the second argument is the error shown.
 */
const reportSchema = z.object({
  title: z.string().trim().min(3, "Add a title").max(160),
  period: z.string().trim().min(2, "Add a period, e.g. Q4 2026").max(40),
  summary: z.string().trim().max(600).default(""),
  visibility: z.enum(REPORT_VISIBILITY),
});

/**
 * Kind: server action.
 * Stores an uploaded PDF report and lists it on the website.
 * @param formData  `FormData` — the submitted form: title, period, summary, visibility and the `file`.
 * @returns         `Promise<ActionResult>`.
 */
export async function uploadReport(formData: FormData): Promise<ActionResult> {
  // `CAN.editData` = owner and operations.
  const staff = await requireStaff(CAN.editData);
  // `Object.fromEntries(formData)` turns the form's name/value pairs into a plain object for Zod to check.
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  // The uploaded file. `instanceof File` checks it really is a file (not text); size 0 means nothing was chosen.
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF file." };
  if (file.size > MAX_PDF_BYTES) return { error: "PDF must be 4 MB or smaller." };
  // Read the whole file into memory as raw bytes (`Buffer`).
  const buf = Buffer.from(await file.arrayBuffer());
  // Security: do not trust the file name or type the browser claims. Every real PDF starts with the five
  // bytes "%PDF-", so check those ("magic bytes") before accepting it.
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "That file isn't a PDF." };

  // A unique URL slug: title + period, plus the current time in base 36 so two similar reports never clash.
  const slug = `${slugify(`${parsed.data.title} ${parsed.data.period}`)}-${Date.now().toString(36)}`;
  // Save the report with its PDF bytes and size; get the new id back.
  const [row] = await db.insert(reports).values({ ...parsed.data, slug, pdf: buf, fileSize: buf.length }).returning({ id: reports.id });
  await audit(staff, "upload", "reports", row.id, { title: parsed.data.title, visibility: parsed.data.visibility, bytes: buf.length });
  revalidatePath("/reports");
  return { ok: `Uploaded "${parsed.data.title}". It's now listed on the website's Data Intelligence page.` };
}

/**
 * Kind: server action.
 * Changes who can see a report (one of the `REPORT_VISIBILITY` values).
 * @param id          `number` — the report's id.
 * @param visibility  `string` — the new visibility, checked against the allowed list.
 * @returns           `Promise<ActionResult>`.
 */
export async function setReportVisibility(id: number, visibility: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  // `.parse` throws (stopping the action) if the value is not allowed.
  const v = z.enum(REPORT_VISIBILITY).parse(visibility);
  await db.update(reports).set({ visibility: v }).where(eq(reports.id, id));
  await audit(staff, "update", "reports", id, { visibility: v });
  revalidatePath("/reports");
  return { ok: `Report is now ${v}.` };
}

/**
 * Kind: server action.
 * Permanently deletes a report (and its PDF).
 * @param id  `number`.
 * @returns   `Promise<ActionResult>`.
 */
export async function deleteReport(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  await db.delete(reports).where(eq(reports.id, id));
  await audit(staff, "delete", "reports", id);
  revalidatePath("/reports");
  return { ok: "Report deleted." };
}

// ---------------------------------------------------------------- staff

/**
 * Kind: constant (Zod schema).
 * A new staff member: email (trimmed, lower-cased, must look like an email), name and role.
 */
const staffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  role: z.enum(STAFF_ROLES),
});

/**
 * Kind: server action.
 * Returns the temporary password once; the new member sets up 2FA at first login.
 * Only the owner (`CAN.staff`) can manage staff accounts.
 * @param input  `Record<string, unknown>` — raw form values.
 * @returns      `Promise<ActionResult>` — with `secret` = the temporary password to pass on securely.
 */
export async function createStaff(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.staff);
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a name, a valid email and a role." };
  // Refuse duplicates.
  const [exists] = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, parsed.data.email));
  if (exists) return { error: "A staff account with this email already exists." };
  // 12 random bytes written in "base64url" (letters, digits, - and _): a 16-character password, impossible to guess.
  const password = randomBytes(12).toString("base64url");
  // Security: only the HASH of the password is stored. A hash is a one-way scramble: it can check a typed
  // password but cannot be turned back into it, so a leaked database does not reveal passwords.
  const [row] = await db.insert(staffUsers).values({ ...parsed.data, passwordHash: await hashPassword(password) }).returning({ id: staffUsers.id });
  // The password itself is never written to the audit log.
  await audit(staff, "create", "staff_users", row.id, { email: parsed.data.email, role: parsed.data.role });
  revalidatePath("/staff");
  return { ok: `Created ${parsed.data.email}. Share the temporary password securely.`, secret: password };
}

/**
 * Kind: server action.
 * Changes a staff account. Every part of `changes` is optional (`?`), so the UI sends only what changed.
 * @param id       `number` — the staff user to change.
 * @param changes  `{ role?: string; active?: boolean; resetMfa?: boolean; resetPassword?: boolean }`:
 *                 new role; activate/deactivate; turn off two-factor (so they set it up again); new password.
 * @returns        `Promise<ActionResult>` — `secret` holds the new password when one was generated.
 */
export async function updateStaff(id: number, changes: { role?: string; active?: boolean; resetMfa?: boolean; resetPassword?: boolean }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.staff);
  // Safety rule: the owner may not lock themselves out by deactivating or demoting their own account.
  // `changes.active === false` is checked exactly (not just "falsy") because `undefined` means "no change".
  if (id === staff.id && (changes.active === false || (changes.role && changes.role !== "owner"))) {
    return { error: "You can't deactivate or demote yourself." };
  }
  // The columns to update. `typeof staffUsers.$inferInsert` is the row type Drizzle derives from the table;
  // `Partial<…>` makes every column optional, so we can start empty (`{}`) and add only what changed.
  const set: Partial<typeof staffUsers.$inferInsert> = {};
  if (changes.role) set.role = z.enum(STAFF_ROLES).parse(changes.role);
  if (changes.active !== undefined) set.active = changes.active;
  // `Object.assign(target, source)` copies several properties into `set` at once: disable TOTP and clear its secret.
  if (changes.resetMfa) Object.assign(set, { totpEnabled: false, totpSecret: null });
  // `let` because it may be given a value inside the `if` below; it stays `undefined` otherwise.
  let password: string | undefined;
  if (changes.resetPassword) {
    // New random password, stored only as a hash (as in `createStaff`).
    password = randomBytes(12).toString("base64url");
    set.passwordHash = await hashPassword(password);
  }
  await db.update(staffUsers).set(set).where(eq(staffUsers.id, id));
  // Any security-relevant change signs the member out everywhere.
  // Deleting their session rows means any browser still logged in as them is no longer recognised.
  if (changes.active === false || changes.resetMfa || changes.resetPassword) {
    await db.delete(staffSessions).where(eq(staffSessions.staffUserId, id));
  }
  // Only the flags are audited (e.g. `resetPassword: true`), never the new password.
  await audit(staff, "update", "staff_users", id, { ...changes });
  revalidatePath("/staff");
  return { ok: "Saved.", secret: password };
}
