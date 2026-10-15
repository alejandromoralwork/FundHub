/**
 * Database access. The scraper only reads `providers` and writes the `ingest_*` tables;
 * in production its role (`fundhub_scraper`) cannot write anything else.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { ingestJobs, ingestRecords, ingestRuns, providers, type IngestSource } from "@fundhub/db/schema";
import type { Extraction, ProviderRef } from "./types";

const providerRef = {
  id: providers.id,
  slug: providers.slug,
  name: providers.name,
  website: providers.website,
  rcsNumber: providers.rcsNumber,
  headquarters: providers.headquarters,
  foundedYear: providers.foundedYear,
};

/** Published providers, least recently scraped first. */
export async function loadProviders(opts: { slugs?: string[]; ids?: number[]; limit?: number } = {}): Promise<ProviderRef[]> {
  const lastScraped = sql`(select max(${ingestRecords.createdAt}) from ${ingestRecords} where ${ingestRecords.providerId} = ${providers.id})`;
  const q = db
    .select(providerRef)
    .from(providers)
    .where(
      and(
        eq(providers.status, "published"),
        opts.slugs?.length ? inArray(providers.slug, opts.slugs) : undefined,
        opts.ids?.length ? inArray(providers.id, opts.ids) : undefined,
      ),
    )
    .orderBy(sql`${lastScraped} asc nulls first`, asc(providers.id));
  return opts.limit ? q.limit(opts.limit) : q;
}

export async function startRun(source: IngestSource, trigger: string): Promise<number> {
  const [row] = await db.insert(ingestRuns).values({ source, status: "running", trigger }).returning({ id: ingestRuns.id });
  return row!.id;
}

export async function finishRun(id: number, status: "succeeded" | "failed", stats: Record<string, number>, error?: string) {
  await db.update(ingestRuns).set({ status, stats, error: error ?? null, finishedAt: new Date() }).where(eq(ingestRuns.id, id));
}

const normalizeValue = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v ?? null);

/** Keeps only fields whose scraped value differs from the live profile. */
export async function changedFields(ext: Extraction): Promise<Extraction["fields"]> {
  const [live] = await db.select().from(providers).where(eq(providers.id, ext.provider.id));
  if (!live) return {};
  const current = live as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(ext.fields).filter(([k, f]) => !(k in current) || normalizeValue(current[k]) !== normalizeValue(f.value)),
  );
}

/** One pending record per provider and source: a newer scrape replaces the unreviewed one. */
export async function saveRecord(runId: number, source: IngestSource, ext: Extraction): Promise<number> {
  const values = { runId, sourceUrl: ext.sourceUrl, raw: ext.raw, extracted: ext.fields, createdAt: new Date() };
  const [pending] = await db
    .select({ id: ingestRecords.id })
    .from(ingestRecords)
    .where(and(eq(ingestRecords.providerId, ext.provider.id), eq(ingestRecords.source, source), eq(ingestRecords.status, "pending")))
    .orderBy(desc(ingestRecords.id))
    .limit(1);
  if (pending) {
    await db.update(ingestRecords).set(values).where(eq(ingestRecords.id, pending.id));
    return pending.id;
  }
  const [row] = await db
    .insert(ingestRecords)
    .values({ ...values, providerId: ext.provider.id, source, status: "pending" })
    .returning({ id: ingestRecords.id });
  return row!.id;
}

/** Atomically takes queued jobs (safe if two workers run at once). */
export async function claimJobs(limit = 20) {
  const { rows } = await db.execute<{ id: number; source: IngestSource; provider_id: number | null }>(sql`
    update ${ingestJobs} set status = 'running', updated_at = now()
    where id in (select id from ${ingestJobs} where status = 'queued' order by id for update skip locked limit ${limit})
    returning id, source, provider_id`);
  return rows.map((r) => ({ id: r.id, source: r.source, providerId: r.provider_id }));
}

export async function finishJob(id: number, status: "done" | "failed", runId: number | null, error?: string) {
  await db.update(ingestJobs).set({ status, runId, error: error ?? null }).where(eq(ingestJobs.id, id));
}
