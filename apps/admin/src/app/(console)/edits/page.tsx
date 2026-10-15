import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { profileEdits, providers, users } from "@fundhub/db/schema";
import { EditsView, type EditRow } from "@/components/moderation-views";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Provider self-edits" };

export default async function EditsPage() {
  await requireStaff(CAN.moderate);
  const rows = await db
    .select({ id: profileEdits.id, providerId: providers.id, providerName: providers.name, userName: users.name, changes: profileEdits.changes, createdAt: profileEdits.createdAt })
    .from(profileEdits)
    .innerJoin(providers, eq(providers.id, profileEdits.providerId))
    .leftJoin(users, eq(users.id, profileEdits.userId))
    .orderBy(desc(profileEdits.createdAt))
    .limit(200);
  return <EditsView edits={JSON.parse(JSON.stringify(rows)) as EditRow[]} />;
}
