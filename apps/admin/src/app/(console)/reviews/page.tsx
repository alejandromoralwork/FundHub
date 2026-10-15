import type { Metadata } from "next";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { emailMessages, providers, reviews } from "@fundhub/db/schema";
import { ReviewsView, type ReviewRow } from "@/components/moderation-views";
import { CAN, requireStaff } from "@/lib/auth";
import { websiteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Client reviews" };

export default async function ReviewsPage() {
  await requireStaff(CAN.moderate);
  const base = () =>
    db
      .select({ review: reviews, providerName: providers.name, providerSlug: providers.slug })
      .from(reviews)
      .innerJoin(providers, eq(providers.id, reviews.providerId));
  const [pending, recent] = await Promise.all([
    base().where(eq(reviews.status, "pending")).orderBy(reviews.createdAt),
    base().where(ne(reviews.status, "pending")).orderBy(desc(reviews.reviewedAt)).limit(50),
  ]);
  const ids = pending.map((p) => String(p.review.id));
  const sent = ids.length
    ? await db
        .select({ id: emailMessages.relatedId })
        .from(emailMessages)
        .where(and(eq(emailMessages.relatedEntity, "reviews"), eq(emailMessages.template, "review-verification"), inArray(emailMessages.relatedId, ids)))
    : [];
  const sentIds = new Set(sent.map((s) => s.id));

  const rows = (list: typeof pending): ReviewRow[] =>
    JSON.parse(
      JSON.stringify(
        list.map(({ review: r, providerName, providerSlug }) => ({
          ...r,
          providerName,
          providerSlug,
          loggedIn: r.userId !== null,
          verificationSent: sentIds.has(String(r.id)),
        })),
      ),
    );
  return <ReviewsView pending={rows(pending)} recent={rows(recent)} websiteUrl={websiteUrl()} />;
}
