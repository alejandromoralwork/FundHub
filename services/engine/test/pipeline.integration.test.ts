/**
 * FILE: services/engine/test/pipeline.integration.test.ts
 * PART: scraping engine (services/engine) — integration test of the layered pipeline (needs the Intelligence DB)
 * WHAT IT DOES: Runs records through raw → staging → [approval gate] → clean → match → core and checks every
 *   layer, plus each gate path: held (pending), approved, edited-and-approved (manual claim wins), rejected,
 *   policy switched to auto (flows straight through); and cross-checking: two sources linked by LEI, a
 *   disagreement on the address is settled by precedence (no conflict row), lineage names the winning source.
 *   Uses a dedicated CSSF scope and test identifiers, and deletes everything it created at the end.
 * WHERE IT RUNS: `npm test -w @fundhub/engine` (skipped when the database is not reachable).
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, pool } from "@fundhub/engine-db/client";
import { clearPrecedenceCache } from "@fundhub/engine-db/core/entity";
import { changes, claims, companies, conflicts, fetches, fieldLineage, parsedRecords, rejects, reviewPolicies, sourceRecords } from "@fundhub/engine-db/schema";
import type { ParsedRecord, RawCapture } from "../src/core/types";
import { clearPolicyCache } from "../src/pipeline/gate";
import { ingestParsed, releaseApproved } from "../src/pipeline/ingest";
import { FsBlobStore } from "../src/storage";

async function dbReady() {
  try {
    const r = await pool.query("select to_regclass('staging.parsed_records') as t");
    return r.rows[0].t !== null;
  } catch {
    return false;
  }
}
const ready = await dbReady();
const RUN = `T${Date.now()}`;
const SCOPE = `TEST-${RUN}`;
const LEI = `TEST${RUN}`.padEnd(20, "0").slice(0, 20);
const ctx = { blobs: new FsBlobStore(mkdtempSync(join(tmpdir(), "fundhub-pipeline-"))) };

const raw = (source: "cssf" | "gleif", id: string): RawCapture => ({ source, externalId: id, url: `https://example.test/${source}/${id}`, httpStatus: 200, contentType: "application/json", body: Buffer.from(`${source}:${id}:${Math.random()}`), ext: "json" });
const cssfRec = (name: string, extra: Partial<ParsedRecord["facts"]> = {}): ParsedRecord => ({
  source: "cssf",
  externalId: `C${RUN}`,
  state: "found",
  scope: SCOPE,
  facts: { name, status: "active", address: { raw: "1 rue Test, L-1111 Luxembourg", postcode: "1111", city: "Luxembourg", country: "LU" }, lei: LEI, email: "jane.doe@example.test", ...extra },
  identifiers: [{ scheme: "cssf_id", value: `C${RUN}` }, { scheme: "lei", value: LEI }],
  names: [{ name, kind: "legal", validFrom: null }],
});
const gleifRec = (): ParsedRecord => ({
  source: "gleif",
  externalId: LEI,
  state: "found",
  scope: "LU",
  facts: { name: "Pipeline Test S.A.", status: "active", address: { raw: "9 route Autre, L-2222 Luxembourg", postcode: "L-2222", city: "Luxembourg", country: "LU" }, lei: LEI },
  identifiers: [{ scheme: "lei", value: LEI }],
  names: [{ name: "Pipeline Test S.A.", kind: "legal", validFrom: null }],
});

/** Sets the test scope's policy (review_all or auto) and forgets cached policies. */
async function policy(mode: "review_all" | "auto") {
  await db
    .insert(reviewPolicies)
    .values({ source: "cssf", scope: SCOPE, mode, note: "integration test", updatedBy: "test" })
    .onConflictDoUpdate({ target: [reviewPolicies.source, reviewPolicies.scope], set: { mode } });
  clearPolicyCache();
}
const decide = (id: number, reviewStatus: "approved" | "edited" | "rejected", editedPayload?: ParsedRecord) =>
  db.update(parsedRecords).set({ reviewStatus, reviewedBy: "test@fundhub.lu", reviewedAt: new Date(), editedPayload: (editedPayload ?? null) as unknown as Record<string, unknown> | null }).where(eq(parsedRecords.id, id));
const latestParsed = async (sourceRecordId: number) => (await db.select().from(parsedRecords).where(eq(parsedRecords.sourceRecordId, sourceRecordId)).orderBy(parsedRecords.id)).at(-1)!;

test("layered pipeline: gate paths, cleaning, cross-source matching, conflicts and lineage", { skip: !ready && "Intelligence DB not reachable" }, async () => {
  clearPrecedenceCache();
  await policy("review_all");

  // 1. HELD: the record stops at staging; nothing reaches clean / core.
  const a = await ingestParsed(cssfRec("Pipeline Test SA"), raw("cssf", `C${RUN}`), 1, ctx);
  assert.equal(a.status, "held");
  assert.equal(a.companyId, null);
  const [f1] = await db.select().from(fetches).where(eq(fetches.sourceRecordId, a.sourceRecordId));
  assert.ok(f1, "raw fetch stored");
  let p = await latestParsed(a.sourceRecordId);
  assert.equal(p.reviewStatus, "pending");
  assert.deepEqual(p.reviewReasons, ["every cssf record is reviewed"]);
  assert.equal((await db.select().from(claims).where(eq(claims.sourceRecordId, a.sourceRecordId))).length, 0);

  // 2. APPROVED: released → company, claims, lineage; the personal-looking e-mail is rejected by clean.
  await decide(p.id, "approved");
  const r1 = await releaseApproved(p.id);
  assert.ok(r1?.companyId);
  const companyId = r1!.companyId!;
  assert.equal(r1!.created, true);
  const open = await db.select().from(claims).where(and(eq(claims.sourceRecordId, a.sourceRecordId), isNull(claims.validTo)));
  assert.ok(open.some((c) => c.attribute === "name" && c.value === "Pipeline Test SA"));
  assert.ok(!open.some((c) => c.attribute === "email"), "personal e-mail never reaches claims");
  assert.equal((await db.select().from(rejects).where(and(eq(rejects.sourceRecordId, a.sourceRecordId), eq(rejects.attribute, "email")))).length, 1);
  assert.equal(await releaseApproved(p.id), null, "releasing twice is a no-op");

  // 3. CROSS-CHECK: GLEIF links by LEI to the same company; addresses disagree → CSSF wins by precedence, no conflict
  //    to check (name / address are pure precedence), the disagreement is in the lineage.
  const g = await ingestParsed(gleifRec(), raw("gleif", LEI), 1, ctx);
  assert.equal(g.status, "new");
  assert.equal(g.companyId, companyId);
  let [co] = await db.select().from(companies).where(eq(companies.id, companyId));
  assert.equal(co.sourceCount, 2);
  assert.equal(co.registeredAddress?.postcode, "L-1111", "postcode normalized and CSSF wins the address");
  const [conflict] = await db.select().from(conflicts).where(and(eq(conflicts.companyId, companyId), eq(conflicts.attribute, "address")));
  assert.equal(conflict, undefined, "no address conflict: precedence decides");
  const [lin] = await db.select().from(fieldLineage).where(and(eq(fieldLineage.companyId, companyId), eq(fieldLineage.attribute, "address")));
  assert.equal(lin.source, "cssf");
  assert.equal(lin.sourcesTotal, 2);
  assert.equal(lin.sourcesAgreeing, 1);

  // 4. EDITED: a new CSSF version is held; the reviewer corrects the name → a manual claim wins.
  const b = await ingestParsed(cssfRec("Pipeline Test SA (typo)"), raw("cssf", `C${RUN}`), 1, ctx);
  assert.equal(b.status, "held");
  p = await latestParsed(b.sourceRecordId);
  const edited = { ...(p.payload as unknown as ParsedRecord) };
  edited.facts = { ...edited.facts, name: "Pipeline Test Corrected SA" };
  await decide(p.id, "edited", edited);
  await releaseApproved(p.id);
  [co] = await db.select().from(companies).where(eq(companies.id, companyId));
  assert.equal(co.canonicalName, "Pipeline Test Corrected SA");
  const [nameLin] = await db.select().from(fieldLineage).where(and(eq(fieldLineage.companyId, companyId), eq(fieldLineage.attribute, "name")));
  assert.equal(nameLin.source, "manual");

  // 5. REJECTED: nothing downstream changes.
  const c = await ingestParsed(cssfRec("Wrong Name Ltd"), raw("cssf", `C${RUN}`), 1, ctx);
  assert.equal(c.status, "held");
  p = await latestParsed(c.sourceRecordId);
  await decide(p.id, "rejected");
  assert.equal(await releaseApproved(p.id), null);
  const stillOpen = await db.select().from(claims).where(and(eq(claims.sourceRecordId, a.sourceRecordId), eq(claims.attribute, "name"), isNull(claims.validTo)));
  assert.equal(stillOpen[0].value, "Pipeline Test SA (typo)", "the rejected version wrote no claims");

  // 6. AUTO: switching the policy lets the next version flow straight through.
  await policy("auto");
  const d = await ingestParsed(cssfRec("Pipeline Test SA", { website: "WWW.Pipeline-Test.example/?utm_source=x" }), raw("cssf", `C${RUN}`), 1, ctx);
  assert.equal(d.status, "changed");
  p = await latestParsed(d.sourceRecordId);
  assert.equal(p.reviewStatus, "not_required");
  const [web] = await db.select().from(claims).where(and(eq(claims.sourceRecordId, a.sourceRecordId), eq(claims.attribute, "website"), isNull(claims.validTo)));
  assert.equal(web.value, "https://www.pipeline-test.example", "URL canonicalized, tracking removed");

  // 7. UNCHANGED content: no new fetch, no new parsed version.
  const before = (await db.select().from(parsedRecords).where(eq(parsedRecords.sourceRecordId, a.sourceRecordId))).length;
  const e = await ingestParsed(cssfRec("Pipeline Test SA", { website: "WWW.Pipeline-Test.example/?utm_source=x" }), raw("cssf", `C${RUN}`), 1, ctx);
  assert.equal(e.status, "unchanged");
  assert.equal((await db.select().from(parsedRecords).where(eq(parsedRecords.sourceRecordId, a.sourceRecordId))).length, before);
});

after(async () => {
  if (ready) {
    const recs = await db.select({ id: sourceRecords.id, companyId: sourceRecords.companyId }).from(sourceRecords).where(inArray(sourceRecords.externalId, [`C${RUN}`, LEI]));
    const companyIds = [...new Set(recs.map((r) => r.companyId).filter((x): x is string => !!x))];
    const manual = companyIds.length ? await db.select({ id: sourceRecords.id }).from(sourceRecords).where(and(eq(sourceRecords.source, "manual"), inArray(sourceRecords.externalId, companyIds))) : [];
    const ids = [...recs, ...manual].map((r) => r.id);
    if (ids.length) await db.delete(sourceRecords).where(inArray(sourceRecords.id, ids));
    if (companyIds.length) await db.delete(changes).where(inArray(changes.companyId, companyIds));
    if (companyIds.length) await db.delete(companies).where(inArray(companies.id, companyIds));
    await db.delete(reviewPolicies).where(and(eq(reviewPolicies.source, "cssf"), eq(reviewPolicies.scope, SCOPE)));
  }
  await pool.end();
});
