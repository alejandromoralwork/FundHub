/**
 * FILE: services/engine/test/documents.integration.test.ts
 * PART: scraping engine (services/engine) — integration tests (need the engine database)
 * WHAT IT DOES: Against a real engine database:
 *   - documentScopeSql: a CSSF ManCo is in scope, a CSSF fund and a non-CSSF service provider are not
 *     (the latter is in the legacy scope);
 *   - recomputeCompany sets registry_status; validCompanySql accepts a sub-fund of a verified umbrella only;
 *   - storeDocument: a non-PDF is refused, a PDF of another company's filing is refused, an out-of-scope company
 *     is skipped, an in-scope PDF is stored once (blob + raw.documents with its RCS number) and linked, and a
 *     second copy is "already saved" without writing anything.
 *   The rule checks run in a rolled-back transaction. storeDocument uses its own connection, so its test creates
 *   uniquely-named rows and deletes them at the end. Skipped when no engine database is reachable.
 *   Run on a throwaway database: ENGINE_DATABASE_URL=… (e.g. `npm run engine:db:local`, port 5434).
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "@fundhub/engine-db/client";
import { documentScopeSql } from "@fundhub/engine-db/core/document-scope";
import { recomputeCompany } from "@fundhub/engine-db/core/entity";
import { validCompanySql } from "@fundhub/engine-db/core/registry";
import { companies, companyGroupMembers, companyGroups, companyIdentifiers, documents, filings, reviewPolicies, sourceRecords } from "@fundhub/engine-db/schema";
import type { ParsedRecord, RawCapture } from "../src/core/types";
import { clearPolicyCache } from "../src/pipeline/gate";
import { ingestParsed } from "../src/pipeline/ingest";
import { storeDocument } from "../src/capture-server";
import { FsBlobStore, sha256 } from "../src/storage";
import { purgeUnwantedDocuments } from "../src/pipeline/documents";

/** Kind: async function. True when the engine database answers and has migration 0008 (registry_status). */
async function dbReady() {
  try {
    const r = await pool.query("select 1 from information_schema.columns where table_schema = 'core' and table_name = 'companies' and column_name = 'registry_status'");
    return r.rowCount === 1;
  } catch {
    return false;
  }
}

const ready = await dbReady();
const skip = !ready && "engine database (with migration 0008) not reachable";
class Rollback extends Error {}
const tag = `T${Date.now().toString(36)}`;

test("document scope SQL and the RCS existence gate", { skip }, async () => {
  try {
    await db.transaction(async (tx) => {
      const mk = async (name: string, v: Partial<typeof companies.$inferInsert>, recs: { source: "rcs" | "lbr_bulk" | "cssf" | "gleif"; state?: "found" | "not_found" }[], rcs?: string) => {
        const [c] = await tx.insert(companies).values({ canonicalName: name, normalizedName: name.toLowerCase(), ...v }).returning({ id: companies.id });
        for (const [i, r] of recs.entries()) await tx.insert(sourceRecords).values({ source: r.source, externalId: `${tag}-${name}-${i}`, companyId: c.id, state: r.state ?? "found" });
        if (rcs) await tx.insert(companyIdentifiers).values({ companyId: c.id, scheme: "rcs", value: rcs, source: "gleif" });
        return c.id;
      };
      const manco = await mk("manco", { companyKind: "asset_manager" }, [{ source: "cssf" }, { source: "lbr_bulk" }], `B9${tag}1`);
      const fund = await mk("fund", { companyKind: "fund", fundRole: "umbrella_fund" }, [{ source: "cssf" }, { source: "rcs" }], `B9${tag}2`);
      const sp = await mk("lawfirm", { companyKind: "service_provider", isServiceProvider: true }, [{ source: "gleif" }], `B9${tag}3`);
      const sub = await mk("subfund", { companyKind: "fund", fundRole: "sub_fund", legalVehicle: "sub_fund" }, [{ source: "gleif" }]);
      const orphanSub = await mk("orphansub", { companyKind: "fund", fundRole: "sub_fund", legalVehicle: "sub_fund" }, [{ source: "gleif" }]);
      const gone = await mk("gone", { companyKind: "corporate" }, [{ source: "rcs", state: "not_found" }], `B9${tag}4`);

      const scope = async (id: string, mode: "cssf" | "legacy") =>
        (await tx.execute<{ w: boolean }>(sql`select ${documentScopeSql("e", mode)} as w from core.companies e where e.id = ${id}`)).rows[0].w;
      assert.equal(await scope(manco, "cssf"), true);
      assert.equal(await scope(fund, "cssf"), false);
      assert.equal(await scope(sp, "cssf"), false);
      assert.equal(await scope(sp, "legacy"), true);

      // The sub-fund hangs under the umbrella; the orphan has no structure.
      const [g] = await tx.insert(companyGroups).values({ key: `${tag}-umbrella`, layer: "fund", kind: "fund_structure", name: "Umbrella", headCompanyId: fund, source: "cssf" }).returning({ id: companyGroups.id });
      await tx.insert(companyGroupMembers).values([
        { groupId: g.id, companyId: fund, role: "umbrella_fund", source: "cssf" },
        { groupId: g.id, companyId: sub, role: "sub_fund", source: "cssf" },
      ]);
      // A CSSF compartment with no structure (as pipeline/groups.ts creates them).
      await tx.insert(companyIdentifiers).values({ companyId: orphanSub, scheme: "cssf_compartment", value: `${tag}_00000001`, source: "cssf" });
      // Recompute (no claims) sets the registry status from the source records and identifiers.
      for (const id of [manco, fund, sp, sub, orphanSub, gone]) await recomputeCompany(tx, id);
      const status = Object.fromEntries(
        (await tx.select({ id: companies.id, s: companies.registryStatus }).from(companies).where(inArray(companies.id, [manco, fund, sp, sub, orphanSub, gone]))).map((r) => [r.id, r.s]),
      );
      assert.equal(status[manco], "verified");
      assert.equal(status[fund], "verified");
      assert.equal(status[sp], "pending");
      assert.equal(status[gone], "rcs_not_found");
      // Sub-funds: from their place in a structure, or from a CSSF compartment code.
      assert.equal(status[sub], "compartment");
      assert.equal(status[orphanSub], "compartment");

      const valid = async (id: string) => (await tx.execute<{ v: boolean }>(sql`select ${validCompanySql("e")} as v from core.companies e where e.id = ${id}`)).rows[0].v;
      assert.equal(await valid(manco), true);
      assert.equal(await valid(sub), true);
      assert.equal(await valid(orphanSub), false);
      assert.equal(await valid(sp), false);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
});

test("storeDocument: checks first, stores each PDF once, links it to its filing", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fh-docs-"));
  const blobs = new FsBlobStore(dir);
  const rcsIn = `B8${Date.now() % 1_000_000}`;
  const rcsOut = `B7${Date.now() % 1_000_000}`;
  const filingIn = `L9${String(Date.now()).slice(-8)}`;
  const filingOut = `L8${String(Date.now()).slice(-8)}`;
  const filingSkip = `L7${String(Date.now()).slice(-8)}`;
  const pdf = Buffer.from(`%PDF-1.7\n${tag} test document\n%%EOF`);
  const created: { companies: string[]; records: number[] } = { companies: [], records: [] };
  try {
    const mk = async (name: string, rcs: string, kind: "asset_manager" | "service_provider", withCssf: boolean, filingNumber: string) => {
      const [c] = await db.insert(companies).values({ canonicalName: name, normalizedName: name.toLowerCase(), companyKind: kind, isServiceProvider: kind === "service_provider" }).returning({ id: companies.id });
      created.companies.push(c.id);
      await db.insert(companyIdentifiers).values({ companyId: c.id, scheme: "rcs", value: rcs, source: "rcs" });
      const [r] = await db.insert(sourceRecords).values({ source: "rcs", externalId: rcs, companyId: c.id }).returning({ id: sourceRecords.id });
      created.records.push(r.id);
      if (withCssf) {
        const [x] = await db.insert(sourceRecords).values({ source: "cssf", externalId: `${tag}-${rcs}`, companyId: c.id }).returning({ id: sourceRecords.id });
        created.records.push(x.id);
      }
      await db.insert(filings).values({ filingNumber, sourceRecordId: r.id, type: "Annual accounts (eCDF)", hasDocuments: true });
      return r.id;
    };
    const mancoRecord = await mk(`${tag} ManCo`, rcsIn, "asset_manager", true, filingIn);
    // A filing of the same company whose type is not kept (only directors changed).
    await db.insert(filings).values({ filingNumber: filingSkip, sourceRecordId: mancoRecord, type: "Modification relating solely to authorized representatives", details: ["Administrator(s)/Manager(s)"], hasDocuments: true });
    await mk(`${tag} Law Firm`, rcsOut, "service_provider", false, filingOut);
    const url = (f: string) => `https://www.lbr.lu/mjrcs-web-front/document/${f}.pdf`;
    const send = (data: Buffer, filingNumber: string, rcs: string) => storeDocument({ url: url(filingNumber), contentType: "application/pdf", data: data.toString("base64"), filingNumber, rcs }, blobs);

    const html = await send(Buffer.from("<html>please log in</html>"), filingIn, rcsIn);
    assert.equal(html.ok, false);
    assert.match(String(html.error), /not a PDF/);

    const wrongCompany = await send(pdf, filingIn, rcsOut);
    assert.equal(wrongCompany.ok, false);
    assert.match(String(wrongCompany.error), /belongs to/);

    const outOfScope = await send(pdf, filingOut, rcsOut);
    assert.equal(outOfScope.ok, false);
    assert.equal("skipped" in outOfScope && outOfScope.skipped, true);

    const wrongType = await send(pdf, filingSkip, rcsIn);
    assert.equal(wrongType.ok, false);
    assert.equal("skipped" in wrongType && wrongType.skipped, true);
    assert.match(String(wrongType.error), /not a kept filing type/);

    const unknownFiling = await send(pdf, "L000000001", rcsIn);
    assert.equal(unknownFiling.ok, false);
    assert.match(String(unknownFiling.error), /not known yet/);

    const first = await send(pdf, filingIn, rcsIn);
    assert.equal(first.ok, true);
    assert.equal("linked" in first && first.linked, true);
    const [doc] = await db.select().from(documents).where(eq(documents.sha256, sha256(pdf)));
    assert.equal(doc.rcsNumber, rcsIn);
    assert.equal(doc.filingNumber, filingIn);
    const [f] = await db.select({ d: filings.documentSha256 }).from(filings).where(eq(filings.filingNumber, filingIn));
    assert.equal(f.d, sha256(pdf));

    // A second, different copy of the same filing: answered "already saved", nothing new written.
    const other = Buffer.from(`%PDF-1.7\n${tag} re-rendered copy\n%%EOF`);
    const again = await send(other, filingIn, rcsIn);
    assert.equal(again.ok, true);
    assert.equal("alreadySaved" in again && again.alreadySaved, true);
    assert.equal((await db.select().from(documents).where(eq(documents.sha256, sha256(other)))).length, 0);
    const stored = await readdir(join(dir, "docs"), { recursive: true });
    assert.equal(stored.filter((p) => p.endsWith(".pdf")).length, 1);
    assert.equal(stored.filter((p) => p.endsWith(".tmp")).length, 0);
  } finally {
    await db.delete(filings).where(inArray(filings.filingNumber, [filingIn, filingOut, filingSkip]));
    await db.delete(documents).where(eq(documents.sha256, sha256(pdf)));
    if (created.records.length) await db.delete(sourceRecords).where(inArray(sourceRecords.id, created.records));
    if (created.companies.length) await db.delete(companies).where(inArray(companies.id, created.companies));
    await rm(dir, { recursive: true, force: true });
  }
});

test("docs:purge-unwanted removes only PDFs whose filings are all of a not-kept type", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fh-purge-"));
  const blobs = new FsBlobStore(dir);
  const n = String(Date.now()).slice(-8);
  const keepF = `L6${n}`, dropF = `L5${n}`;
  const keepPdf = Buffer.from(`%PDF-1.7 ${tag} accounts`), dropPdf = Buffer.from(`%PDF-1.7 ${tag} signatures`);
  const key = (pdf: Buffer) => `docs/${sha256(pdf).slice(0, 2)}/${sha256(pdf)}.pdf`;
  const [rec] = await db.insert(sourceRecords).values({ source: "rcs", externalId: `B6${n}` }).returning({ id: sourceRecords.id });
  try {
    for (const [pdf, f, type] of [[keepPdf, keepF, "Annual accounts"], [dropPdf, dropF, "Authorized signature list"]] as const) {
      await blobs.put(key(pdf), pdf);
      await db.insert(documents).values({ sha256: sha256(pdf), blobKey: key(pdf), mime: "application/pdf", bytes: pdf.length, filingNumber: f });
      await db.insert(filings).values({ filingNumber: f, sourceRecordId: rec.id, type, documentSha256: sha256(pdf) });
    }
    const dry = await purgeUnwantedDocuments(blobs);
    assert.ok(dry.byType["Authorized signature list"] >= 1);
    assert.equal(await blobs.exists(key(dropPdf)), true);
    await purgeUnwantedDocuments(blobs, { apply: true });
    assert.equal((await db.select().from(documents).where(eq(documents.sha256, sha256(dropPdf)))).length, 0);
    assert.equal(await blobs.exists(key(dropPdf)), false);
    const [f] = await db.select({ d: filings.documentSha256 }).from(filings).where(eq(filings.filingNumber, dropF));
    assert.equal(f.d, null);
    assert.equal((await db.select().from(documents).where(eq(documents.sha256, sha256(keepPdf)))).length, 1);
    assert.equal(await blobs.exists(key(keepPdf)), true);
  } finally {
    await db.delete(sourceRecords).where(eq(sourceRecords.id, rec.id));
    await db.delete(documents).where(inArray(documents.sha256, [sha256(keepPdf), sha256(dropPdf)]));
    await rm(dir, { recursive: true, force: true });
  }
});

test("monthly loop: a page held for review still writes its filings, so new documents can be saved", { skip }, async () => {
  const n = String(Date.now()).slice(-6);
  const rcs = `B4${n}`;
  const scope = `T-HELD-${n}`;
  const raw = (body: string): RawCapture => ({ source: "rcs", externalId: rcs, url: `https://www.lbr.lu/mjrcs-web-front/consult-company/${rcs}`, httpStatus: 200, contentType: "application/json", body: Buffer.from(body), ext: "json" });
  const rec = (address: string, filingNos: string[]): ParsedRecord => ({
    source: "rcs", externalId: rcs, state: "found", scope,
    facts: { name: `${tag} Held SA`, rcsNumber: rcs, status: "active", address: { raw: address, postcode: "1111", city: "Luxembourg", country: "LU" } },
    identifiers: [{ scheme: "rcs", value: rcs }], names: [{ name: `${tag} Held SA`, kind: "legal", validFrom: null }],
    filings: filingNos.map((f, i) => ({ filingNumber: f, filingDate: `2026-0${i + 1}-01`, type: i ? "Modification" : "Annual accounts", details: i ? ["Registered office"] : [], corrects: null, correctedBy: null, hasDocuments: true })),
  });
  const blobs = new FsBlobStore(await mkdtemp(join(tmpdir(), "fh-held-")));
  const [pol] = await db.insert(reviewPolicies).values({ source: "rcs", scope, mode: "review_if", conditions: { protectedAttributes: ["address"] }, note: "test" }).returning({ id: reviewPolicies.id });
  clearPolicyCache();
  let srId = 0;
  try {
    const first = await ingestParsed(rec("1 rue A, L-1111 Luxembourg", [`L1${n}001`]), raw("v1"), 1, { blobs });
    srId = first.sourceRecordId;
    assert.ok(first.status === "new" || first.status === "held");
    // Next month: the address changed (held for review) and a new filing appeared.
    const second = await ingestParsed(rec("9 rue B, L-1111 Luxembourg", [`L1${n}001`, `L1${n}002`]), raw("v2"), 1, { blobs });
    assert.equal(second.status, "held");
    const fs = await db.select({ f: filings.filingNumber }).from(filings).where(eq(filings.sourceRecordId, srId));
    assert.deepEqual(fs.map((x) => x.f).sort(), [`L1${n}001`, `L1${n}002`]);
  } finally {
    await db.delete(reviewPolicies).where(eq(reviewPolicies.id, pol.id));
    clearPolicyCache();
    if (srId) await db.delete(sourceRecords).where(eq(sourceRecords.id, srId));
    await db.execute(sql`delete from core.companies where canonical_name = ${`${tag} Held SA`}`);
  }
});

test("teardown", { skip }, async () => {
  await pool.end();
});
