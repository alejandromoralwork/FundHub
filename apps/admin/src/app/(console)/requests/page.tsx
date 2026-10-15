import type { Metadata } from "next";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { REQUEST_TYPES, RFI_STATUSES } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { providers, rfiRequests, staffUsers } from "@fundhub/db/schema";
import { InboxView, type RequestRow } from "@/components/comms-views";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Inbox" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string }> }) {
  await requireStaff(CAN.email);
  const { type, status } = await searchParams;
  const conds: SQL[] = [];
  if (type && (REQUEST_TYPES as readonly string[]).includes(type)) conds.push(eq(rfiRequests.requestType, type as never));
  if (status && (RFI_STATUSES as readonly string[]).includes(status)) conds.push(eq(rfiRequests.status, status as never));

  const rows = await db
    .select({
      id: rfiRequests.id,
      requestType: rfiRequests.requestType,
      contactName: rfiRequests.contactName,
      email: rfiRequests.email,
      company: rfiRequests.company,
      fundStructure: rfiRequests.fundStructure,
      aumBand: rfiRequests.aumBand,
      servicesNeeded: rfiRequests.servicesNeeded,
      message: rfiRequests.message,
      status: rfiRequests.status,
      internalNotes: rfiRequests.internalNotes,
      crmRef: rfiRequests.crmRef,
      assignedName: staffUsers.name,
      providerName: providers.name,
      createdAt: rfiRequests.createdAt,
    })
    .from(rfiRequests)
    .leftJoin(staffUsers, eq(staffUsers.id, rfiRequests.assignedTo))
    .leftJoin(providers, eq(providers.id, rfiRequests.providerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(rfiRequests.createdAt))
    .limit(500);
  return <InboxView rows={JSON.parse(JSON.stringify(rows)) as RequestRow[]} filters={{ type, status }} />;
}
