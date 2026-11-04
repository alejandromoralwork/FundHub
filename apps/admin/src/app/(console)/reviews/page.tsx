/**
 * FILE: apps/admin/src/app/(console)/reviews/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Client reviews" moderation page. It loads reviews waiting for a decision (oldest first)
 *   and the 50 most recently decided ones. For each pending review it also works out whether the reviewer
 *   was logged in and whether a "please verify your review" email has already been sent.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; ReviewsView runs in
 *   the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/reviews = the URL /admin/reviews ("(console)" is a route group).
 * TYPESCRIPT YOU WILL SEE HERE: arrow functions, `Promise.all`, ternaries, `Set`, `typeof pending` (reuse
 *   the type of an existing variable), return-type annotations `(…): ReviewRow[] =>`, object spread
 *   `{ ...r }`, renaming while destructuring `{ review: r }`, `!==`, `String(...)`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `and`, `desc`, `eq`, `inArray` (value IN list), `ne` (not equal).
import { and, desc, eq, inArray, ne } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and tables.
import { db } from "@fundhub/db/client";
import { emailMessages, providers, reviews } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The screen and the type of one review row.
import { ReviewsView, type ReviewRow } from "@/components/moderation-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";
// The public website's address, for links to the provider pages.
import { websiteUrl } from "@/lib/site";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Client reviews" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the reviews screen markup.
 */
export default async function ReviewsPage() {
  // Moderators only (owner, operations).
  await requireStaff(CAN.moderate);
  // Shared query start (an arrow function, so each call builds a fresh query): every review column under
  // `review`, plus the provider's name and URL slug.
  const base = () =>
    db
      .select({ review: reviews, providerName: providers.name, providerSlug: providers.slug })
      .from(reviews)
      .innerJoin(providers, eq(providers.id, reviews.providerId));
  // Pending (oldest first) and recently decided (latest 50), fetched together.
  const [pending, recent] = await Promise.all([
    base().where(eq(reviews.status, "pending")).orderBy(reviews.createdAt),
    base().where(ne(reviews.status, "pending")).orderBy(desc(reviews.reviewedAt)).limit(50),
  ]);
  // The pending review ids as text (`String(...)`), because the email log stores related ids as text.
  const ids = pending.map((p) => String(p.review.id));
  // Which of those reviews already have a verification email logged? Only query if there are ids.
  const sent = ids.length
    ? await db
        .select({ id: emailMessages.relatedId })
        .from(emailMessages)
        .where(and(eq(emailMessages.relatedEntity, "reviews"), eq(emailMessages.template, "review-verification"), inArray(emailMessages.relatedId, ids)))
    : [];
  // A Set of those ids for quick "has it?" checks.
  const sentIds = new Set(sent.map((s) => s.id));

  // Helper that turns either list into ReviewRow[] for the screen.
  // `list: typeof pending` = "same type as the `pending` variable"; `): ReviewRow[] =>` = it returns ReviewRow[].
  // `({ review: r, providerName, providerSlug })` unpacks each item and renames `review` to `r`.
  // `...r` copies every field of the review into the new object (spread), then extra fields are added:
  // - loggedIn: true when the review is linked to a website account (`!==` = "is not").
  // - verificationSent: true when a verification email was found above.
  // The JSON round-trip makes Dates into strings for the browser.
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
