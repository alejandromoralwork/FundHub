/**
 * FILE: services/engine/test/core.test.ts
 * PART: scraping engine (services/engine) — tests
 * WHAT IT DOES: Tests the pure core logic without a database:
 *   - resolution: the CSSF, GLEIF and RCS records of Arendt end up as ONE entity, in any arrival order;
 *   - change detection: a second RCS capture with one extra filing gives exactly one "new_filing";
 *   - golden record precedence; classification with the seeded rules; name normalisation.
 * TYPESCRIPT YOU WILL SEE HERE: an in-memory class implementing ResolverStore, permutations.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RULES } from "@fundhub/engine-db/seed-data";
import type { IdScheme, MatchMethod } from "@fundhub/engine-db/schema";
import { classify } from "../src/core/classify";
import { diffRecords } from "../src/core/diff";
import { buildGolden } from "../src/core/golden";
import { contentHash, normalizeName, normalizeRcs } from "../src/core/normalize";
import { resolveRecord, type ResolverStore } from "../src/core/resolve";
import type { ParsedRecord } from "../src/core/types";
import { parseCssf } from "../src/sources/cssf/parse";
import { parseGleif } from "../src/sources/gleif/parse";
import { parseRcsText } from "../src/sources/rcs/parse";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const json = (source: "cssf" | "gleif", id: string, file: string) => ({ source, externalId: id, url: "", httpStatus: 200, contentType: "application/json", body: fx(file), ext: "json" });
const cssf = () => parseCssf(json("cssf", "7013419", "cssf-7013419.json"));
const gleif = () => parseGleif(json("gleif", "222100IVSOG87C1WWJ84", "gleif-222100IVSOG87C1WWJ84.json"));
const rcs = () => parseRcsText(fx("rcs-B145917.txt").toString("utf8"), "B145917");

/** Kind: class. A ResolverStore in memory, mirroring the database behaviour. */
class MemStore implements ResolverStore {
  entities = new Map<string, { name: string; normalizedName: string; postcode: string | null }>();
  ids = new Map<string, string>(); // "scheme:value" → entity id
  candidates: { entityId: string; method: MatchMethod; decision: string }[] = [];
  #n = 0;
  async findByIdentifier(scheme: IdScheme, value: string) {
    return this.ids.get(`${scheme}:${value}`) ?? null;
  }
  async findByName(n: string) {
    return [...this.entities].filter(([, e]) => e.normalizedName === n).map(([entityId, e]) => ({ entityId, postcode: e.postcode }));
  }
  async createEntity(seed: { canonicalName: string; normalizedName: string }) {
    const id = `e${++this.#n}`;
    this.entities.set(id, { name: seed.canonicalName, normalizedName: seed.normalizedName, postcode: null });
    return id;
  }
  async addIdentifiers(entityId: string, ids: { scheme: IdScheme; value: string }[]) {
    for (const i of ids) if (!this.ids.has(`${i.scheme}:${i.value}`)) this.ids.set(`${i.scheme}:${i.value}`, entityId);
  }
  async merge(keep: string, drop: string) {
    for (const [k, v] of this.ids) if (v === drop) this.ids.set(k, keep);
    this.entities.delete(drop);
  }
  async addCandidate(entityId: string, method: MatchMethod, _score: number, decision: string) {
    this.candidates.push({ entityId, method, decision });
  }
  /** Like recomputeEntity: remember the postcode a record reported. */
  touch(entityId: string, rec: ParsedRecord) {
    const e = this.entities.get(entityId)!;
    e.postcode = (rec.facts.address as { postcode?: string } | null)?.postcode ?? e.postcode;
  }
}

const orders: [string, () => ParsedRecord][][] = [
  [["cssf", cssf], ["gleif", gleif], ["rcs", rcs]],
  [["rcs", rcs], ["cssf", cssf], ["gleif", gleif]],
  [["cssf", cssf], ["rcs", rcs], ["gleif", gleif]],
  [["gleif", gleif], ["rcs", rcs], ["cssf", cssf]],
];

for (const order of orders) {
  test(`resolve: CSSF + GLEIF + RCS of Arendt → one entity (${order.map(([n]) => n).join(" → ")})`, async () => {
    const store = new MemStore();
    const links = new Map<string, string>(); // source → entity it was resolved to
    for (const [name, make] of order) {
      const rec = make();
      const res = await resolveRecord(rec, store, links.get(name) ?? null);
      store.touch(res.entityId, rec);
      links.set(name, res.entityId);
    }
    assert.equal(store.entities.size, 1, `entities left: ${[...store.entities.keys()]}`);
    const only = [...store.entities.keys()][0];
    assert.equal(store.ids.get("rcs:B145917"), only);
    assert.equal(store.ids.get("lei:222100IVSOG87C1WWJ84"), only);
    assert.equal(store.ids.get("cssf_code:P00000348"), only);
  });
}

test("resolve: same name in another postcode is NOT merged, only flagged for review", async () => {
  const store = new MemStore();
  const a = cssf();
  const r1 = await resolveRecord(a, store);
  store.touch(r1.entityId, a);
  const b: ParsedRecord = { ...cssf(), externalId: "999", identifiers: [{ scheme: "cssf_id", value: "999" }], facts: { ...a.facts, lei: null, address: { raw: "x", postcode: "8070" } } };
  const r2 = await resolveRecord(b, store);
  assert.notEqual(r1.entityId, r2.entityId);
  assert.equal(store.candidates.at(-1)!.decision, "pending");
});

test("diff: a new filing on the next capture is exactly one new_filing event", () => {
  const before = rcs();
  const after = rcs();
  after.rcsFilings = [{ filingNumber: "L260400001", filingDate: "2026-10-30", type: "Authorized signature list", details: [], corrects: null, correctedBy: null, hasDocuments: true }, ...after.rcsFilings!];
  after.facts.rcsFilingCount = after.rcsFilings.length;
  const changes = diffRecords(before, after);
  assert.equal(changes.filter((c) => c.kind === "new_filing").length, 1);
  assert.equal(changes.filter((c) => c.kind === "attribute_changed").length, 1); // rcsFilingCount
  assert.equal(diffRecords(before, rcs()).length, 0);
  assert.equal(contentHash(before), contentHash(rcs()));
});

test("diff: an authorisation that gets an end date is authorisation_ended; a name change is name_change", () => {
  const before = cssf();
  const after = cssf();
  after.cssfDetails = after.cssfDetails!.map((d) => (d.code === "ACT_SPP_DOM" ? { ...d, endDate: "2026-10-01" } : d));
  after.facts.name = "ARENDT FUND SERVICES S.A.";
  const kinds = diffRecords(before, after).map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["authorisation_ended", "name_change"]);
});

test("golden: RCS wins the name and legal form, GLEIF fills the LEI, CSSF never claims struck-off", () => {
  const claims = [cssf(), gleif(), rcs()].flatMap((r) => Object.entries(r.facts).map(([attribute, value]) => ({ source: r.source, attribute, value })));
  const g = buildGolden(claims);
  assert.equal(g.canonicalName, "Arendt Investor Services SA");
  assert.equal(g.legalForm, "Public limited company");
  assert.equal(g.lei, "222100IVSOG87C1WWJ84");
  assert.equal(g.rcsNumber, "B145917");
  assert.equal(g.registrationDate, "2009-05-04");
  assert.equal(g.status, "active");
});

test("classify: Arendt (SPP with admin-agent status) → service provider in Fund Administration", () => {
  // Give seed rules and categories fake ids, as the seed script would.
  const slugIds = new Map<string, number>();
  const id = (slug?: string) => (slug ? (slugIds.get(slug) ?? slugIds.set(slug, slugIds.size + 1).get(slug)!) : null);
  const rules = RULES.map((r, i) => ({ id: i + 1, kind: r.kind, match: r.match, isServiceProvider: r.isServiceProvider ?? null, entityKind: r.entityKind ?? null, categoryId: id(r.category), subcategoryId: id(r.subcategory), tier: r.tier ?? null, priority: r.priority, enabled: true }));
  const rec = cssf();
  const c = classify({ cssfTypes: ["SPP"], cssfCodes: rec.cssfDetails!.filter((d) => !d.endDate).map((d) => d.code), hasRcs: true }, rules);
  assert.equal(c.isServiceProvider, true);
  assert.equal(c.entityKind, "service_provider");
  assert.equal(c.activityCategoryId, slugIds.get("fund-administration"));
  assert.equal(c.activitySubcategoryId, slugIds.get("fund-administration--fund-accounting-nav-calculation"));
  assert.equal(c.tier, 2);

  const corp = classify({ cssfTypes: [], cssfCodes: [], hasRcs: true }, rules, { corporateCategoryId: 99 });
  assert.deepEqual([corp.isServiceProvider, corp.entityKind, corp.activityCategoryId, corp.tier], [false, "corporate", 99, 0]);

  const manco = classify({ cssfTypes: ["C15"], cssfCodes: [], hasRcs: true }, rules);
  assert.deepEqual([manco.isServiceProvider, manco.entityKind, manco.activityCategoryId], [false, "asset_manager", slugIds.get("aifm-manco")]);
});

test("normalize: names and RCS numbers compare across sources", () => {
  assert.equal(normalizeName("ARENDT INVESTOR SERVICES S.A."), normalizeName("Arendt Investor Services SA"));
  assert.equal(normalizeName("FundCraft Services S.à r.l."), "fundcraft services");
  assert.equal(normalizeName("IQ EQ Depositary Services (Luxembourg) S.A."), "iq eq depositary services");
  assert.equal(normalizeRcs("b 145 917"), "B145917");
  assert.equal(normalizeRcs("B0145917"), "B145917");
  assert.equal(normalizeRcs("hello"), null);
});
