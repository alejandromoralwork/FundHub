import type { Metadata } from "next";
import { desc, eq, ne } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { providerClaims, providers, users } from "@fundhub/db/schema";
import { ClaimsView, type ClaimRow } from "@/components/moderation-views";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Company claims" };

const select = {
  id: providerClaims.id,
  status: providerClaims.status,
  jobTitle: providerClaims.jobTitle,
  message: providerClaims.message,
  proposedName: providerClaims.proposedName,
  proposedCategory: providerClaims.proposedCategory,
  proposedWebsite: providerClaims.proposedWebsite,
  createdAt: providerClaims.createdAt,
  reviewedAt: providerClaims.reviewedAt,
  providerId: providers.id,
  providerName: providers.name,
  providerSlug: providers.slug,
  providerWebsite: providers.website,
  userName: users.name,
  userEmail: users.email,
};

export default async function ClaimsPage() {
  await requireStaff(CAN.moderate);
  const base = () =>
    db.select(select).from(providerClaims).innerJoin(users, eq(users.id, providerClaims.userId)).leftJoin(providers, eq(providers.id, providerClaims.providerId));
  const [pending, recent] = await Promise.all([
    base().where(eq(providerClaims.status, "pending")).orderBy(providerClaims.createdAt),
    base().where(ne(providerClaims.status, "pending")).orderBy(desc(providerClaims.reviewedAt)).limit(50),
  ]);
  const plain = (rows: unknown) => JSON.parse(JSON.stringify(rows)) as ClaimRow[];
  return <ClaimsView pending={plain(pending)} recent={plain(recent)} />;
}
