import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { gdprRequests } from "@fundhub/db/schema";
import { GdprView, type GdprRow } from "@/components/gdpr-view";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "GDPR requests" };

export default async function GdprPage() {
  await requireStaff(CAN.gdpr);
  const rows = await db.select().from(gdprRequests).orderBy(asc(gdprRequests.dueAt));
  return <GdprView rows={JSON.parse(JSON.stringify(rows)) as GdprRow[]} />;
}
