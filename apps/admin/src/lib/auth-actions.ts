"use server";

/**
 * FILE: apps/admin/src/lib/auth-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The sign-in and sign-out actions for the Console. Sign-in has two steps: (1) email and
 *   password, which creates a "half" session; (2) a 6-digit two-factor (TOTP) code from an authenticator app,
 *   which completes it. On a staff member's first login, step 2 also enrols their app.
 * WHERE IT RUNS: only on the server (Node.js): it checks password hashes and writes sessions to the database.
 * FRAMEWORK NOTES: `"use server";` (must stay the first line) marks each exported function as a Next.js
 *   "server action": the login form in the browser calls it, but the code runs on the server. Since anyone
 *   on the internet can call it, it is rate-limited and gives nothing away in its error messages.
 *   `redirect(…)` from next/navigation ends the action and sends the browser to another page.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional properties, `async`/`await`, `Promise<T>`.
 *   - optional chaining `?.`, `??`, `||`, ternary, the comma operator `(a, b)`.
 *   - array destructuring `const [user] = …`.
 */

// `import { a } from "b"` brings named things from another module into this file.
// Drizzle ORM (npm library): `eq(column, value)` builds the SQL condition "column = value".
import { eq } from "drizzle-orm";
// Next.js: read the request headers (to get the caller's IP address).
import { headers } from "next/headers";
// Next.js: send the browser to another page.
import { redirect } from "next/navigation";
// `@fundhub/…` = our shared packages. Slow one-way password hashing and checking.
import { hashPassword, verifyPassword } from "@fundhub/core/password";
// The database connection.
import { db } from "@fundhub/db/client";
// Database-backed attempt counter used against password guessing.
import { rateLimit } from "@fundhub/db/rate-limit";
// The staff_users table definition.
import { staffUsers } from "@fundhub/db/schema";
// `./auth` = auth.ts in this folder: session cookie handling and TOTP code checking.
import { createStaffSession, destroyStaffSession, getSession, markMfaPassed, verifyTotp } from "./auth";

/**
 * Kind: type alias (exported).
 * The state returned to the login forms (used with React's `useActionState`): an optional error message.
 */
export type LoginState = { error?: string };

/**
 * Kind: async function (private).
 * @returns `Promise<string>`: the caller's IP address (first entry of "x-forwarded-for", set by the proxy),
 *          or "unknown". Used as the rate-limit key before we know who the person is.
 */
async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/**
 * Kind: server action.
 * Step 1 of sign-in: checks email and password.
 * @param _prev     type `LoginState` — previous form state (unused; the `_` prefix says so).
 * @param formData  type `FormData` — the submitted `email` and `password` fields.
 * @returns `Promise<LoginState>`: an error, or it redirects to the two-factor page on success.
 */
export async function staffLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Normalise the email (no surrounding spaces, lower case). `?? ""` handles a missing field.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  // Security: max 10 attempts per IP address per 15 minutes, which makes password guessing impractical.
  if (!(await rateLimit(`staff-login:${await ip()}`, 10, 15 * 60))) {
    return { error: "Too many attempts. Wait 15 minutes." };
  }
  // Find the account by email (`[user]` = first row or undefined).
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  // If the user exists, check the password. If not, we still spend the same time hashing the password and
  // then use `false`. `(a, b)` is the comma operator: run a, then take b. Security: this makes "unknown email"
  // take as long as "wrong password", so an attacker cannot tell from timing which emails exist.
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
  // One vague message for every failure (no account, wrong password, deactivated), again to reveal nothing.
  if (!user || !ok || !user.active) return { error: "Incorrect email or password." };

  // Create a session that has passed the password step only (2FA still required), and set the cookie.
  await createStaffSession(user.id);
  // Go to step 2.
  redirect("/login/mfa");
}

/**
 * Kind: server action.
 * Second step: verify the TOTP code, or confirm enrolment on first login.
 * @param _prev     type `LoginState` — previous form state (unused).
 * @param formData  type `FormData` — `code` (6 digits) and, on first login, `secret` (the new TOTP secret
 *                  that was shown as a QR code).
 * @returns `Promise<LoginState>`: an error, or it redirects to the Console home page.
 */
export async function staffMfa(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // There must already be a session from step 1; otherwise start again at the login page.
  const session = await getSession();
  if (!session) redirect("/login");
  // Security: max 10 code attempts per staff member per 15 minutes. A 6-digit code has a million options,
  // so without a limit it could be brute-forced.
  if (!(await rateLimit(`staff-mfa:${session.staff.id}`, 10, 15 * 60))) return { error: "Too many attempts. Log in again later." };

  // Load the full account row (we need the stored TOTP secret).
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.id, session.staff.id));
  const code = String(formData.get("code") ?? "");
  const enrolSecret = String(formData.get("secret") ?? "");
  // Already enrolled: use the secret stored on the server. First login: use the secret from the form.
  // Security: once 2FA is enabled, a secret sent from the browser is ignored, so it cannot be swapped.
  const secret = user.totpEnabled ? user.totpSecret : enrolSecret;
  if (!secret || !verifyTotp(secret, code)) return { error: "That code didn't match. Check your authenticator app's clock." };

  // First login: the code proved the app is set up, so save the secret and switch 2FA on.
  if (!user.totpEnabled) {
    await db.update(staffUsers).set({ totpSecret: secret, totpEnabled: true }).where(eq(staffUsers.id, user.id));
  }
  // Remember when this person last signed in (shown on the staff page).
  await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));
  // Upgrade the session to "fully signed in".
  await markMfaPassed(session.sessionId);
  // Into the Console.
  redirect("/");
}

/**
 * Kind: server action.
 * Signs the current browser out: deletes the session and its cookie, then goes to the login page.
 * @returns `Promise<void>` (in practice it never returns, because `redirect` ends the request).
 */
export async function staffLogout() {
  await destroyStaffSession();
  redirect("/login");
}
