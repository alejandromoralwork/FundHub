"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PASSWORD_MIN_LENGTH } from "@fundhub/core/password-rules";
import { hashPassword, verifyPassword } from "@fundhub/core/password";
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
import { staffPasswordResets, staffSessions, staffUsers } from "@fundhub/db/schema";
import { sendEmail } from "@fundhub/email/send";
import { audit } from "./audit";
import { getSession, requireStaff, verifyTotp } from "./auth";
import { websiteUrl } from "./site";

export type AccountState = { error?: string; ok?: string };

const RESET_MINUTES = 60;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Shared rules for a new password; null when it's acceptable. */
function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password !== confirm) return "The two new passwords don't match.";
  return null;
}

/** Signs the member out of every other browser, keeping the current session. */
async function endOtherSessions(staffUserId: number) {
  const s = await getSession();
  await db
    .delete(staffSessions)
    .where(s ? and(eq(staffSessions.staffUserId, staffUserId), ne(staffSessions.id, s.sessionId)) : eq(staffSessions.staffUserId, staffUserId));
}

async function checkCurrentPassword(staffUserId: number, password: string): Promise<boolean> {
  const [user] = await db.select({ passwordHash: staffUsers.passwordHash }).from(staffUsers).where(eq(staffUsers.id, staffUserId));
  return !!user && (await verifyPassword(password, user.passwordHash));
}

// ---------------------------------------------------------------- signed in: account security

export async function changeOwnPassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const staff = await requireStaff();
  if (!(await rateLimit(`staff-account:${staff.id}`, 10, 15 * 60))) return { error: "Too many attempts. Wait 15 minutes." };

  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const problem = newPasswordError(password, String(formData.get("confirm") ?? ""));
  if (problem) return { error: problem };
  if (!(await checkCurrentPassword(staff.id, current))) return { error: "Your current password is incorrect." };
  if (current === password) return { error: "Choose a password different from the current one." };

  await db.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, staff.id));
  await endOtherSessions(staff.id);
  await audit(staff, "change-password", "staff_users", staff.id);
  return { ok: "Password changed. Other browsers were signed out." };
}

/** Moves two-factor to a new authenticator app: needs the password and a code from the new app. */
export async function changeOwnTotp(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const staff = await requireStaff();
  if (!(await rateLimit(`staff-account:${staff.id}`, 10, 15 * 60))) return { error: "Too many attempts. Wait 15 minutes." };

  const secret = String(formData.get("secret") ?? "");
  if (!(await checkCurrentPassword(staff.id, String(formData.get("current") ?? "")))) return { error: "Your password is incorrect." };
  if (!secret || !verifyTotp(secret, String(formData.get("code") ?? ""))) {
    return { error: "That code didn't match. Scan the new QR code, then enter the code shown in the app." };
  }

  await db.update(staffUsers).set({ totpSecret: secret, totpEnabled: true }).where(eq(staffUsers.id, staff.id));
  await endOtherSessions(staff.id);
  await audit(staff, "change-2fa", "staff_users", staff.id);
  return { ok: "Two-factor moved to your new app. Codes from the old app no longer work." };
}

// ---------------------------------------------------------------- signed out: forgotten password

export async function requestStaffPasswordReset(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const generic = { ok: "If a staff account exists for this email, we've sent a link to reset the password. It expires in 1 hour." };
  if (!email.includes("@")) return { error: "Enter your work email." };
  if (!(await rateLimit(`staff-reset:${await ip()}`, 5, 60 * 60))) return { error: "Too many requests. Try again in an hour." };

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  if (!user || !user.active) return generic; // never reveal which emails are staff

  const token = randomBytes(32).toString("base64url");
  await db.insert(staffPasswordResets).values({
    id: hashToken(token),
    staffUserId: user.id,
    expiresAt: new Date(Date.now() + RESET_MINUTES * 60 * 1000),
  });
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

export async function resetStaffPassword(_prev: AccountState, formData: FormData): Promise<AccountState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const problem = newPasswordError(password, String(formData.get("confirm") ?? ""));
  if (problem) return { error: problem };

  const [reset] = await db
    .select()
    .from(staffPasswordResets)
    .where(and(eq(staffPasswordResets.id, hashToken(token)), isNull(staffPasswordResets.usedAt), gt(staffPasswordResets.expiresAt, new Date())));
  if (!reset) return { error: "This reset link is invalid or has expired. Request a new one." };

  await db.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, reset.staffUserId));
  await db.update(staffPasswordResets).set({ usedAt: new Date() }).where(eq(staffPasswordResets.id, reset.id));
  // Sign out everywhere; the next login still asks for the two-factor code.
  await db.delete(staffSessions).where(eq(staffSessions.staffUserId, reset.staffUserId));
  const [user] = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name, role: staffUsers.role, totpEnabled: staffUsers.totpEnabled })
    .from(staffUsers)
    .where(eq(staffUsers.id, reset.staffUserId));
  if (user) await audit(user, "reset-password-by-email", "staff_users", user.id);
  redirect("/login?reset=1");
}
