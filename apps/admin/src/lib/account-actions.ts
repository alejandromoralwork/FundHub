"use server";

/**
 * FILE: apps/admin/src/lib/account-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The "self-service security" actions for staff accounts. A signed-in staff member can change
 *   their own password or move their two-factor (2FA) codes to a new phone app. A signed-out staff member who
 *   forgot their password can ask for a reset link by email, then use that link to set a new password.
 * WHERE IT RUNS: only on the server (Node.js). It reads and writes the database, hashes passwords and sends
 *   email, none of which may ever happen in the browser where anyone could tamper with it.
 * FRAMEWORK NOTES: The line `"use server";` at the very top is a Next.js directive. It marks every exported
 *   function in this file as a "server action": a function that a form in the browser can call, but whose
 *   code runs on the server. Next.js turns each call into a hidden HTTP request behind the scenes. Because
 *   anyone could send that request, every action must check who is calling (requireStaff) and validate input.
 *   The actions here are written for React's `useActionState` hook: they receive the previous state and the
 *   submitted form, and return a new state object ({ error } or { ok }) that the form then displays.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases (`type AccountState = { … }`) and optional properties (`error?: string`).
 *   - `async`/`await` and `Promise<T>` (a value of type T that arrives later).
 *   - arrow functions `(t) => …`, template strings `` `text ${value}` ``.
 *   - optional chaining `a?.b`, nullish coalescing `a ?? b`, logical `||`, ternary `c ? x : y`.
 *   - array destructuring `const [user] = …`, double negation `!!x` (turn anything into true/false).
 */

// `import { a, b } from "x"` brings named things (functions, values, types) from another module into this file.
// `node:crypto` = Node.js's built-in cryptography library. `createHash` makes SHA-256 fingerprints;
// `randomBytes` makes unguessable random data (used for the reset-link token).
import { createHash, randomBytes } from "node:crypto";
// Drizzle ORM (npm library) helpers that build SQL conditions: `and` (A AND B), `eq` (=), `gt` (>),
// `isNull` (IS NULL), `ne` (<>, "not equal").
import { and, eq, gt, isNull, ne } from "drizzle-orm";
// Next.js helper that reads the HTTP headers of the current request (used to find the caller's IP address).
import { headers } from "next/headers";
// Next.js helper that stops the action and sends the browser to another page.
import { redirect } from "next/navigation";
// `@fundhub/…` = our own shared packages in packages/. Minimum password length, shared with the website.
import { PASSWORD_MIN_LENGTH } from "@fundhub/core/password-rules";
// Functions that turn a password into a slow one-way hash and check a password against such a hash.
import { hashPassword, verifyPassword } from "@fundhub/core/password";
// The shared database connection (Drizzle ORM talking to Postgres).
import { db } from "@fundhub/db/client";
// Counts attempts per key in the database and says whether another attempt is still allowed.
import { rateLimit } from "@fundhub/db/rate-limit";
// Table definitions: reset links, signed-in sessions and staff user accounts.
import { staffPasswordResets, staffSessions, staffUsers } from "@fundhub/db/schema";
// Sends an email through our email package (React Email templates delivered by Resend).
import { sendEmail } from "@fundhub/email/send";
// `./…` = a file in this same folder. `audit` writes a row to the audit log ("who did what, when").
import { audit } from "./audit";
// From auth.ts: read the current session, require a signed-in staff member, check a 2FA code.
import { getSession, requireStaff, verifyTotp } from "./auth";
// Builds the public website address (the Console lives under /admin on the same domain).
import { websiteUrl } from "./site";

/**
 * Kind: type alias (exported).
 * The state object every action in this file returns to the form. `error?:` and `ok?:` are optional
 * (the `?` means the property may be missing). The form shows `error` in red or `ok` as a success message.
 */
export type AccountState = { error?: string; ok?: string };

/**
 * Kind: constant. How long a password-reset link stays valid, in minutes.
 * `const` = a name whose value can never be reassigned.
 */
const RESET_MINUTES = 60;
/**
 * Kind: constant holding an arrow function.
 * @param t  type `string` — the raw reset token from the email link.
 * @returns  `string`: its SHA-256 fingerprint written as hexadecimal text.
 * Why: we store only the hash of the token in the database. If the database ever leaked, the attacker would
 * see hashes, not working links. When the link is used we hash the incoming token again and compare.
 * `(t: string) => …` is an arrow function: a short way to write a function; the value after `=>` is returned.
 */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Kind: async function (private to this file, because it is not exported).
 * @returns `Promise<string>`: the caller's IP address, or "unknown".
 * Why: used as the rate-limit key for the signed-out reset form, where we have no user id yet.
 */
async function ip() {
  // `await headers()` waits for the request's headers.
  const h = await headers();
  // Behind a proxy/CDN the real client IP is the first entry of "x-forwarded-for" ("client, proxy1, proxy2").
  // `?.` (optional chaining) stops safely with `undefined` if the header is missing; `.split(",")[0]` takes
  // the first item; `.trim()` removes spaces; `|| "unknown"` uses the fallback if the result is empty.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Kind: function.
 * Shared rules for a new password; null when it's acceptable.
 * @param password  type `string` — the new password typed in.
 * @param confirm   type `string` — the same password typed a second time.
 * @returns `string | null` (a union type: either a string or null): the error message to show, or `null`
 *          meaning "no problem".
 */
function newPasswordError(password: string, confirm: string): string | null {
  // Too short? The template string inserts the minimum length into the message.
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  // `!==` means "not equal" (strict: no type conversion). Catches typos in the second box.
  if (password !== confirm) return "The two new passwords don't match.";
  return null;
}

/**
 * Kind: async function.
 * Signs the member out of every other browser, keeping the current session.
 * @param staffUserId  type `number` — the staff member's id.
 * @returns `Promise<void>`: nothing, it just finishes.
 * Why: after a password or 2FA change, anyone who had stolen a session elsewhere is thrown out.
 */
async function endOtherSessions(staffUserId: number) {
  // The session of the browser making this request (or null if there is none).
  const s = await getSession();
  // `db.delete(table).where(condition)` = SQL "DELETE FROM staff_sessions WHERE …".
  // Ternary `s ? A : B`: if we have a current session, delete all of this user's sessions EXCEPT it (`ne`);
  // otherwise delete all of them.
  await db
    .delete(staffSessions)
    .where(s ? and(eq(staffSessions.staffUserId, staffUserId), ne(staffSessions.id, s.sessionId)) : eq(staffSessions.staffUserId, staffUserId));
}

/**
 * Kind: async function.
 * @param staffUserId  type `number` — whose password to check.
 * @param password     type `string` — the password they typed as "current password".
 * @returns `Promise<boolean>`: true only if it matches the stored hash.
 * Why: sensitive changes require re-entering the password, so a borrowed unlocked laptop is not enough.
 */
async function checkCurrentPassword(staffUserId: number, password: string): Promise<boolean> {
  // Select only the hash column (`{ passwordHash: … }` picks columns). `const [user]` takes the first row.
  const [user] = await db.select({ passwordHash: staffUsers.passwordHash }).from(staffUsers).where(eq(staffUsers.id, staffUserId));
  // `!!user` is true if a row was found. `&&` only runs the password check when it was.
  return !!user && (await verifyPassword(password, user.passwordHash));
}

// ---------------------------------------------------------------- signed in: account security

/**
 * Kind: server action (exported async function in a "use server" file).
 * Lets a signed-in staff member change their own password.
 * @param _prev     type `AccountState` — the previous form state (required by useActionState; unused here,
 *                  which the leading `_` signals by convention).
 * @param formData  type `FormData` — the browser's standard object holding the submitted form fields.
 * @returns `Promise<AccountState>`: `{ error }` or `{ ok }` for the form to display.
 */
export async function changeOwnPassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  // Who is calling? `requireStaff` redirects to the login page if nobody is signed in.
  const staff = await requireStaff();
  // Security: at most 10 attempts per staff member per 15 minutes (15 * 60 seconds), so a stolen session
  // cannot be used to guess the current password endlessly. The key is a template string like "staff-account:7".
  if (!(await rateLimit(`staff-account:${staff.id}`, 10, 15 * 60))) return { error: "Too many attempts. Wait 15 minutes." };

  // `formData.get("current")` returns the field's value or null; `?? ""` turns null into an empty string;
  // `String(…)` makes sure we end up with text.
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  // Check length and that both new-password boxes match.
  const problem = newPasswordError(password, String(formData.get("confirm") ?? ""));
  if (problem) return { error: problem };
  // The current password must be right before we allow a change.
  if (!(await checkCurrentPassword(staff.id, current))) return { error: "Your current password is incorrect." };
  // Re-using the same password would not improve anything.
  if (current === password) return { error: "Choose a password different from the current one." };

  // SQL "UPDATE staff_users SET password_hash = … WHERE id = …". We store only a hash, never the password.
  await db.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, staff.id));
  // Kick out other browsers that may have been signed in with the old password.
  await endOtherSessions(staff.id);
  // Record the change in the audit log (who, what action, which table, which row).
  await audit(staff, "change-password", "staff_users", staff.id);
  return { ok: "Password changed. Other browsers were signed out." };
}

/**
 * Kind: server action.
 * Moves two-factor to a new authenticator app: needs the password and a code from the new app.
 * @param _prev     type `AccountState` — previous form state (unused).
 * @param formData  type `FormData` — fields: `secret` (the new TOTP secret shown as a QR code), `current`
 *                  (password) and `code` (6-digit code from the new app).
 * @returns `Promise<AccountState>`.
 * Why the code from the NEW app: it proves the person really scanned the new QR code, so they will not lock
 * themselves out with a secret no app knows.
 */
export async function changeOwnTotp(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const staff = await requireStaff();
  // Same rate limit bucket as the password change (shared key), to stop guessing.
  if (!(await rateLimit(`staff-account:${staff.id}`, 10, 15 * 60))) return { error: "Too many attempts. Wait 15 minutes." };

  const secret = String(formData.get("secret") ?? "");
  // The password must be correct.
  if (!(await checkCurrentPassword(staff.id, String(formData.get("current") ?? "")))) return { error: "Your password is incorrect." };
  // `!secret` is true when the secret is empty. `||` = "or". `verifyTotp` checks the 6-digit code against it.
  if (!secret || !verifyTotp(secret, String(formData.get("code") ?? ""))) {
    return { error: "That code didn't match. Scan the new QR code, then enter the code shown in the app." };
  }

  // Save the new secret; codes from the old app stop working from now on.
  await db.update(staffUsers).set({ totpSecret: secret, totpEnabled: true }).where(eq(staffUsers.id, staff.id));
  await endOtherSessions(staff.id);
  await audit(staff, "change-2fa", "staff_users", staff.id);
  return { ok: "Two-factor moved to your new app. Codes from the old app no longer work." };
}

// ---------------------------------------------------------------- signed out: forgotten password

/**
 * Kind: server action (works while signed out, so there is no requireStaff check).
 * Sends a password-reset link to a staff email address.
 * @param _prev     type `AccountState` — previous form state (unused).
 * @param formData  type `FormData` — field `email`.
 * @returns `Promise<AccountState>`: almost always the same generic message (see below).
 */
export async function requestStaffPasswordReset(_prev: AccountState, formData: FormData): Promise<AccountState> {
  // Normalise the email: remove surrounding spaces and use lower case, as stored in the database.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Security: we reply with the SAME message whether or not the account exists, so an outsider cannot use
  // this form to discover which email addresses belong to staff.
  const generic = { ok: "If a staff account exists for this email, we've sent a link to reset the password. It expires in 1 hour." };
  if (!email.includes("@")) return { error: "Enter your work email." };
  // Security: max 5 requests per IP address per hour, to stop email bombing and enumeration attempts.
  if (!(await rateLimit(`staff-reset:${await ip()}`, 5, 60 * 60))) return { error: "Too many requests. Try again in an hour." };

  // Look up the staff account by email.
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  // No account, or a deactivated one: quietly do nothing but answer the generic message.
  if (!user || !user.active) return generic; // never reveal which emails are staff

  // 32 random bytes written as URL-safe text ("base64url"): impossible to guess.
  const token = randomBytes(32).toString("base64url");
  // Store the reset request. Only the HASH of the token is saved as the id (see hashToken above).
  // `new Date(ms)` makes a date; `Date.now()` is "now" in milliseconds, so we add 60 minutes in milliseconds.
  await db.insert(staffPasswordResets).values({
    id: hashToken(token),
    staffUserId: user.id,
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
  });
  // Email the link containing the raw token. `template` picks the React Email design; `props` fills it in.
  // `related` links the email log row to this staff account; `sensitive: true` asks the email package not to
  // keep the content (the link) in its log, because the link works like a temporary password.
  await sendEmail({
    to: user.email,
    toName: user.name,
    template: "password-reset",
    props: { name: user.name, resetUrl: `${websiteUrl()}/admin/login/reset?token=${token}` },
    related: { entity: "staff_users", id: user.id },
    sensitive: true,
  });
  return generic;
}

/**
 * Kind: server action (signed out).
 * Sets a new password using the token from a reset email.
 * @param _prev     type `AccountState` — previous form state (unused).
 * @param formData  type `FormData` — fields `token` (hidden, from the link), `password`, `confirm`.
 * @returns `Promise<AccountState>`: an error state, or it never returns normally because it redirects.
 */
export async function resetStaffPassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const problem = newPasswordError(password, String(formData.get("confirm") ?? ""));
  if (problem) return { error: problem };

  // Find a reset row whose id is the hash of this token, that has NOT been used yet (`usedAt IS NULL`)
  // and whose expiry is still in the future (`expiresAt > now`). All three must hold (`and`).
  const [reset] = await db
    .select()
    .from(staffPasswordResets)
    .where(and(eq(staffPasswordResets.id, hashToken(token)), isNull(staffPasswordResets.usedAt), gt(staffPasswordResets.expiresAt, new Date())));
  if (!reset) return { error: "This reset link is invalid or has expired. Request a new one." };

  // Save the new password hash.
  await db.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, reset.staffUserId));
  // Mark the link as used, so it can only work once.
  await db.update(staffPasswordResets).set({ usedAt: new Date() }).where(eq(staffPasswordResets.id, reset.id));
  // Sign out everywhere; the next login still asks for the two-factor code.
  await db.delete(staffSessions).where(eq(staffSessions.staffUserId, reset.staffUserId));
  // Load the fields the audit log needs to describe the person who did this.
  const [user] = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name, role: staffUsers.role, totpEnabled: staffUsers.totpEnabled })
    .from(staffUsers)
    .where(eq(staffUsers.id, reset.staffUserId));
  if (user) await audit(user, "reset-password-by-email", "staff_users", user.id);
  // Send the browser to the login page with "?reset=1" so it can show "password changed, please sign in".
  // `redirect` works by throwing a special signal, so no `return` is needed after it.
  redirect("/login?reset=1");
}
