import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@fundhub/db/client";
import { providerClaims, sessions, users, type User } from "@fundhub/db/schema";

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

export type SessionUser = Pick<User, "id" | "email" | "name" | "accountType">;

/** The logged-in account (visitor or provider), or null for anonymous visitors. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, accountType: users.accountType })
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

/** Providers this account may edit: its approved claims. Staff edit through the admin platform. */
export async function getManagedProviderIds(user: SessionUser): Promise<number[]> {
  if (user.accountType !== "provider") return [];
  const rows = await db
    .select({ id: providerClaims.providerId })
    .from(providerClaims)
    .where(and(eq(providerClaims.userId, user.id), eq(providerClaims.status, "approved")));
  return rows.map((r) => r.id).filter((id): id is number => id !== null);
}

export async function canManageProvider(user: SessionUser, providerId: number): Promise<boolean> {
  return (await getManagedProviderIds(user)).includes(providerId);
}

/** Private reports are for provider accounts with at least one approved company. */
/** Active Data Intelligence membership (paid via Stripe; checked by a database function, see migration 0004). */
export const hasDataMembership = cache(async (user: SessionUser | null): Promise<boolean> => {
  if (!user) return false;
  const { rows } = await db.execute<{ ok: boolean }>(sql`select has_data_membership(${user.id}) as ok`);
  return rows[0]?.ok === true;
});

/** Private reports: Data Intelligence members, and providers whose company claim was approved. */
export async function canAccessPrivateReports(user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  if (await hasDataMembership(user)) return true;
  return (await getManagedProviderIds(user)).length > 0;
}
