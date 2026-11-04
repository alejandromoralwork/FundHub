/**
 * FILE: apps/admin/src/lib/auth.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The heart of Console security. It creates and ends staff sessions (a random token kept in a
 *   browser cookie, with only its hash in the database), reads the current session, forces pages to require a
 *   fully signed-in staff member, handles TOTP two-factor codes (the 6-digit codes from apps such as Google
 *   Authenticator), and defines which staff roles may do what (the CAN table).
 * WHERE IT RUNS: only on the server (Node.js). Cookies, secrets and database access must stay server-side.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code imports this file.
 *   `cookies()` from next/headers reads/sets the cookies of the current request (it is async in this Next.js
 *   version, hence `await cookies()`). `redirect()` stops the current page and sends the browser elsewhere.
 *   React's `cache()` remembers a function's result for the duration of ONE request, so many components can
 *   call getSession() while the database is asked only once.
 *   The Console is served under the "basePath" /admin, so the cookie is limited to that path.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Pick<T, "a" | "b">` (a type made of only some fields of T), type aliases, union types.
 *   - `readonly` arrays, `as const` (freeze values as exact literal types), `satisfies` (check a value fits a
 *     type without changing its type), `keyof typeof X` (the names of X's keys as a type).
 *   - object rest destructuring `const { a, ...rest } = obj`, renaming `active: _a`.
 *   - async/await, `Promise<T | null>`, optional chaining `?.`, regular expressions.
 */

// Server-only guard (see FRAMEWORK NOTES). `import { a } from "b"` brings named things in from module b.
import "server-only";
// Node.js's built-in cryptography: SHA-256 hashing and secure random bytes.
import { createHash, randomBytes } from "node:crypto";
// Drizzle ORM SQL helpers: `and` (A AND B), `eq` (=), `gt` (>).
import { and, eq, gt } from "drizzle-orm";
// Next.js: access to the request's cookies.
import { cookies } from "next/headers";
// Next.js: send the browser to another page.
import { redirect } from "next/navigation";
// React's per-request memoisation helper (see FRAMEWORK NOTES).
import { cache } from "react";
// `otpauth` (npm library) implements TOTP: time-based one-time passwords, the standard behind authenticator apps.
import { TOTP, Secret } from "otpauth";
// `@fundhub/…` = our shared packages. `StaffRole` = the allowed roles ("owner", "operations", …).
import type { StaffRole } from "@fundhub/core/enums";
// The database connection.
import { db } from "@fundhub/db/client";
// Table definitions for sessions and staff accounts, plus the TypeScript type of a staff_users row.
import { staffSessions, staffUsers, type StaffUser } from "@fundhub/db/schema";

/** Kind: constant. The name of the session cookie in the browser. */
const COOKIE = "fh_staff";
/** Short sessions: this is an internal tool with access to everything. */
const SESSION_HOURS = 12;
/**
 * Kind: constant holding an arrow function.
 * @param t  type `string` — a raw session token.
 * @returns  `string`: its SHA-256 hash as hex text.
 * Security: the database stores only this hash. Someone who reads the database cannot rebuild a working
 * cookie from it, because a hash cannot be reversed.
 */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Kind: type alias (exported).
 * What the rest of the Console knows about a signed-in staff member: `Pick` keeps only these five fields
 * of the full database row, so secrets like the password hash or TOTP secret are never passed around.
 */
export type Staff = Pick<StaffUser, "id" | "email" | "name" | "role" | "totpEnabled">;
/**
 * Kind: type alias (private).
 * The current session: who it is, the session id (the token hash), and whether two-factor was passed.
 */
type SessionInfo = { staff: Staff; sessionId: string; mfaPassed: boolean };

/**
 * Kind: async function (exported).
 * Starts a new session after a correct password (2FA not yet passed) and sets the cookie.
 * @param staffUserId  type `number` — the staff member's id.
 * @returns `Promise<void>`.
 */
export async function createStaffSession(staffUserId: number) {
  // 32 random bytes as URL-safe text: impossible to guess.
  const token = randomBytes(32).toString("base64url");
  // Expiry = now + 12 hours (converted to milliseconds).
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  // Save the session under the token's HASH. `{ …, staffUserId, … }` is shorthand for `staffUserId: staffUserId`.
  // `mfaPassed` is not given, so it takes the database default (false).
  await db.insert(staffSessions).values({ id: hashToken(token), staffUserId, expiresAt });
  // Put the raw token in the browser cookie. The cookie options are security settings:
  (await cookies()).set(COOKIE, token, {
    // JavaScript in the page cannot read it, so a script injected into a page cannot steal it.
    httpOnly: true,
    // In production, only send it over HTTPS (encrypted connections).
    secure: process.env.NODE_ENV === "production",
    // Never sent along with requests started from other websites (protects against cross-site request forgery).
    sameSite: "strict",
    // basePath: the cookie never reaches the public website's routes.
    path: "/admin",
    // The browser forgets it at the same moment the database row expires.
    expires: expiresAt,
  });
}

/**
 * Kind: async function (exported).
 * Ends the current session: deletes its database row and the cookie.
 * @returns `Promise<void>`.
 */
export async function destroyStaffSession() {
  const jar = await cookies();
  // `?.value` = the cookie's value, or undefined if there is no cookie.
  const token = jar.get(COOKIE)?.value;
  // Delete the session row so the token stops working even if it was copied somewhere.
  if (token) await db.delete(staffSessions).where(eq(staffSessions.id, hashToken(token)));
  // Remove the cookie (the path must match the one used when setting it).
  jar.delete({ name: COOKIE, path: "/admin" });
}

/**
 * Kind: constant holding a cached async arrow function (exported).
 * Reads the session cookie and returns the matching valid session, or `null`.
 * @returns `Promise<SessionInfo | null>`: the session, or null when there is no cookie, the session is
 *          unknown/expired, or the account was deactivated.
 * `cache(…)` makes repeated calls in the same request reuse the first result (one database query).
 */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  // One query joining sessions to staff users: SELECT these columns FROM staff_sessions
  // INNER JOIN staff_users ON staff_users.id = staff_sessions.staff_user_id
  // WHERE session id = hash(token) AND expires_at > now LIMIT 1.
  const [row] = await db
    .select({
      sessionId: staffSessions.id,
      mfaPassed: staffSessions.mfaPassed,
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      role: staffUsers.role,
      totpEnabled: staffUsers.totpEnabled,
      active: staffUsers.active,
    })
    .from(staffSessions)
    .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
    .where(and(eq(staffSessions.id, hashToken(token)), gt(staffSessions.expiresAt, new Date())))
    .limit(1);
  // Deactivated staff are treated as signed out immediately, even with a valid cookie.
  if (!row || !row.active) return null;
  // Rest destructuring: pull out sessionId and mfaPassed, drop `active` (renamed to `_a` = "unused"),
  // and collect every remaining field into a new object called `staff`.
  const { sessionId, mfaPassed, active: _a, ...staff } = row;
  return { staff, sessionId, mfaPassed };
});

/**
 * Kind: async function (exported).
 * Fully authenticated staff (password + TOTP), optionally restricted to roles.
 * Every protected page and server action calls this first.
 * @param roles  optional, type `readonly StaffRole[]` — if given, only these roles may continue. `readonly`
 *               means the function promises not to change the list.
 * @returns `Promise<Staff>`: the signed-in staff member. If the check fails it never returns, it redirects:
 *          to /login (no session), /login/mfa (2FA not done), or the home page with "?denied=1" (wrong role).
 */
export async function requireStaff(roles?: readonly StaffRole[]): Promise<Staff> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.mfaPassed) redirect("/login/mfa");
  // `.includes(x)` returns true if x is in the list.
  if (roles && !roles.includes(s.staff.role)) redirect("/?denied=1");
  return s.staff;
}

/**
 * Kind: async function (exported).
 * Marks a session as having passed the two-factor step (called after a correct TOTP code).
 * @param sessionId  type `string` — the session's id (the token hash).
 * @returns `Promise<void>`.
 */
export async function markMfaPassed(sessionId: string) {
  await db.update(staffSessions).set({ mfaPassed: true }).where(eq(staffSessions.id, sessionId));
}

// ---------------------------------------------------------------- TOTP
// TOTP in short: the server and the phone app share a secret. Every 30 seconds both compute a 6-digit code
// from the secret and the current time. If the codes match, the person holds the phone.

/**
 * Kind: function (exported).
 * @returns `string`: a fresh random TOTP secret (20 bytes) in base32 text, the format authenticator apps use.
 */
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/**
 * Kind: function (private).
 * Builds a TOTP calculator with the standard settings most apps expect (SHA1, 6 digits, 30-second steps).
 * @param secret  type `string` — the base32 secret.
 * @param label   type `string` — the account name shown in the app (the staff email).
 * @returns a `TOTP` object from the otpauth library.
 */
function totp(secret: string, label: string) {
  return new TOTP({ issuer: "FundHub Admin", label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

/**
 * Kind: function (exported).
 * @param secret  type `string` — the base32 secret.
 * @param email   type `string` — the staff email, used as the label.
 * @returns `string`: an "otpauth://…" link. The enrolment page turns it into a QR code for the app to scan.
 */
export function totpUri(secret: string, email: string): string {
  return totp(secret, email).toString();
}

/**
 * Kind: function (exported).
 * Accepts the current code and one step either side (clock drift).
 * @param secret  type `string` — the base32 secret.
 * @param code    type `string` — what the person typed.
 * @returns `boolean`: true if the code is valid now (or 30 seconds before/after).
 */
export function verifyTotp(secret: string, code: string): boolean {
  // Remove spaces (apps often show "123 456").
  const clean = code.replace(/\s+/g, "");
  // Regular expression test: exactly six digits from start (^) to end ($), otherwise reject straight away.
  if (!/^\d{6}$/.test(clean)) return false;
  // `validate` returns how many steps off the code was, or null if it does not match. `window: 1` allows one
  // step either side. The label "x" does not matter for checking.
  return totp(secret, "x").validate({ token: clean, window: 1 }) !== null;
}

// ---------------------------------------------------------------- roles

/**
 * Kind: constant (exported).
 * Who can do what. Owners can do everything.
 * Each key is a permission; its value is the list of roles that have it. Used with `requireStaff(CAN.sql)`
 * or `can(staff, "sql")`.
 * `as const` freezes the lists so TypeScript knows the exact role names (not just "some strings").
 * `satisfies Record<string, readonly StaffRole[]>` checks that every list contains only real roles (a typo
 * would be a compile error) while keeping the exact frozen type.
 */
export const CAN = {
  moderate: ["owner", "operations"],
  editData: ["owner", "operations"],
  sql: ["owner", "analyst"],
  email: ["owner", "operations", "sales"],
  billing: ["owner", "sales"],
  pipeline: ["owner", "operations", "analyst"],
  staff: ["owner"],
  content: ["owner", "operations", "sales"],
  finance: ["owner"],
  gdpr: ["owner", "operations"],
} as const satisfies Record<string, readonly StaffRole[]>;

/**
 * Kind: function (exported).
 * @param staff   type `Staff` — the signed-in staff member.
 * @param action  type `keyof typeof CAN` — one of the permission names above ("moderate", "sql", …);
 *                TypeScript rejects any other text.
 * @returns `boolean`: true if this person's role has that permission. Used to show or hide buttons and menus.
 * The `as readonly StaffRole[]` widens the frozen list so `.includes` accepts any role.
 */
export function can(staff: Staff, action: keyof typeof CAN): boolean {
  return (CAN[action] as readonly StaffRole[]).includes(staff.role);
}
