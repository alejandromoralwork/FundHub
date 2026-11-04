"use server";
/**
 * FILE: apps/web/src/lib/auth/actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The server actions behind the website's account forms: sign up, log in, log out, turn a visitor
 *   account into a provider account, "forgot my password" (email a reset link) and "set a new password".
 *   Each action checks the input, protects against robots with rate limits, talks to the database, and then
 *   either redirects the visitor or returns a message for the form to display.
 * WHERE IT RUNS: on the server only. Passwords are checked and hashed here, never in the browser.
 * FRAMEWORK NOTES:
 *   - `"use server"` (the first line) marks every exported function in this file as a SERVER ACTION: a function
 *     a form in the browser can call directly. Next.js turns the call into a hidden HTTP request, runs the
 *     function on the server and sends the result back. The directive must be the file's very first statement.
 *   - Form actions used with React's `useActionState` hook receive `(previousState, formData)` and return the
 *     new state (e.g. `{ error: "…" }`), which the form then shows.
 *   - `FormData` = the fields a submitted HTML form sends; `formData.get("email")` reads one field.
 *   - `redirect(url)` sends the visitor elsewhere and stops the function (it works by throwing internally).
 *   - `revalidatePath(path)` tells Next.js that a page's cached copy is out of date and must be rebuilt.
 *   - Zod is a validation library: you describe the expected shape of the data once (a "schema"), then
 *     `schema.safeParse(value)` returns `{ success: true, data }` or `{ success: false, error }`.
 * SECURITY IDEAS IN THIS FILE:
 *   - Passwords are stored only as a salted scrypt hash (see @fundhub/core/password): a slow one-way
 *     fingerprint, so even we cannot read them, and checking guesses in bulk is expensive.
 *   - Rate limiting (`rateLimit(key, limit, windowSeconds)`) counts attempts per key in Postgres and refuses
 *     once the limit is passed within the time window, which slows down password guessing and spam.
 *   - Error messages never reveal whether an email address has an account.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional fields (`error?: string`); `Record<string, string>` = "an object whose keys and
 *     values are all text"; `async`/`await`/`Promise<X>`; spread `{ ...echo }` = copy all fields of echo in.
 *   - `typeof raw === "string"` = check the type at run time; ternary `a ? b : c`; `??=` = "set if empty".
 *   - comma expression `(a, b)` = run a, then give b; non-null assertion `x!` = "this is definitely not empty".
 */

// `import { a } from "b"` loads named things from module b. "node:…" = built into Node.js.
// `createHash` makes fingerprints (hashes); `randomBytes` produces unguessable random data for reset tokens.
import { createHash, randomBytes } from "node:crypto";
// Drizzle ORM query helpers: and (both), eq (=), gt (>), isNull (IS NULL).
import { and, eq, gt, isNull } from "drizzle-orm";
// Next.js: mark a page's cached copy as outdated.
import { revalidatePath } from "next/cache";
// Next.js: send the visitor to another URL.
import { redirect } from "next/navigation";
// Zod, the validation library (see FRAMEWORK NOTES). `z` is its main object.
import { z } from "zod";
// `@fundhub/...` = our own shared packages in packages/. ACCOUNT_TYPES = the allowed account kinds
// (e.g. "visitor", "provider"), listed once so the website, console and database agree.
import { ACCOUNT_TYPES } from "@fundhub/core/enums";
// Password helpers: make a hash, check a password against a hash, and the minimum length rule.
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "@fundhub/core/password";
// The shared database connection.
import { db } from "@fundhub/db/client";
// Postgres-backed attempt counter (see SECURITY IDEAS above).
import { rateLimit } from "@fundhub/db/rate-limit";
// Table definitions used here.
import { passwordResets, sessions, users } from "@fundhub/db/schema";
// Renders one of our email templates and sends it through Resend (an email delivery service).
import { sendEmail } from "@fundhub/email/send";
// Relative paths ("../x", "./x") point to other files in this app. `clientIp` = the visitor's IP address.
import { clientIp } from "../client-ip";
// Adds an email to the newsletter list (when the user ticked the box).
import { subscribeToListmonk } from "../newsletter";
// The site's full base URL, needed to build the reset link in the email.
import { siteUrl } from "../site";
// Session helpers: log in, log out, and "must be logged in".
import { createSession, destroySession, requireUser } from "./session";

/**
 * Kind: type alias.
 * What every auth form action returns, and what the form shows. All fields are optional (`?`):
 * - `error`: a message for the whole form; `ok`: a success message;
 * - `fieldErrors`: messages per field, e.g. `{ email: "Enter a valid email" }`;
 * - `email`, `name`: what the user typed, sent back so the form can refill them after an error ("echo").
 */
export type AuthFormState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
  email?: string;
  name?: string;
};

/**
 * Only allow same-site relative redirects after login.
 * Kind: function (not exported, so it is NOT a server action; only this file can use it).
 * @param raw  type `FormDataEntryValue | null` — the hidden "next" form field: text, an uploaded file, or null.
 * @returns    `string`: a safe path on our own site, or "/account" when the value is missing or unsafe.
 * Why: without this check, a crafted link like ".../login?next=https://evil.example" could send people to
 * a fake site after logging in (an "open redirect"). A path must start with "/" but not "//", because
 * "//evil.example" would be read by browsers as another website.
 */
function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === "string" ? raw : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

/**
 * Kind: constant (Zod schema).
 * An email must be text; `.trim()` removes spaces at the ends, `.toLowerCase()` makes "Bob@X.com" and
 * "bob@x.com" the same account, `.email(msg)` checks the format, `.max(200)` caps the length.
 */
const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(200);
/**
 * Kind: constant (Zod schema).
 * A password must have at least PASSWORD_MIN_LENGTH characters and at most 200 (very long inputs would make
 * hashing slow on purpose-built attacks). Passwords are not trimmed: spaces are allowed characters.
 */
const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, "Password is too long");

/**
 * Kind: constant (Zod object schema).
 * The shape of the sign-up form. `z.object({...})` checks each field with its own rule:
 * - `z.enum(ACCOUNT_TYPES, …)` = must be one of the allowed account types;
 * - `.default("")` = use empty text if the field was not sent;
 * - `z.literal("on").optional()` = a ticked checkbox sends "on"; an unticked one sends nothing (allowed).
 */
const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
  accountType: z.enum(ACCOUNT_TYPES, { message: "Choose an account type" }),
  company: z.string().trim().max(160).default(""),
  newsletterOptIn: z.literal("on").optional(),
});

/**
 * Kind: function (internal helper).
 * Turns Zod's list of problems into one message per field, for showing next to each input.
 * @param issues  type `z.core.$ZodIssue[]` — Zod's list of validation problems; each has a `path`
 *                (which field, e.g. ["email"]) and a `message`.
 * @returns       `Record<string, string>`: e.g. `{ email: "Enter a valid email", name: "Enter your name" }`.
 */
function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  // `for (const i of issues)` loops over each problem. `??=` keeps only the FIRST message per field.
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

/** Kind: constant. The message shown when a rate limit is hit. */
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

/**
 * Kind: server action (async function), used by the sign-up form.
 * @param _prev     type `AuthFormState` — the form's previous state. Required by `useActionState` but unused
 *                  here; the leading underscore is a convention meaning "deliberately ignored".
 * @param formData  type `FormData` — the submitted form fields.
 * @returns         `Promise<AuthFormState>` with errors to show; on success it redirects instead of returning.
 */
export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // What the user typed, so the form can be refilled if we return an error. `String(x ?? "")` = text, or "".
  const echo = { email: String(formData.get("email") ?? ""), name: String(formData.get("name") ?? "") };
  // At most 10 sign-ups per IP address per hour (60 * 60 seconds).
  if (!(await rateLimit(`signup:${await clientIp()}`, 10, 60 * 60))) return { error: TOO_MANY, ...echo };

  // `Object.fromEntries(formData)` turns the form fields into a plain object `{ name: "...", email: "..." }`
  // so Zod can check it.
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues), ...echo };
  // `d` = the cleaned, validated data (trimmed, lower-cased, defaults filled in).
  const d = parsed.data;

  // Refuse a second account with the same email.
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email));
  if (existing) return { error: "An account with this email already exists. Log in instead.", ...echo };

  // INSERT the new user and get back its new id (`.returning(...)`). Only the password HASH is stored.
  const [user] = await db
    .insert(users)
    .values({
      name: d.name,
      email: d.email,
      passwordHash: await hashPassword(d.password),
      accountType: d.accountType,
      company: d.company,
      // A comparison gives true/false, which is what the boolean column needs.
      newsletterOptIn: d.newsletterOptIn === "on",
    })
    .returning({ id: users.id });
  // Only subscribe to the newsletter with explicit consent (the ticked box).
  if (d.newsletterOptIn === "on") await subscribeToListmonk(d.email, d.name);
  // Log the new user straight in, then send them on (to the page they came from, if safe).
  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

/**
 * Kind: server action (async function), used by the login form.
 * @param _prev     type `AuthFormState` — unused previous state (see signup).
 * @param formData  type `FormData` — fields "email", "password" and the optional hidden "next".
 * @returns         `Promise<AuthFormState>` with an error, or redirects on success.
 */
export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  // One vague message for every failure, so attackers cannot tell "no such email" from "wrong password".
  const invalid = { error: "Incorrect email or password.", email: String(formData.get("email") ?? "") };
  if (!email.success || !password) return invalid;

  // Per IP and per account, so neither spraying nor targeted guessing scales.
  // (30 tries per IP and 10 per email address, each per 15 minutes; `&&` = both must allow it.)
  const ip = await clientIp();
  const allowed = (await rateLimit(`login:ip:${ip}`, 30, 15 * 60)) && (await rateLimit(`login:email:${email.data}`, 10, 15 * 60));
  if (!allowed) return { error: TOO_MANY, email: email.data };

  const [user] = await db.select().from(users).where(eq(users.email, email.data));
  // Hash anyway when the user doesn't exist, so response time doesn't reveal registered emails.
  // If there is a user, check the password. If not, `(await hashPassword(password), false)` does the same slow
  // work (a comma expression: run the first part, then use the second part, `false`, as the value).
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
  if (!user || !ok) return invalid;

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

/**
 * Kind: server action (async function), used by the "Log out" button.
 * Parameters: none. Ends the session and goes to the home page.
 */
export async function logout() {
  await destroySession();
  redirect("/");
}

/**
 * A visitor account can become a provider account (it still needs an approved claim to edit a profile).
 * Kind: server action (async function). Parameters: none; works on the logged-in user.
 */
export async function becomeProvider() {
  // Sends anonymous visitors to the login page (see requireUser in session.ts).
  const user = await requireUser();
  // UPDATE users SET account_type = 'provider' WHERE id = <user>
  await db.update(users).set({ accountType: "provider" }).where(eq(users.id, user.id));
  // The account page shows different content for providers, so its cached copy must be refreshed.
  revalidatePath("/account");
  // "#claim" jumps to the "claim your company" section of the account page.
  redirect("/account#claim");
}

// ---------------------------------------------------------------- password reset

/** Kind: constant. A reset link stays valid for 60 minutes. */
const RESET_MINUTES = 60;
/** Kind: arrow function. SHA-256 fingerprint of a reset token; only the fingerprint is stored (as for sessions). */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Kind: server action (async function), used by the "Forgot password" form.
 * Emails a one-time link containing a random token.
 * @param _prev     type `AuthFormState` — unused previous state.
 * @param formData  type `FormData` — field "email".
 * @returns         `Promise<AuthFormState>`: always the same friendly message once the email looks valid.
 */
export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  // Same reply whether or not the account exists (so this form cannot be used to test email addresses).
  const generic = { ok: "If an account exists for this email, we've sent a link to reset the password." };
  if (!email.success) return { fieldErrors: { email: "Enter a valid email" } };
  // At most 5 reset requests per IP address per hour.
  if (!(await rateLimit(`reset:${await clientIp()}`, 5, 60 * 60))) return { error: TOO_MANY };

  const [user] = await db.select().from(users).where(eq(users.email, email.data));
  if (!user) return generic; // don't reveal which emails are registered

  // The raw token goes only into the email link; the database keeps its hash and an expiry time.
  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({
    id: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
  });
  // Send the "password-reset" email template. `related` links the email to the user in the console's email log.
  // `sensitive: true` = the log keeps the subject but not the body, because the body contains the secret link.
  await sendEmail({
    to: user.email,
    toName: user.name,
    template: "password-reset",
    props: { name: user.name, resetUrl: `${siteUrl()}/account/reset?token=${token}` },
    related: { entity: "users", id: user.id },
    sensitive: true,
  });
  return generic;
}

/**
 * Kind: server action (async function), used by the "Choose a new password" page the email link opens.
 * @param _prev     type `AuthFormState` — unused previous state.
 * @param formData  type `FormData` — hidden field "token" (from the link) and the new "password".
 * @returns         `Promise<AuthFormState>` with an error, or redirects to the account page on success.
 */
export async function resetPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");
  const password = passwordSchema.safeParse(formData.get("password"));
  // `issues[0]!` = the first problem; the `!` tells TypeScript "this exists" (a failed parse always has one).
  if (!password.success) return { fieldErrors: { password: password.error.issues[0]!.message } };

  // Find a reset row that matches the token's hash, has not been used yet, and has not expired.
  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.id, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  if (!reset) return { error: "This reset link is invalid or has expired. Request a new one." };

  // Store the new password's hash, then mark the link as used so it cannot be used twice.
  await db.update(users).set({ passwordHash: await hashPassword(password.data) }).where(eq(users.id, reset.userId));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
  // Sign out every existing session, then sign in here.
  // (If someone else had got into the account, they are thrown out.)
  await db.delete(sessions).where(eq(sessions.userId, reset.userId));
  await createSession(reset.userId);
  redirect("/account");
}
