import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { NewListingForm, ReportUploadForm } from "@/components/admin-forms";
import { Panel } from "@/components/marketing";
import { getClaimsForReview, getPendingReviews } from "@/db/account-queries";
import { db } from "@/db/index";
import { reports, rfiRequests } from "@/db/schema";
import { approveClaim, deleteReport, rejectClaim, updateReportVisibility } from "@/lib/admin-actions";
import { requireAdmin } from "@/lib/auth/session";
import { approveReview, rejectReview } from "@/lib/review-actions";
import { categoryLabel } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const TYPE_LABEL: Record<string, string> = {
  rfi: "Quote request",
  advisory: "Advisory",
  data: "Data services",
  awards: "Awards",
  claim: "Provider contact",
};

export default async function AdminPage() {
  await requireAdmin();
  const [claims, pendingReviews, uploaded, requests] = await Promise.all([
    getClaimsForReview(),
    getPendingReviews(),
    db
      .select({ id: reports.id, slug: reports.slug, title: reports.title, period: reports.period, visibility: reports.visibility, fileSize: reports.fileSize })
      .from(reports)
      .orderBy(desc(reports.createdAt)),
    db.select().from(rfiRequests).orderBy(desc(rfiRequests.createdAt)).limit(50),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Admin</h1>

      <Panel>
        <h2 className="text-sm font-semibold text-ink">Pending company claims ({claims.length})</h2>
        {claims.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing to review.</p>}
        <ul className="mt-3 divide-y divide-slate-100">
          {claims.map((c) => (
            <li key={c.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">
                    {c.providerName ?? (
                      <>
                        New listing: {c.proposedName}{" "}
                        {c.proposedWebsite && (
                          <a href={c.proposedWebsite} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-700 hover:underline">
                            {c.proposedWebsite}
                          </a>
                        )}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-ink-600">
                    {c.userName} · {c.userEmail} · {c.jobTitle}
                    {c.proposedCategory && ` · ${categoryLabel(c.proposedCategory)}`}
                  </p>
                  {c.message && <p className="mt-1 text-xs text-slate-500">“{c.message}”</p>}
                  <p className="mt-1 text-[11px] text-slate-400">
                    Check that the email domain matches the company before approving.
                  </p>
                </div>
                <div className="flex gap-2">
                  {c.providerId && (
                    <form action={approveClaim}>
                      <input type="hidden" name="claimId" value={c.id} />
                      <button className="rounded-md bg-emerald px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                        Approve
                      </button>
                    </form>
                  )}
                  <form action={rejectClaim}>
                    <input type="hidden" name="claimId" value={c.id} />
                    <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-slate-50">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
              {!c.providerId && <NewListingForm claimId={c.id} category={c.proposedCategory} />}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <h2 className="text-sm font-semibold text-ink">Client reviews to verify ({pendingReviews.length})</h2>
        <p className="mt-1 text-xs text-slate-500">
          Email the reviewer at their work address and confirm the client relationship before approving. Approving
          publishes the review anonymously and adds its overall score to the Peer Opinion Score.
        </p>
        {pendingReviews.length === 0 && <p className="mt-2 text-sm text-slate-500">Nothing to verify.</p>}
        <ul className="mt-3 divide-y divide-slate-100">
          {pendingReviews.map(({ review: r, providerName, providerSlug }) => (
            <li key={r.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 max-w-3xl">
                  <p className="font-medium text-ink">
                    <a href={`/providers/${providerSlug}`} className="hover:underline">
                      {providerName}
                    </a>{" "}
                    · {r.overall}/5 · “{r.title}”
                  </p>
                  <p className="text-xs text-ink-600">
                    {r.reviewerName} ·{" "}
                    <a href={`mailto:${r.reviewerEmail}`} className="text-emerald-700 hover:underline">
                      {r.reviewerEmail}
                    </a>{" "}
                    · {r.reviewerRole}, {r.reviewerCompany} · {r.relationship}
                    {r.clientSince && ` since ${r.clientSince}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Evidence: {r.evidence}</p>
                  {r.flags.map((f) => (
                    <p key={f} className="mt-1 text-[11px] font-medium text-amber-700">⚠ {f}</p>
                  ))}
                  <p className="mt-1 line-clamp-3 text-xs text-ink-600">{r.body}</p>
                </div>
                <div className="flex gap-2">
                  <form action={approveReview}>
                    <input type="hidden" name="reviewId" value={r.id} />
                    <button className="rounded-md bg-emerald px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                      Verified: publish
                    </button>
                  </form>
                  <form action={rejectReview}>
                    <input type="hidden" name="reviewId" value={r.id} />
                    <button className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-slate-50">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <h2 className="text-sm font-semibold text-ink">Data Intelligence reports</h2>
        <p className="mt-1 mb-4 text-xs text-slate-500">
          The two built-in reports (Market Snapshot, public; Provider Intelligence, private) are generated live. Upload
          extra PDFs here.
        </p>
        <ReportUploadForm />
        {uploaded.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
            {uploaded.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <a href={`/data-intelligence/reports/${r.slug}`} className="font-medium text-ink hover:underline">
                    {r.title}
                  </a>{" "}
                  <span className="text-xs text-slate-500">
                    {r.period} · {Math.round(r.fileSize / 1024)} KB
                  </span>
                </span>
                <span className="flex gap-2">
                  <form action={updateReportVisibility}>
                    <input type="hidden" name="reportId" value={r.id} />
                    <input type="hidden" name="visibility" value={r.visibility === "public" ? "private" : "public"} />
                    <button className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-slate-50">
                      {r.visibility === "public" ? "Public → make private" : "Private → make public"}
                    </button>
                  </form>
                  <form action={deleteReport}>
                    <input type="hidden" name="reportId" value={r.id} />
                    <button className="rounded-md border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="overflow-hidden p-0">
        <h2 className="px-5 pt-5 text-sm font-semibold text-ink">Latest requests (50)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-canvas text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">When</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Interested in</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="tnum px-5 py-2 whitespace-nowrap text-slate-500">{dateFmt.format(r.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABEL[r.requestType] ?? r.requestType}</td>
                  <td className="px-3 py-2">
                    {r.contactName}
                    <br />
                    <a href={`mailto:${r.email}`} className="text-emerald-700 hover:underline">
                      {r.email}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    {r.company}
                    {r.fundStructure && <span className="block text-slate-400">{r.fundStructure}</span>}
                  </td>
                  <td className="px-3 py-2">{r.servicesNeeded.join(", ")}</td>
                  <td className="max-w-xs px-3 py-2 text-ink-600">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-xs text-slate-500">
        Accounts: create admins or reset passwords with <code className="font-mono">npm run admin</code> (see README).{" "}
        <Link href="/account" className="text-emerald-700 hover:underline">
          My account
        </Link>
      </p>
    </main>
  );
}
