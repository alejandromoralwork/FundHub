"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/index";
import { users } from "@/db/schema";
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

export type AuthFormState = { error?: string; fieldErrors?: Record<string, string>; email?: string; name?: string };

/** Only allow same-site relative redirects after login. */
function safeNext(raw: FormDataEntryValue | null): string {
  const next = typeof raw === "string" ? raw : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/account";
}

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email").max(200);

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: emailSchema,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(200, "Password is too long"),
});

function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const echo = { email: String(formData.get("email") ?? ""), name: String(formData.get("name") ?? "") };
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues), ...echo };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
  if (existing) return { error: "An account with this email already exists. Log in instead.", ...echo };

  const [user] = await db
    .insert(users)
    .values({ name: parsed.data.name, email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password) })
    .returning({ id: users.id });
  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const invalid = { error: "Incorrect email or password.", email: String(formData.get("email") ?? "") };
  if (!email.success || !password) return invalid;

  const [user] = await db.select().from(users).where(eq(users.email, email.data));
  // Hash anyway when the user doesn't exist, so response time doesn't reveal registered emails.
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : (await hashPassword(password), false);
  if (!user || !ok) return invalid;

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  await destroySession();
  redirect("/");
}
