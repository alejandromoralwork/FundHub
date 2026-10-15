"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACCOUNT_TYPES } from "@fundhub/core/enums";
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "@fundhub/core/password";
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
import { passwordResets, sessions, users } from "@fundhub/db/schema";
import { sendEmail } from "@fundhub/email/send";
import { clientIp } from "../client-ip";
import { siteUrl } from "../site";
import { createSession, destroySession, requireUser } from "./session";

export type AuthFormState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
  email?: string;
  name?: string;
};

/** Only allow same-site relative redirects after login. */
function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === "string" ? raw : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(200);
const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, "Password is too long");

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: emailSchema,
  password: passwordSchema,
  accountType: z.enum(ACCOUNT_TYPES, { message: "Choose an account type" }),
  company: z.string().trim().max(160).default(""),
  newsletterOptIn: z.literal("on").optional(),
});

function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const echo = { email: String(formData.get("email") ?? ""), name: String(formData.get("name") ?? "") };
  if (!(await rateLimit(`signup:${await clientIp()}`, 10, 60 * 60))) return { error: TOO_MANY, ...echo };

  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues), ...echo };
  const d = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email));
  if (existing) return { error: "An account with this email already exists. Log in instead.", ...echo };

  const [user] = await db
    .insert(users)
    .values({
      name: d.name,
      email: d.email,
      passwordHash: await hashPassword(d.password),
      accountType: d.accountType,
      company: d.company,
      newsletterOptIn: d.newsletterOptIn === "on",
    })
    .returning({ id: users.id });
  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const invalid = { error: "Incorrect email or password.", email: String(formData.get("email") ?? "") };
  if (!email.success || !password) return invalid;

  // Per IP and per account, so neither spraying nor targeted guessing scales.
  const ip = await clientIp();
  const allowed = (await rateLimit(`login:ip:${ip}`, 30, 15 * 60)) && (await rateLimit(`login:email:${email.data}`, 10, 15 * 60));
  if (!allowed) return { error: TOO_MANY, email: email.data };

  const [user] = await db.select().from(users).where(eq(users.email, email.data));
  // Hash anyway when the user doesn't exist, so response time doesn't reveal registered emails.
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
  if (!user || !ok) return invalid;

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  await destroySession();
  redirect("/");
}

/** A visitor account can become a provider account (it still needs an approved claim to edit a profile). */
export async function becomeProvider() {
  const user = await requireUser();
  await db.update(users).set({ accountType: "provider" }).where(eq(users.id, user.id));
  revalidatePath("/account");
  redirect("/account#claim");
}

// ---------------------------------------------------------------- password reset

const RESET_MINUTES = 60;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const generic = { ok: "If an account exists for this email, we've sent a link to reset the password." };
  if (!email.success) return { fieldErrors: { email: "Enter a valid email" } };
  if (!(await rateLimit(`reset:${await clientIp()}`, 5, 60 * 60))) return { error: TOO_MANY };

  const [user] = await db.select().from(users).where(eq(users.email, email.data));
  if (!user) return generic; // don't reveal which emails are registered

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({
    id: hashToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
  });
  await sendEmail({
    to: user.email,
    toName: user.name,
    template: "password-reset",
    props: { name: user.name, resetUrl: `${siteUrl()}/account/reset?token=${token}` },
    related: { entity: "users", id: user.id },
  });
  return generic;
}

export async function resetPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { fieldErrors: { password: password.error.issues[0]!.message } };

  const [reset] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.id, hashToken(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  if (!reset) return { error: "This reset link is invalid or has expired. Request a new one." };

  await db.update(users).set({ passwordHash: await hashPassword(password.data) }).where(eq(users.id, reset.userId));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, reset.id));
  // Sign out every existing session, then sign in here.
  await db.delete(sessions).where(eq(sessions.userId, reset.userId));
  await createSession(reset.userId);
  redirect("/account");
}
