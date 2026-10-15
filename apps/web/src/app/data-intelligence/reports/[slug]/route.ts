import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { BUILT_IN_REPORTS, currentQuarter } from "@/content/reports";
import { db } from "@fundhub/db/client";
import { getMarketStats } from "@fundhub/db/queries";
import { reportDownloads, reports } from "@fundhub/db/schema";
import { canAccessPrivateReports, getCurrentUser } from "@/lib/auth/session";
import { renderReportPdf } from "@/lib/report-pdf";

export const dynamic = "force-dynamic";

function pdfResponse(body: Uint8Array, filename: string, isPrivate: boolean) {
  return new NextResponse(Buffer.from(body), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      // Private reports must never be cached by shared caches.
      "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=3600",
    },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const builtIn = BUILT_IN_REPORTS.find((r) => r.slug === slug);
  const uploaded = builtIn ? undefined : (await db.select().from(reports).where(eq(reports.slug, slug)).limit(1))[0];
  if (!builtIn && !uploaded) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const isPrivate = (builtIn ?? uploaded)!.visibility === "private";
  const user = await getCurrentUser();
  if (isPrivate && !(await canAccessPrivateReports(user))) {
    // Signed in but not yet approved: the account page shows the claim status.
    const target = user ? "/account" : `/account/login?next=${encodeURIComponent("/data-intelligence#reports")}`;
    return NextResponse.redirect(new URL(target, req.url));
  }

  // Download analytics for the admin platform; never blocks the download.
  await db
    .insert(reportDownloads)
    .values({ reportSlug: slug, userId: user?.id ?? null })
    .catch((err) => console.error("Failed to log report download", err));

  if (builtIn) {
    const pdf = await renderReportPdf(builtIn, await getMarketStats());
    return pdfResponse(pdf, `fundhub-${builtIn.slug}-${currentQuarter().replace(" ", "-").toLowerCase()}.pdf`, isPrivate);
  }
  return pdfResponse(uploaded!.pdf, `fundhub-${uploaded!.slug}.pdf`, isPrivate);
}
