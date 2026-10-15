import type { Metadata } from "next";
import { db } from "@fundhub/db/client";
import { staffUsers } from "@fundhub/db/schema";
import { StaffView, type StaffRow } from "@/components/ops-views";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage() {
  const me = await requireStaff(CAN.staff);
  const rows = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name, role: staffUsers.role, totpEnabled: staffUsers.totpEnabled, active: staffUsers.active, lastLoginAt: staffUsers.lastLoginAt })
    .from(staffUsers)
    .orderBy(staffUsers.name);
  return <StaffView staff={JSON.parse(JSON.stringify(rows)) as StaffRow[]} meId={me.id} />;
}
