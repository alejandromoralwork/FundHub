"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { REPORT_VISIBILITY, STAFF_ROLES } from "@fundhub/core/enums";
import { slugify } from "@fundhub/core/format";
import { hashPassword } from "@fundhub/core/password";
import { db } from "@fundhub/db/client";
import { reports, staffSessions, staffUsers } from "@fundhub/db/schema";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

export type ActionResult = { ok?: string; error?: string; secret?: string };

// ---------------------------------------------------------------- reports

const MAX_PDF_BYTES = 4 * 1024 * 1024;
const reportSchema = z.object({
  title: z.string().trim().min(3, "Add a title").max(160),
  period: z.string().trim().min(2, "Add a period, e.g. Q4 2026").max(40),
  summary: z.string().trim().max(600).default(""),
  visibility: z.enum(REPORT_VISIBILITY),
});

export async function uploadReport(formData: FormData): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF file." };
  if (file.size > MAX_PDF_BYTES) return { error: "PDF must be 4 MB or smaller." };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "That file isn't a PDF." };

  const slug = `${slugify(`${parsed.data.title} ${parsed.data.period}`)}-${Date.now().toString(36)}`;
  const [row] = await db.insert(reports).values({ ...parsed.data, slug, pdf: buf, fileSize: buf.length }).returning({ id: reports.id });
  await audit(staff, "upload", "reports", row.id, { title: parsed.data.title, visibility: parsed.data.visibility, bytes: buf.length });
  revalidatePath("/reports");
  return { ok: `Uploaded "${parsed.data.title}". It's now listed on the website's Data Intelligence page.` };
}

export async function setReportVisibility(id: number, visibility: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  const v = z.enum(REPORT_VISIBILITY).parse(visibility);
  await db.update(reports).set({ visibility: v }).where(eq(reports.id, id));
  await audit(staff, "update", "reports", id, { visibility: v });
  revalidatePath("/reports");
  return { ok: `Report is now ${v}.` };
}

export async function deleteReport(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  await db.delete(reports).where(eq(reports.id, id));
  await audit(staff, "delete", "reports", id);
  revalidatePath("/reports");
  return { ok: "Report deleted." };
}

// ---------------------------------------------------------------- staff

const staffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  role: z.enum(STAFF_ROLES),
});

/** Returns the temporary password once; the new member sets up 2FA at first login. */
export async function createStaff(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.staff);
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a name, a valid email and a role." };
  const [exists] = await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, parsed.data.email));
  if (exists) return { error: "A staff account with this email already exists." };
  const password = randomBytes(12).toString("base64url");
  const [row] = await db.insert(staffUsers).values({ ...parsed.data, passwordHash: await hashPassword(password) }).returning({ id: staffUsers.id });
  await audit(staff, "create", "staff_users", row.id, { email: parsed.data.email, role: parsed.data.role });
  revalidatePath("/staff");
  return { ok: `Created ${parsed.data.email}. Share the temporary password securely.`, secret: password };
}

export async function updateStaff(id: number, changes: { role?: string; active?: boolean; resetMfa?: boolean; resetPassword?: boolean }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.staff);
  if (id === staff.id && (changes.active === false || (changes.role && changes.role !== "owner"))) {
    return { error: "You can't deactivate or demote yourself." };
  }
  const set: Partial<typeof staffUsers.$inferInsert> = {};
  if (changes.role) set.role = z.enum(STAFF_ROLES).parse(changes.role);
  if (changes.active !== undefined) set.active = changes.active;
  if (changes.resetMfa) Object.assign(set, { totpEnabled: false, totpSecret: null });
  let password: string | undefined;
  if (changes.resetPassword) {
    password = randomBytes(12).toString("base64url");
    set.passwordHash = await hashPassword(password);
  }
  await db.update(staffUsers).set(set).where(eq(staffUsers.id, id));
  // Any security-relevant change signs the member out everywhere.
  if (changes.active === false || changes.resetMfa || changes.resetPassword) {
    await db.delete(staffSessions).where(eq(staffSessions.staffUserId, id));
  }
  await audit(staff, "update", "staff_users", id, { ...changes });
  revalidatePath("/staff");
  return { ok: "Saved.", secret: password };
}
