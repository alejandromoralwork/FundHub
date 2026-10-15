import type { Metadata } from "next";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { ingestJobs, ingestRecords, ingestRuns, providers, staffUsers } from "@fundhub/db/schema";
import { PipelineView, type JobRow, type RecordRow, type RunRow } from "@/components/pipeline-view";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Data pipeline" };

export default async function PipelinePage() {
  await requireStaff(CAN.pipeline);
  const [pending, runs, jobs, providerList] = await Promise.all([
    db
      .select({ r: ingestRecords, providerName: providers.name })
      .from(ingestRecords)
      .innerJoin(providers, eq(providers.id, ingestRecords.providerId))
      .where(eq(ingestRecords.status, "pending"))
      .orderBy(desc(ingestRecords.createdAt))
      .limit(100),
    db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(100),
    db
      .select({ id: ingestJobs.id, source: ingestJobs.source, providerName: providers.name, status: ingestJobs.status, requestedBy: staffUsers.name, error: ingestJobs.error, createdAt: ingestJobs.createdAt })
      .from(ingestJobs)
      .leftJoin(providers, eq(providers.id, ingestJobs.providerId))
      .leftJoin(staffUsers, eq(staffUsers.id, ingestJobs.requestedBy))
      .orderBy(desc(ingestJobs.createdAt))
      .limit(100),
    db.select({ id: providers.id, name: providers.name }).from(providers).where(eq(providers.status, "published")).orderBy(providers.name),
  ]);

  // Live values for the diff, fetched in one query.
  const ids = [...new Set(pending.map((p) => p.r.providerId!))];
  const live = ids.length ? await db.select().from(providers).where(inArray(providers.id, ids)) : [];
  const byId = new Map(live.map((p) => [p.id, p as unknown as Record<string, unknown>]));

  const records: RecordRow[] = pending.map(({ r, providerName }) => ({
    id: r.id,
    source: r.source,
    providerId: r.providerId!,
    providerName,
    sourceUrl: r.sourceUrl,
    extracted: r.extracted,
    current: Object.fromEntries(Object.keys(r.extracted).map((k) => [k, byId.get(r.providerId!)?.[k] ?? null])),
    raw: r.raw ? { mock: (r.raw as { mock?: boolean }).mock ?? false } : null,
    createdAt: r.createdAt.toISOString(),
  }));
  const plain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
  return <PipelineView records={plain(records)} runs={plain<RunRow[]>(runs)} jobs={plain<JobRow[]>(jobs)} providers={providerList} />;
}
