import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { auditLog, staffUsers } from "@fundhub/db/schema";
import { AuditView, type AuditRow } from "@/components/ops-views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requireStaff(["owner", "operations", "analyst"]);
  const rows = await db
    .select({ id: auditLog.id, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, changes: auditLog.changes, staffName: staffUsers.name, createdAt: auditLog.createdAt })
    .from(auditLog)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLog.staffUserId))
    .orderBy(desc(auditLog.createdAt))
    .limit(1000);
  return <AuditView rows={JSON.parse(JSON.stringify(rows)) as AuditRow[]} />;
}
