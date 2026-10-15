import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { TOTP, Secret } from "otpauth";
import type { StaffRole } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { staffSessions, staffUsers, type StaffUser } from "@fundhub/db/schema";

const COOKIE = "fh_staff";
/** Short sessions: this is an internal tool with access to everything. */
const SESSION_HOURS = 12;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export type Staff = Pick<StaffUser, "id" | "email" | "name" | "role" | "totpEnabled">;
type SessionInfo = { staff: Staff; sessionId: string; mfaPassed: boolean };

export async function createStaffSession(staffUserId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.insert(staffSessions).values({ id: hashToken(token), staffUserId, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    // basePath: the cookie never reaches the public website's routes.
    path: "/admin",
    expires: expiresAt,
  });
}

export async function destroyStaffSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(staffSessions).where(eq(staffSessions.id, hashToken(token)));
  jar.delete({ name: COOKIE, path: "/admin" });
}

export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
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
  if (!row || !row.active) return null;
  const { sessionId, mfaPassed, active: _a, ...staff } = row;
  return { staff, sessionId, mfaPassed };
});

/** Fully authenticated staff (password + TOTP), optionally restricted to roles. */
export async function requireStaff(roles?: readonly StaffRole[]): Promise<Staff> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.mfaPassed) redirect("/login/mfa");
  if (roles && !roles.includes(s.staff.role)) redirect("/?denied=1");
  return s.staff;
}

export async function markMfaPassed(sessionId: string) {
  await db.update(staffSessions).set({ mfaPassed: true }).where(eq(staffSessions.id, sessionId));
}

// ---------------------------------------------------------------- TOTP

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secret: string, label: string) {
  return new TOTP({ issuer: "FundHub Admin", label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

export function totpUri(secret: string, email: string): string {
  return totp(secret, email).toString();
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return totp(secret, "x").validate({ token: clean, window: 1 }) !== null;
}

// ---------------------------------------------------------------- roles

/** Who can do what. Owners can do everything. */
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

export function can(staff: Staff, action: keyof typeof CAN): boolean {
  return (CAN[action] as readonly StaffRole[]).includes(staff.role);
}
