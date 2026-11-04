import "server-only";
/**
 * FILE: apps/web/src/lib/auth/session.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Manages "who is logged in" on the public website. When someone logs in we create a session:
 *   a long random secret (the token) is stored in a cookie in their browser, and a fingerprint (hash) of it is
 *   stored in the `sessions` database table. On every later request we read the cookie, hash it, and look it
 *   up to find the user. The file also answers access questions: may this user edit that provider profile,
 *   do they have a paid Data Intelligence membership, may they read private reports?
 * WHERE IT RUNS: on the server only (`import "server-only"` makes the build fail if browser code imports it).
 *   It reads cookies and the database, and it must never expose session tokens to browser code.
 * FRAMEWORK NOTES:
 *   - A cookie is a small named value the browser stores for a website and sends back with every request to
 *     that site. Next.js's `cookies()` lets server code read and set them.
 *   - `redirect(url)` from Next.js stops the current work and sends the visitor to another page.
 *   - React's `cache(fn)` remembers a function's result for the duration of ONE request, so several parts of a
 *     page can ask "who is logged in?" and the database is queried only once.
 *   - Drizzle ORM builds SQL queries from TypeScript: `db.select().from(table).where(...)`.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async`/`await` and `Promise<X>` = work that finishes later and then gives an X.
 *   - `const` (fixed name) and arrow functions `(x) => …`.
 *   - union types `SessionUser | null` = "a SessionUser or nothing".
 *   - utility type `Pick<User, "id" | "email">` = "the User type, keeping only these fields".
 *   - default parameter values `next = "/account"`; optional chaining `a?.b`; nullish coalescing `a ?? b`.
 *   - type predicates `(id): id is number => …` = a filter that also tells TypeScript the result type.
 *   - generics `db.execute<{ ok: boolean }>` = "this query returns rows shaped like { ok: boolean }".
 */

// `import { a, b } from "x"` loads named things from module x.
// "node:crypto" = Node.js's built-in cryptography toolkit. `createHash` makes fingerprints (hashes) and
// `randomBytes` produces unguessable random data for session tokens.
import { createHash, randomBytes } from "node:crypto";
// Drizzle ORM helpers for WHERE clauses: `and(a, b)` = both true, `eq(col, v)` = col = v,
// `gt(col, v)` = col > v, and `sql` = write a raw SQL snippet safely.
import { and, eq, gt, sql } from "drizzle-orm";
// Next.js function to read and write cookies of the current request/response.
import { cookies } from "next/headers";
// Next.js function to send the visitor to another URL.
import { redirect } from "next/navigation";
// React's per-request memo helper (see FRAMEWORK NOTES).
import { cache } from "react";
// `@fundhub/...` = our own shared packages in the packages/ folder. `db` is the shared database connection.
import { db } from "@fundhub/db/client";
// Table definitions (`providerClaims`, `sessions`, `users`) and the `User` type (one row of `users`).
// `type User` imports only a type, which disappears when the code is compiled to JavaScript.
import { providerClaims, sessions, users, type User } from "@fundhub/db/schema";

/** Kind: constant. The cookie's name in the visitor's browser. */
const COOKIE = "fh_session";
/** Kind: constant. How long a login lasts before the visitor must log in again. */
const SESSION_DAYS = 30;

/**
 * Kind: constant holding an arrow function.
 * @param token  type `string` — the raw secret from the cookie.
 * @returns      `string`: its SHA-256 fingerprint written as hexadecimal text (64 characters).
 * Why: only the fingerprint is saved in the database. If the database ever leaked, the fingerprints could
 * not be turned back into working cookies. The calls are chained: create hasher → feed text → output hex.
 */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Kind: async function.
 * Logs a user in on this browser: creates a session row and sets the session cookie.
 * @param userId  type `number` — the id of the user (row in the `users` table).
 * @returns       `Promise<void>` (nothing; TypeScript infers it) once the session is stored and the cookie set.
 * Only works inside server actions or route handlers, because only those may set cookies.
 */
export async function createSession(userId: number) {
  // 32 random bytes (256 bits) written as URL-safe text: impossible to guess.
  const token = randomBytes(32).toString("base64url");
  // `Date.now()` = the current time in milliseconds; add 30 days' worth of milliseconds for the expiry.
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  // Save the session: `id` is the token's hash, not the token itself (see hashToken).
  // `{ userId, expiresAt }` is shorthand for `{ userId: userId, expiresAt: expiresAt }`.
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // `(await cookies())` waits for the cookie store, then `.set(name, value, options)` sets the cookie.
  (await cookies()).set(COOKIE, token, {
    // httpOnly: browser JavaScript cannot read the cookie, so a malicious script cannot steal the login.
    httpOnly: true,
    // secure: only sent over HTTPS (encrypted) in production; local development uses plain http.
    secure: process.env.NODE_ENV === "production",
    // sameSite "lax": not sent with form posts from other websites, which blocks most forged requests.
    sameSite: "lax",
    // path "/": the cookie is sent for every page of the site.
    path: "/",
    // The browser deletes the cookie on the same date the database session expires.
    expires: expiresAt,
  });
}

/**
 * Kind: async function.
 * Logs the current browser out: deletes its session row and its cookie.
 * Parameters: none. @returns `Promise<void>`.
 */
export async function destroySession() {
  // "jar" = the cookie store (a cookie jar).
  const jar = await cookies();
  // `?.value` = the cookie's text if the cookie exists, otherwise `undefined`.
  const token = jar.get(COOKIE)?.value;
  // Only touch the database when there was a cookie. The row is found by the token's hash.
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

/**
 * Kind: type alias.
 * The few user fields the website needs about the logged-in person. `Pick<User, ...>` copies just these
 * fields from the full `User` row type, so password hashes etc. are never carried around by accident.
 */
export type SessionUser = Pick<User, "id" | "email" | "name" | "accountType">;

/**
 * The logged-in account (visitor or provider), or null for anonymous visitors. Cached per request.
 * Kind: constant holding an async arrow function wrapped in React's `cache` (see FRAMEWORK NOTES).
 * Parameters: none.
 * @returns `Promise<SessionUser | null>`: the logged-in user, or `null` when there is no valid session.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // Read the session cookie; no cookie means nobody is logged in.
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  // SQL equivalent: SELECT users.id, email, name, account_type FROM sessions
  //   INNER JOIN users ON users.id = sessions.user_id
  //   WHERE sessions.id = <hash> AND sessions.expires_at > now() LIMIT 1
  // `[row]` takes the first result (array destructuring); it is `undefined` when nothing matched.
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, accountType: users.accountType })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  // `??` turns `undefined` into `null`, matching the declared return type.
  return row ?? null;
});

/**
 * Kind: async function.
 * Like getCurrentUser, but for pages that require login: anonymous visitors are sent to the login page.
 * @param next  type `string`, default "/account" — where to return after logging in.
 * @returns     `Promise<SessionUser>`: always a user (never null), because otherwise we redirected.
 */
export async function requireUser(next = "/account"): Promise<SessionUser> {
  const user = await getCurrentUser();
  // `encodeURIComponent` makes the path safe to put inside a URL (e.g. "/" becomes "%2F").
  // `redirect` never returns, so TypeScript knows `user` is not null after this line.
  if (!user) redirect(`/account/login?next=${encodeURIComponent(next)}`);
  return user;
}

/**
 * Providers this account may edit: its approved claims. Staff edit through the admin platform.
 * Kind: async function.
 * @param user  type `SessionUser` — the logged-in user.
 * @returns     `Promise<number[]>`: the ids of the providers whose claim by this user was approved
 *              (an empty list for ordinary visitor accounts).
 */
export async function getManagedProviderIds(user: SessionUser): Promise<number[]> {
  // Only "provider" accounts can manage profiles. `!==` means "is not equal to".
  if (user.accountType !== "provider") return [];
  // SELECT provider_id FROM provider_claims WHERE user_id = <user> AND status = 'approved'
  const rows = await db
    .select({ id: providerClaims.providerId })
    .from(providerClaims)
    .where(and(eq(providerClaims.userId, user.id), eq(providerClaims.status, "approved")));
  // `.map` turns each row into its id; `.filter` drops empty (null) ids. The `id is number` part tells
  // TypeScript that what remains are all numbers, so the result matches `number[]`.
  return rows.map((r) => r.id).filter((id): id is number => id !== null);
}

/**
 * Kind: async function.
 * @param user        type `SessionUser` — the logged-in user.
 * @param providerId  type `number` — the provider profile being edited.
 * @returns           `Promise<boolean>`: true if the user has an approved claim on that provider.
 */
export async function canManageProvider(user: SessionUser, providerId: number): Promise<boolean> {
  // `.includes(x)` = true if the list contains x.
  return (await getManagedProviderIds(user)).includes(providerId);
}

// NOTE for readers: the first comment line below is older and describes canAccessPrivateReports (further down),
// not hasDataMembership. It is kept as it was.
/** Private reports are for provider accounts with at least one approved company. */
/**
 * Active Data Intelligence membership (paid via Stripe; checked by a database function, see migration 0004).
 * Kind: constant holding an async arrow function, wrapped in React's `cache` (one database check per request).
 * @param user  type `SessionUser | null` — the user, or null for anonymous visitors.
 * @returns     `Promise<boolean>`: true while the user's paid membership is active.
 */
export const hasDataMembership = cache(async (user: SessionUser | null): Promise<boolean> => {
  if (!user) return false;
  // Calls the Postgres function `has_data_membership(user_id)`, which holds the rules (subscription status,
  // end dates). `sql\`...\`` with `${user.id}` sends the id as a safe parameter, never pasted into the SQL text.
  // `const { rows } = ...` (object destructuring) takes just the `rows` field of the result.
  const { rows } = await db.execute<{ ok: boolean }>(sql`select has_data_membership(${user.id}) as ok`);
  // `=== true` so that a missing row (undefined) counts as "no membership".
  return rows[0]?.ok === true;
});

/**
 * Private reports: Data Intelligence members, and providers whose company claim was approved.
 * Kind: async function.
 * @param user  type `SessionUser | null`.
 * @returns     `Promise<boolean>`: true if the user may download private reports.
 */
export async function canAccessPrivateReports(user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  // Paying members always may.
  if (await hasDataMembership(user)) return true;
  // Otherwise: providers with at least one approved company (`.length > 0` = the list is not empty).
  return (await getManagedProviderIds(user)).length > 0;
}
