import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { BUILT_IN_REPORTS, currentQuarter } from "@/content/reports";
import { db } from "@/db/index";
import { getMarketStats } from "@/db/queries";
import { reports } from "@/db/schema";
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
  if (isPrivate && !(await canAccessPrivateReports(await getCurrentUser()))) {
    const login = new URL(`/account/login?next=${encodeURIComponent("/data-intelligence#reports")}`, req.url);
    return NextResponse.redirect(login);
  }

  if (builtIn) {
    const pdf = await renderReportPdf(builtIn, await getMarketStats());
    return pdfResponse(pdf, `fundhub-${builtIn.slug}-${currentQuarter().replace(" ", "-").toLowerCase()}.pdf`, isPrivate);
  }
  return pdfResponse(uploaded!.pdf, `fundhub-${uploaded!.slug}.pdf`, isPrivate);
}
