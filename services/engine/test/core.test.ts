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
import { contentHash, countryName, normalizeCountries, normalizeCountry, normalizeName, normalizeRcs } from "../src/core/normalize";
import { resolveRecord, type ResolverStore } from "../src/core/resolve";
import type { ParsedRecord } from "../src/core/types";
import { parseCssf } from "../src/sources/cssf/parse";
import { parseGleif } from "../src/sources/gleif/parse";
import { parseRcsSearchList, parseRcsText } from "../src/sources/rcs/parse";
import { countWords, foldTerm, letterWords, nameWords, wordPhase } from "@fundhub/engine-db/core/sweep";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const json = (source: "cssf" | "gleif", id: string, file: string) => ({ source, externalId: id, url: "", httpStatus: 200, contentType: "application/json", body: fx(file), ext: "json" });
const cssf = () => parseCssf(json("cssf", "7013419", "cssf-7013419.json"));
const gleif = () => parseGleif(json("gleif", "222100IVSOG87C1WWJ84", "gleif-222100IVSOG87C1WWJ84.json"));
const rcs = () => parseRcsText(fx("rcs-B145917.txt").toString("utf8"), "B145917");

/** Kind: class. A ResolverStore in memory, mirroring the database behaviour. */
class MemStore implements ResolverStore {
  companies = new Map<string, { name: string; normalizedName: string; postcode: string | null }>();
  ids = new Map<string, string>(); // "scheme:value" → entity id
  candidates: { companyId: string; method: MatchMethod; decision: string }[] = [];
  #n = 0;
  async findByIdentifier(scheme: IdScheme, value: string) {
    return this.ids.get(`${scheme}:${value}`) ?? null;
  }
  async findByName(n: string) {
    return [...this.companies].filter(([, e]) => e.normalizedName === n).map(([companyId, e]) => ({ companyId, postcode: e.postcode }));
  }
  async exists(companyId: string) {
    return this.companies.has(companyId);
  }
  async createCompany(seed: { canonicalName: string; normalizedName: string }) {
    const id = `e${++this.#n}`;
    this.companies.set(id, { name: seed.canonicalName, normalizedName: seed.normalizedName, postcode: null });
    return id;
  }
  async addIdentifiers(companyId: string, ids: { scheme: IdScheme; value: string }[]) {
    for (const i of ids) if (!this.ids.has(`${i.scheme}:${i.value}`)) this.ids.set(`${i.scheme}:${i.value}`, companyId);
  }
  async merge(keep: string, drop: string) {
    for (const [k, v] of this.ids) if (v === drop) this.ids.set(k, keep);
    this.companies.delete(drop);
  }
  async addCandidate(companyId: string, method: MatchMethod, _score: number, decision: string) {
    this.candidates.push({ companyId, method, decision });
  }
  /** Like recomputeCompany: remember the postcode a record reported. */
  touch(companyId: string, rec: ParsedRecord) {
    const e = this.companies.get(companyId)!;
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
      store.touch(res.companyId, rec);
      links.set(name, res.companyId);
    }
    assert.equal(store.companies.size, 1, `companies left: ${[...store.companies.keys()]}`);
    const only = [...store.companies.keys()][0];
    assert.equal(store.ids.get("rcs:B145917"), only);
    assert.equal(store.ids.get("lei:222100IVSOG87C1WWJ84"), only);
    assert.equal(store.ids.get("cssf_code:P00000348"), only);
  });
}

test("resolve: same name in another postcode is NOT merged, only flagged for review", async () => {
  const store = new MemStore();
  const a = cssf();
  const r1 = await resolveRecord(a, store);
  store.touch(r1.companyId, a);
  const b: ParsedRecord = { ...cssf(), externalId: "999", identifiers: [{ scheme: "cssf_id", value: "999" }], facts: { ...a.facts, lei: null, address: { raw: "x", postcode: "8070" } } };
  const r2 = await resolveRecord(b, store);
  assert.notEqual(r1.companyId, r2.companyId);
  assert.equal(store.candidates.at(-1)!.decision, "pending");
});

test("diff: a new filing on the next capture is exactly one new_filing event", () => {
  const before = rcs();
  const after = rcs();
  after.filings = [{ filingNumber: "L260400001", filingDate: "2026-10-30", type: "Authorized signature list", details: [], corrects: null, correctedBy: null, hasDocuments: true }, ...after.filings!];
  after.facts.rcsFilingCount = after.filings.length;
  const changes = diffRecords(before, after);
  assert.equal(changes.filter((c) => c.kind === "new_filing").length, 1);
  assert.equal(changes.filter((c) => c.kind === "attribute_changed").length, 1); // rcsFilingCount
  assert.equal(diffRecords(before, rcs()).length, 0);
  assert.equal(contentHash(before), contentHash(rcs()));
});

test("diff: an authorisation that gets an end date is authorisation_ended; a name change is name_change", () => {
  const before = cssf();
  const after = cssf();
  after.licences = after.licences!.map((d) => (d.code === "ACT_SPP_DOM" ? { ...d, endDate: "2026-10-01" } : d));
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
  const rules = RULES.map((r, i) => ({ id: i + 1, kind: r.kind, match: r.match, isServiceProvider: r.isServiceProvider ?? null, companyKind: r.companyKind ?? null, categoryId: id(r.category), subcategoryId: id(r.subcategory), tier: r.tier ?? null, priority: r.priority, enabled: true }));
  const rec = cssf();
  const c = classify({ cssfTypes: ["SPP"], cssfCodes: rec.licences!.filter((d) => !d.endDate).map((d) => d.code), hasRcs: true }, rules);
  assert.equal(c.isServiceProvider, true);
  assert.equal(c.companyKind, "service_provider");
  assert.equal(c.activityCategoryId, slugIds.get("fund-administration"));
  assert.equal(c.activitySubcategoryId, slugIds.get("fund-administration--fund-accounting-nav-calculation"));
  assert.equal(c.tier, 2);

  const corp = classify({ cssfTypes: [], cssfCodes: [], hasRcs: true }, rules, { corporateCategoryId: 99 });
  assert.deepEqual([corp.isServiceProvider, corp.companyKind, corp.activityCategoryId, corp.tier], [false, "corporate", 99, 0]);

  const manco = classify({ cssfTypes: ["C15"], cssfCodes: [], hasRcs: true }, rules);
  // A ManCo / AIFM provides management services to funds: a service provider (kind stays asset_manager).
  assert.deepEqual([manco.isServiceProvider, manco.companyKind, manco.activityCategoryId], [true, "asset_manager", slugIds.get("aifm-manco")]);
});

test("countries: names, codes and French spellings become ISO codes", () => {
  assert.equal(normalizeCountry("Ireland"), "IE");
  assert.equal(normalizeCountry("lu"), "LU");
  assert.equal(normalizeCountry("Irlande"), "IE");
  assert.equal(normalizeCountry("UK"), "GB");
  assert.equal(normalizeCountry("Jersey"), "JE");
  assert.equal(normalizeCountry("Narnia"), null);
  assert.deepEqual(normalizeCountries(["Luxembourg", "Ireland", "LU", "Netherlands", "Jersey", "?"]), ["IE", "JE", "LU", "NL"]);
  assert.equal(countryName("JE"), "Jersey");
});

test("diff: clients added and removed on the website become relation events", () => {
  const base: ParsedRecord = {
    source: "website",
    externalId: "arendt.com",
    state: "found",
    facts: { website: "https://www.arendt.com", operatingCountries: ["LU"] },
    identifiers: [],
    names: [],
    relations: [
      { kind: "client", objectName: "Silverline SICAV", evidenceUrl: "https://www.arendt.com/clients", confidence: 0.8 },
      { kind: "client", objectName: "Baltica PE S.à r.l.", evidenceUrl: "https://www.arendt.com/clients", confidence: 0.8 },
    ],
  };
  const next: ParsedRecord = {
    ...base,
    facts: { ...base.facts, operatingCountries: ["IE", "LU"] },
    // Same client spelled differently (legal form) is NOT a change; Baltica is gone; Kingsway is new.
    relations: [
      { kind: "client", objectName: "SILVERLINE SICAV", evidenceUrl: null, confidence: 0.8 },
      { kind: "client", objectName: "Kingsway RE", evidenceUrl: null, confidence: 0.8 },
    ],
  };
  const changes = diffRecords(base, next);
  assert.deepEqual(changes.map((c) => `${c.kind}:${c.attribute}`).sort(), ["attribute_changed:operatingCountries", "relation_added:client", "relation_ended:client"]);
  // A record that does not report relations at all never ends existing ones.
  assert.equal(diffRecords(base, { ...base, relations: undefined }).filter((c) => c.kind === "relation_ended").length, 0);
});

test("golden: website, countries and logo come from the web source", () => {
  const logo = { blobKey: "logos/ab/ab.png", sourceUrl: "https://www.arendt.com/logo.png", mime: "image/png", sha256: "ab", bytes: 10 };
  const g = buildGolden([
    { source: "gleif", attribute: "website", value: "http://arendt.lu" },
    { source: "website", attribute: "website", value: "https://www.arendt.com" },
    { source: "website", attribute: "operatingCountries", value: ["LU"] },
    { source: "website", attribute: "logo", value: logo },
  ]);
  assert.equal(g.website, "https://www.arendt.com");
  assert.deepEqual(g.operatingCountries, ["LU"]);
  assert.deepEqual(g.logo, logo);
  // An empty list is "no information", not "operates nowhere".
  assert.equal(buildGolden([{ source: "website", attribute: "operatingCountries", value: [] }]).operatingCountries, undefined);
});

test("normalize: names and RCS numbers compare across sources", () => {
  assert.equal(normalizeName("ARENDT INVESTOR SERVICES S.A."), normalizeName("Arendt Investor Services SA"));
  assert.equal(normalizeName("FundCraft Services S.à r.l."), "fundcraft services");
  assert.equal(normalizeName("IQ EQ Depositary Services (Luxembourg) S.A."), "iq eq depositary services");
  assert.equal(normalizeRcs("b 145 917"), "B145917");
  assert.equal(normalizeRcs("B0145917"), "B145917");
  assert.equal(normalizeRcs("hello"), null);
});

// ---------------------------------------------------------------- LBR search sweep (words)
test("sweep: name words are folded like LBR compares them (whole words, accents ignored)", () => {
  assert.deepEqual(nameWords("AR CAPITAL INVEST S.àr.l."), ["ar", "capital", "invest", "s", "l"]);
  assert.deepEqual(nameWords("B & B2B SA"), ["b", "b2b", "sa"]);
  // RCS-number look-alikes would open one company instead of a list: never searched.
  assert.deepEqual(nameWords("B2 Lux E123 Société"), ["lux", "societe"]);
  assert.equal(foldTerm("  Société  Générale "), "societe generale");
});

test("sweep: phases — common words, then aa…zzz, then the rarer name words", () => {
  assert.equal(wordPhase("fund", 20480), 1);
  assert.equal(wordPhase("ab", 3), 2);
  assert.equal(wordPhase("abc", 0), 2);
  assert.equal(wordPhase("arendt", 4), 3);
  const l = letterWords();
  assert.equal(l.length, 26 * 26 + 26 * 26 * 26);
  assert.deepEqual([l[0], l[1], l[675], l[676]], ["aa", "ab", "zz", "aaa"]);
});

test("search list: a search without results is an empty list (booked, not a company page)", () => {
  const text = ["Search for information", "B3168", "Your search was not successful. Please modify your search criteria.", "Site map"].join("\n");
  assert.deepEqual(parseRcsSearchList(text), { total: 0, items: [] });
});

test("sweep: words are counted once per name", () => {
  const c = countWords(["Alpha Lux S.à r.l.", "Beta Lux Lux SA", "Alpha Beta"]);
  assert.equal(c.get("lux"), 2);
  assert.equal(c.get("alpha"), 2);
  assert.equal(c.get("a"), 1);
});

test("search list: French status lines (radiée, en faillite, en liquidation judiciaire)", () => {
  const text = ["199 search result(s) for \"\"", "RCS number", "Trade name", "B108301", "B de B", "B112849", "B.B. INVEST", "radiée", "B246954", "B16 TP", "en faillite", "B1", "X SA", "en liquidation judiciaire", "B250137", "Carine G.B.", "Site map"].join("\n");
  const list = parseRcsSearchList(text)!;
  assert.deepEqual(
    list.items.map((i) => [i.rcs, i.status]),
    [["B108301", null], ["B112849", "struck_off"], ["B246954", "in_liquidation"], ["B1", "in_liquidation"], ["B250137", null]],
  );
});

// ------------------------------------------------------------------ layered pipeline: pure stages

import { consolidate, PRECEDENCE as SEED_PRECEDENCE } from "@fundhub/engine-db/core/golden";
import type { ReviewPolicy } from "@fundhub/engine-db/schema";
import { canonicalUrl, cleanRecord, normalizePhone, normalizePostcode } from "../src/pipeline/clean";
import { evaluate, pickPolicy } from "../src/pipeline/gate";
import { buildIndex, findMentions } from "../src/pipeline/mentions";

test("clean: normalizes values and rejects bad ones (never silently)", () => {
  const rec: ParsedRecord = {
    source: "website",
    externalId: "acme.lu",
    state: "found",
    facts: { name: "  Acme   Services  S.A. ", website: "ACME.lu/?utm_campaign=x#top", email: "jean.dupont@acme.lu", phone: "+352 (0) 26 12 34 56", headcount: 0, address: { raw: "1 rue X, 1234 Luxembourg", postcode: "1234", country: "Luxembourg" } },
    identifiers: [],
    names: [],
    people: [{ fullName: "Our team", title: "", role: "employee" }, { fullName: "Marie Curie", title: " CEO ", role: "executive" }],
  };
  const { record, rejects } = cleanRecord(rec);
  assert.equal(record.facts.name, "Acme Services S.A.");
  assert.equal(record.facts.website, "https://acme.lu");
  assert.equal(record.facts.phone, "+35226123456");
  assert.equal(record.facts.address?.postcode, "L-1234");
  assert.equal(record.facts.address?.country, "LU");
  assert.equal(record.facts.email, undefined, "a person's e-mail is dropped");
  assert.equal(record.facts.headcount, undefined);
  assert.deepEqual(record.people?.map((p) => [p.fullName, p.title]), [["Marie Curie", "CEO"]]);
  assert.deepEqual(rejects.map((r) => r.attribute).sort(), ["email", "headcount", "people"]);
  assert.equal(rec.facts.email, "jean.dupont@acme.lu", "the input is not modified");
  assert.equal(canonicalUrl("not a url"), null);
  assert.equal(normalizePhone("0049 30 1234567"), "+49301234567");
  assert.equal(normalizePostcode("2222", "BE"), "2222");
});

const pol = (p: Partial<ReviewPolicy>): ReviewPolicy => ({ id: 1, source: "*", scope: "*", mode: "auto", conditions: {}, sampleRate: 0, enabled: true, note: null, updatedBy: null, updatedAt: new Date(), ...p });

test("gate: most specific policy wins; each mode and condition", () => {
  const all = [pol({ id: 1 }), pol({ id: 2, source: "cssf", mode: "review_if", conditions: { protectedAttributes: ["status"], parserChanged: true } }), pol({ id: 3, source: "cssf", scope: "SPP", mode: "review_all" }), pol({ id: 4, source: "gleif", mode: "review_all", enabled: false })];
  assert.equal(pickPolicy(all, "cssf", "SPP")?.id, 3);
  assert.equal(pickPolicy(all, "cssf", "B")?.id, 2);
  assert.equal(pickPolicy(all, "gleif", null)?.id, 1, "disabled policies are skipped");
  const base = { source: "cssf", scope: "B", newRecord: false, newCompany: false, parserChanged: false, changes: [], confidence: null };
  assert.equal(evaluate(all[1], base).hold, false);
  assert.deepEqual(evaluate(all[1], { ...base, changes: [{ kind: "status_change", attribute: "status" }] }).reasons, ["protected attribute changed: status"]);
  assert.equal(evaluate(all[1], { ...base, parserChanged: true }).hold, true);
  assert.equal(evaluate(all[1], { ...base, newRecord: true, parserChanged: true, changes: [{ kind: "new_record" }] }).hold, false, "a first version is not a 'change'");
  assert.equal(evaluate(pol({ mode: "review_if", conditions: { minConfidence: 0.8 } }), { ...base, confidence: 0.6 }).reasons[0], "confidence 60% below 80%");
  assert.equal(evaluate(pol({ mode: "sample", sampleRate: 0.1 }), { ...base, random: 0.05 }).hold, true);
  assert.equal(evaluate(pol({ mode: "sample", sampleRate: 0.1 }), { ...base, random: 0.5 }).hold, false);
});

test("consolidate: precedence, lineage, conflicts (cosmetic differences are not conflicts), manual wins", () => {
  const out = consolidate(
    [
      { id: 1, source: "gleif", attribute: "name", value: "ACME SERVICES S.A." },
      { id: 2, source: "rcs", attribute: "name", value: "Acme Services SA" },
      { id: 3, source: "rcs", attribute: "status", value: "unknown" },
      { id: 4, source: "gleif", attribute: "status", value: "active" },
      { id: 5, source: "rcs", attribute: "address", value: { raw: "x", postcode: "L-1111" } },
      { id: 6, source: "gleif", attribute: "address", value: { raw: "y", postcode: "L-2222" } },
      { id: 7, source: "website", attribute: "website", value: "https://acme.lu" },
      { id: 8, source: "manual", attribute: "website", value: "https://www.acme.com" },
    ],
    SEED_PRECEDENCE,
  );
  assert.equal(out.golden.canonicalName, "Acme Services SA");
  assert.equal(out.golden.status, "active", "'unknown' never overrides a real status");
  assert.equal(out.golden.website, "https://www.acme.com");
  // Name and address follow precedence only (LBR first, then CSSF…): no conflict for a person to check.
  assert.deepEqual(out.conflicts.map((c) => c.attribute), [], "name / address mismatches never open conflicts");
  assert.equal(out.golden.registeredAddress?.postcode, "L-1111", "the RCS address wins over GLEIF's");
  const addr = out.lineage.find((l) => l.attribute === "address")!;
  assert.deepEqual([addr.source, addr.sourcesAgreeing, addr.sourcesTotal], ["rcs", 1, 2], "the disagreement stays visible in the lineage");
  const name = out.lineage.find((l) => l.attribute === "name")!;
  assert.deepEqual([name.source, name.claimId, name.sourcesAgreeing, name.sourcesTotal], ["rcs", 2, 2, 2]);
  assert.equal(out.sourceCount, 3);
});

test("mentions: dictionary match by tokens, confidence, distinctive names only", () => {
  const idx = buildIndex([
    { id: "a", normalized_name: "arendt and medernach", canonical_name: "Arendt & Medernach SA" },
    { id: "b", normalized_name: "capital", canonical_name: "Capital SA" },
    { id: "c", normalized_name: "alterdomus", canonical_name: "Alterdomus" },
  ]);
  const hits = findMentions("Arendt & Medernach SA advised the deal in Luxembourg; Alterdomus administers it. Capital markets…", idx, "c");
  const by = Object.fromEntries(hits.map((h) => [h.companyId, h.confidence]));
  assert.equal(by.a, 0.9);
  assert.equal(by.c, 0.99);
  assert.equal(by.b, undefined, "one common word is never a mention");
});

import { pressName } from "../src/pipeline/mentions";

test("mentions: press-name alias ('Creditreform Luxembourg S.A.' is written 'Creditreform')", () => {
  assert.equal(pressName("Banque de Luxembourg"), "Banque de Luxembourg");
  assert.equal(pressName("Alter Domus (Luxembourg) S.à r.l."), "Alter Domus");
  const idx = buildIndex([{ id: "k", normalized_name: "creditreform luxembourg", canonical_name: "Creditreform Luxembourg S.A." }]);
  assert.deepEqual(findMentions("Creditreform warns of rising insolvencies", idx, null).map((h) => h.companyId), ["k"]);
});

test("clean: LBR status words in names ('radiée', 'en liquidation') become the status, never part of the name", async () => {
  const { cleanRecord, statusInName } = await import("../src/pipeline/clean");
  assert.deepEqual(statusInName("DEME Offshore LU SA , radiée"), { status: "struck_off", rest: "DEME Offshore LU SA" });
  assert.deepEqual(statusInName("radiée"), { status: "struck_off", rest: "" });
  assert.deepEqual(statusInName("Foo S.A. (en liquidation judiciaire)"), { status: "in_liquidation", rest: "Foo S.A." });
  assert.equal(statusInName("Gradient Holding"), null, "a word containing 'radi' is not a status");
  assert.equal(statusInName("Radiant Capital S.à r.l."), null);
  const rec = (name: string, status?: "active" | "in_liquidation" | "struck_off" | "unknown") => ({ source: "gleif" as const, externalId: "x", state: "found" as const, facts: { name, ...(status ? { status } : {}) }, identifiers: [], names: [] });
  const a = cleanRecord(rec("DEME Offshore LU SA , radiée", "unknown"));
  assert.deepEqual([a.record.facts.name, a.record.facts.status], ["DEME Offshore LU SA", "struck_off"]);
  const b = cleanRecord(rec("radiée"));
  assert.equal(b.record.facts.name, undefined);
  assert.equal(b.record.facts.status, "struck_off");
  assert.equal(b.rejects[0].attribute, "name");
  // A status the source states explicitly is kept.
  assert.equal(cleanRecord(rec("Foo S.A. en liquidation", "struck_off")).record.facts.status, "struck_off");
});
