import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/index";
import { providerClaims, sessions, users, type User } from "@/db/schema";

const COOKIE = "fh_session";
const SESSION_DAYS = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

export type SessionUser = Pick<User, "id" | "email" | "name" | "role">;

/** The logged-in account, or null for regular (anonymous) visitors. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
});

export async function requireUser(next = "/account"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/account/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  if (user.role !== "admin") redirect("/account");
  return user;
}

/** Providers this user may edit: approved claims (admins may edit any). */
export async function getManagedProviderIds(user: SessionUser): Promise<number[]> {
  const rows = await db
    .select({ id: providerClaims.providerId })
    .from(providerClaims)
    .where(and(eq(providerClaims.userId, user.id), eq(providerClaims.status, "approved")));
  return rows.map((r) => r.id).filter((id): id is number => id !== null);
}

export async function canManageProvider(user: SessionUser, providerId: number): Promise<boolean> {
  if (user.role === "admin") return true;
  return (await getManagedProviderIds(user)).includes(providerId);
}

/** Private reports are for approved provider accounts and admins. */
export async function canAccessPrivateReports(user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  if (user.role === "admin") return true;
  return (await getManagedProviderIds(user)).length > 0;
}
