"use server";
/**
 * FILE: apps/admin/src/lib/pipeline-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Actions for the data pipeline page. Staff can queue a scrape (the scraper collects provider
 *   facts from the web or the business register), then review each scraped "ingest record": accept chosen
 *   fields into the live provider profile, or reject the record.
 * WHERE IT RUNS: only on the server (Node.js): it writes to the database and calls GitHub with a secret token.
 * FRAMEWORK NOTES: `"use server"` (must be the first line) makes each exported async function a Next.js
 *   "server action" that Console buttons can call; it runs on the server. Every action re-checks the caller's
 *   role with `requireStaff`, because the request could come from anyone.
 *   Design rule: scraped data is never published automatically. A human picks which fields to apply, and each
 *   value is re-validated, because scraped web content can be wrong or even malicious.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Record<string, z.ZodType>`: an object whose keys are text and whose values are Zod schemas.
 *   - `readonly string[]`: an array that may not be modified; `number | null` unions.
 *   - arrow functions returning schemas, `.every`, `.filter`, `.map`, `Object.keys`, `Object.fromEntries`.
 *   - `key in obj` (does the object have this key?), `keyof typeof before` (the names of before's fields).
 */

// `import { a } from "b"` brings named exports into this file.
// Drizzle ORM: `eq(column, value)` = SQL "column = value".
import { eq } from "drizzle-orm";
// Next.js: refresh a page's cached data.
import { revalidatePath } from "next/cache";
// Zod: validation library.
import { z } from "zod";
// Allowed values for provider fields and for scrape sources (shared lists in our core package).
import { ASSET_CLASSES, CERTIFICATIONS, LICENCES, REGULATORY_SCOPES } from "@fundhub/core/enums";
// Every known service name across all categories.
import { ALL_SERVICES } from "@fundhub/core/taxonomy";
// Database connection; tables: scrape jobs, scraped records, providers.
import { db } from "@fundhub/db/client";
import { ingestRecords, providers } from "@fundhub/db/schema";
import { db as engineDb } from "@fundhub/engine-db/client";
import { companies } from "@fundhub/engine-db/schema";
import { sendEngineJob } from "./engine-queue";
// Audit log and permission checks.
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

/**
 * Kind: type alias (exported). Result of an action: `ok` or `error` message, both optional.
 */
export type ActionResult = { ok?: string; error?: string };

/**
 * Kind: constant (Zod schema). A list of up to 50 non-empty text items (e.g. technology names).
 */
const strList = z.array(z.string().trim().min(1)).max(50);
/**
 * Kind: constant holding an arrow function that builds a Zod schema.
 * @param allowed  `readonly string[]` — the permitted values.
 * @returns        a schema for a list of text values where `.every` item must be in `allowed`
 *                 (`.every` returns true only if the test passes for all items).
 */
const enumList = (allowed: readonly string[]) => z.array(z.string()).refine((l) => l.every((s) => allowed.includes(s)), "Unknown value");

/**
 * Kind: constant (lookup table).
 * Scraped keys that may be written to a provider profile, with their validation.
 * This is an allow-list: any key not listed here can never reach a provider row, whatever the scraper sends.
 */
const ACCEPTABLE: Record<string, z.ZodType> = {
  website: z.string().trim().url().max(300),
  description: z.string().trim().min(10).max(1200),
  headquarters: z.string().trim().min(2).max(160),
  // Luxembourg business register (RCS) number.
  rcsNumber: z.string().trim().min(2).max(40),
  headcount: z.number().int().positive().max(200_000),
  // Between 1800 and the current year.
  foundedYear: z.number().int().min(1800).max(new Date().getFullYear()),
  services: enumList(ALL_SERVICES),
  licences: enumList(LICENCES),
  assetClasses: enumList(ASSET_CLASSES),
  certifications: enumList(CERTIFICATIONS),
  regulatoryScope: enumList(REGULATORY_SCOPES),
  techStack: strList,
  footprint: strList,
};

/**
 * Kind: server action.
 * Asks the Intelligence pipeline (services/engine) to work now, through its job queue:
 *   "website"  crawl the website of one listed provider (its linked company), or queue every company that is due;
 *   "fundhub"  re-read FundHub listings, claims and self-edits into the pipeline;
 *   "publish"  compare golden records with listings and write proposals into this review queue.
 * @param action      one of the three above.
 * @param providerId  for "website": one provider, or `null` for all due companies.
 */
export async function queueScrape(action: string, providerId: number | null): Promise<ActionResult> {
  // `CAN.pipeline` = owner, operations and analyst.
  const staff = await requireStaff(CAN.pipeline);
  const a = z.enum(["website", "fundhub", "publish"]).parse(action);
  try {
    let data: Record<string, unknown> = {};
    if (a === "website" && providerId) {
      const [c] = await engineDb.select({ id: companies.id }).from(companies).where(eq(companies.websiteProviderId, providerId));
      if (!c) return { error: "This provider is not linked to a company yet. Run “Sync FundHub accounts” and approve its record in Company intelligence → Review." };
      data = { companyId: c.id };
    }
    const job = a === "website" ? "website_crawl" : a === "fundhub" ? "fundhub_sync" : "publish_proposals";
    await sendEngineJob(job, data);
    await audit(staff, "queue", "engine-job", null, { job, data });
    revalidatePath("/pipeline");
    return { ok: "Queued. An engine worker runs it within a minute; proposals then appear in the review queue." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Kind: server action.
 * Writes the selected fields into the live profile; the rest of the record stays unapplied.
 * @param recordId  `number` — the scraped record being reviewed.
 * @param fields    `string[]` — names of the fields staff ticked to apply.
 * @returns         `Promise<ActionResult>`.
 */
export async function acceptFields(recordId: number, fields: string[]): Promise<ActionResult> {
  // Changing live profiles needs `CAN.editData` (owner, operations), stricter than queuing a scrape.
  const staff = await requireStaff(CAN.editData);
  const [rec] = await db.select().from(ingestRecords).where(eq(ingestRecords.id, recordId));
  // The record must exist, still be pending, and be linked to a provider.
  if (!rec || rec.status !== "pending" || !rec.providerId) return { error: "Record not found or already reviewed." };
  if (!fields.length) return { error: "Select at least one field." };

  // Build the update one field at a time, refusing the whole thing if any field is not allowed or invalid.
  const set: Record<string, unknown> = {};
  for (const key of fields) {
    // The schema for this key (undefined if it is not on the allow-list), and the scraped entry for it.
    const schema = ACCEPTABLE[key];
    const extracted = rec.extracted[key];
    if (!schema || !extracted) return { error: `"${key}" can't be applied to a profile.` };
    // Re-validate the scraped value itself before it can touch the provider.
    const parsed = schema.safeParse(extracted.value);
    if (!parsed.success) return { error: `Invalid value for ${key}: ${parsed.error.issues[0]?.message}` };
    set[key] = parsed.data;
  }

  // Load the provider as it is now, so the audit can show "before → after".
  const [before] = await db.select().from(providers).where(eq(providers.id, rec.providerId));
  if (!before) return { error: "Provider no longer exists." };
  await db.update(providers).set(set).where(eq(providers.id, rec.providerId));
  // All applicable keys in this record (`Object.keys` lists an object's keys; `.filter` keeps allow-listed ones).
  const allKeys = Object.keys(rec.extracted).filter((k) => k in ACCEPTABLE);
  await db
    .update(ingestRecords)
    .set({
      // "accepted" if every applicable field was applied, otherwise "partial".
      status: fields.length >= allKeys.length ? "accepted" : "partial",
      acceptedFields: fields,
      reviewedBy: staff.id,
      reviewedAt: new Date(),
    })
    .where(eq(ingestRecords.id, recordId));
  await audit(staff, "accept-ingest", "providers", rec.providerId, {
    record: recordId,
    source: rec.source,
    // `fields.map(k => [k, {...}])` makes a list of [key, value] pairs; `Object.fromEntries` turns it into an
    // object like { headcount: { from: 40, to: 55 } }. `k as keyof typeof before` tells TypeScript that `k` is
    // one of the provider's field names, so `before[k]` is allowed.
    changes: Object.fromEntries(fields.map((k) => [k, { from: before[k as keyof typeof before], to: set[k] }])),
  });
  revalidatePath("/pipeline");
  return { ok: `Applied ${fields.length} field(s) to ${before.name}.` };
}

/**
 * Kind: server action.
 * Dismisses a scraped record without applying anything.
 * @param recordId  `number`.
 * @returns         `Promise<ActionResult>`.
 */
export async function rejectRecord(recordId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  await db.update(ingestRecords).set({ status: "rejected", reviewedBy: staff.id, reviewedAt: new Date() }).where(eq(ingestRecords.id, recordId));
  await audit(staff, "reject-ingest", "ingest_records", recordId);
  revalidatePath("/pipeline");
  return { ok: "Record dismissed." };
}
