"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, verifyPassword } from "@fundhub/core/password";
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
import { staffUsers } from "@fundhub/db/schema";
import { createStaffSession, destroyStaffSession, getSession, markMfaPassed, verifyTotp } from "./auth";

export type LoginState = { error?: string };

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function staffLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!(await rateLimit(`staff-login:${await ip()}`, 10, 15 * 60))) {
    return { error: "Too many attempts. Wait 15 minutes." };
  }
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  const ok = user ? await verifyPassword(password, user.passwordHash) : (await hashPassword(password), false);
  if (!user || !ok || !user.active) return { error: "Incorrect email or password." };

  await createStaffSession(user.id);
  redirect("/login/mfa");
}

/** Second step: verify the TOTP code, or confirm enrolment on first login. */
export async function staffMfa(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await rateLimit(`staff-mfa:${session.staff.id}`, 10, 15 * 60))) return { error: "Too many attempts. Log in again later." };

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.id, session.staff.id));
  const code = String(formData.get("code") ?? "");
  const enrolSecret = String(formData.get("secret") ?? "");
  const secret = user.totpEnabled ? user.totpSecret : enrolSecret;
  if (!secret || !verifyTotp(secret, code)) return { error: "That code didn't match. Check your authenticator app's clock." };

  if (!user.totpEnabled) {
    await db.update(staffUsers).set({ totpSecret: secret, totpEnabled: true }).where(eq(staffUsers.id, user.id));
  }
  await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));
  await markMfaPassed(session.sessionId);
  redirect("/");
}

export async function staffLogout() {
  await destroyStaffSession();
  redirect("/login");
}
