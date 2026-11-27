/**
 * FILE: services/engine/test/groups.test.ts
 * WHAT IT TESTS: the fund profile (packages/engine-db/src/core/fund-profile.ts) and the company-group builder
 *   (src/pipeline/groups.ts): planning is pure; persist() is checked against the engine DB when it is reachable,
 *   on groups with its own key prefix, so real groups are never touched.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool } from "@fundhub/engine-db/client";
import { fundProfile, mergeKind, vehicleOf, type FundProfileInput } from "@fundhub/engine-db/core/fund-profile";
import { companies, companyGroupMembers, companyGroups } from "@fundhub/engine-db/schema";
import { managerRole, planManagerMandates, type CurrentMandate, type ManagerLink } from "../src/pipeline/mandates";
import { addressKey, pickProvider, planDomiciliation, type Client, type Provider } from "../src/pipeline/domiciliation";
import { brandOf, csvFields, persist, planGroups, stem, type CompanyLite, type GroupPlan, type Rel } from "../src/pipeline/groups";

const base: FundProfileInput = { name: "", cssfTypes: [], cssfGroups: [], cssfSubGroups: [] };
const fp = (i: Partial<FundProfileInput>) => fundProfile({ ...base, ...i });

// ------------------------------------------------------------------ fund profile

test("fund profile: CSSF funds → UCITS / AIF, law and vehicle", () => {
  assert.deepEqual(
    (({ kind, fundRegime, fundLaw, legalVehicle, fundRole }) => ({ kind, fundRegime, fundLaw, legalVehicle, fundRole }))(
      fp({ name: "OPTIMIZE IP SICAV", cssfTypes: ["OPC"], cssfGroups: ["OPCLUX_1"], cssfSubGroups: ["OPCLUX_1_2"], compartments: 3 }),
    ),
    { kind: "fund", fundRegime: "ucits", fundLaw: "ucits_part_i", legalVehicle: "sicav", fundRole: "umbrella_fund" },
  );
  const p2 = fp({ name: "X FCP", cssfTypes: ["OPC"], cssfGroups: ["OPCLUX_2"], cssfSubGroups: ["OPCLUX_2_1"] });
  assert.equal(p2.fundRegime, "aif");
  assert.equal(p2.fundLaw, "uci_part_ii");
  assert.equal(p2.legalVehicle, "fcp");
  assert.equal(p2.fundRole, "standalone_fund");
  assert.equal(fp({ name: "Alpha SICAV-SIF", cssfTypes: ["FIS"], cssfGroups: ["FIS2-SICAV"] }).fundLaw, "sif");
  assert.equal(fp({ name: "Beta SICAR", cssfTypes: ["SIC"] }).fundLaw, "sicar");
  assert.equal(fp({ name: "Gamma S.A.", cssfTypes: ["TIT"] }).fundLaw, "securitisation");
});

test("fund profile: unregulated funds, RAIF, GLEIF sub-funds inherit the umbrella", () => {
  const raif = fp({ name: "Blue Ocean RAIF SCSp" });
  assert.equal(raif.kind, "fund");
  assert.equal(raif.fundLaw, "raif");
  assert.equal(raif.legalVehicle, "scsp");
  const sub = fp({ name: "MERCHFONDO", gleifCategory: "FUND", gleifLegalForm: "SUB-FUND", parentFund: { fundRegime: "ucits", fundLaw: "ucits_part_i" } });
  assert.deepEqual([sub.fundRole, sub.legalVehicle, sub.fundRegime, sub.fundLaw], ["sub_fund", "sub_fund", "ucits", "ucits_part_i"]);
  // A fund nobody lists as UCITS is an AIF.
  assert.equal(fp({ name: "Delta Fund SCSp", gleifCategory: "FUND" }).fundRegime, "aif");
  // Group role wins over the name.
  assert.equal(fp({ name: "Epsilon Holding S.à r.l.", structureRole: "holding" }).fundRole, "holding");
});

test("fund profile: general partners, SPVs, managers, plain companies", () => {
  const gp = fp({ name: "Blue Ocean GP S.à r.l." });
  assert.deepEqual([gp.kind, gp.fundRole, gp.legalVehicle], ["fund_vehicle", "general_partner", "sarl"]);
  assert.equal(fp({ name: "Project Atlas TopCo S.à r.l." }).fundRole, "spv");
  assert.equal(fp({ name: "Andbank AM S.A.", cssfTypes: ["C15", "AIFM_AUT"], cssfGroups: ["C15_2"] }).managerType, "super_manco");
  assert.equal(fp({ name: "Foo S.A.", cssfTypes: ["C15"], cssfGroups: ["C15_SUCC"] }).managerType, "manco_branch");
  assert.equal(fp({ name: "Foo Capital S.à r.l.", cssfTypes: ["AIFM_REG"] }).managerType, "aifm_registered");
  for (const name of ["Boulangerie Dupont S.à r.l.", "Fund Management Services S.A.", "Green Partners SCSp"]) {
    const p = fp({ name });
    assert.equal(p.kind, null, name);
    assert.equal(p.fundRegime, null, name);
  }
  // Regulated rule kinds are never overridden; plain corporates are.
  assert.equal(mergeKind("bank", fp({ name: "Fund Bank", gleifCategory: "FUND" })), "bank");
  assert.equal(mergeKind("corporate", gp), "fund_vehicle");
});

test("legal vehicle from texts and name suffixes", () => {
  const cases: [string, string | null][] = [
    ["XYZ S.à r.l.", "sarl"], ["XYZ SARL-S", "sarl"], ["Foo S.A.", "sa"], ["Bar SCSp", "scsp"], ["Baz S.C.S.", "scs"], ["Q SCA", "sca"],
    ["Société à responsabilité limitée", "sarl"], ["SOCIETE EN COMMANDITE SPECIALE", "scsp"], ["Fonds commun de placement", "fcp"], ["Plain Name", null],
  ];
  for (const [text, want] of cases) assert.equal(vehicleOf(text), want, text);
});

// ------------------------------------------------------------------ helpers

test("csvFields, stem, brandOf", () => {
  assert.deepEqual(csvFields('"A","B ""x"", y",,"D"'), ["A", 'B "x", y', "", "D"]);
  assert.equal(stem("Blue Ocean GP S.à r.l."), stem("Blue Ocean Fund II SCSp"));
  assert.equal(stem("Lux GP S.à r.l."), ""); // too generic to compare
  assert.equal(brandOf("Deloitte Tax & Consulting"), "deloitte");
  assert.equal(brandOf("Banque de Luxembourg"), "");
});

// ------------------------------------------------------------------ planning

const C = (id: string, name: string, extra: Partial<CompanyLite> = {}): CompanyLite => ({ id, name, lei: null, isServiceProvider: false, kind: "corporate", fundRole: null, ...extra });

test("planGroups: corporate → platform → structure → sub-funds, feeders, GP, provider groups", () => {
  const companies: CompanyLite[] = [
    C("mgr", "Andbank AM Luxembourg", { lei: "MGR", kind: "asset_manager" }),
    C("bank", "Andbank Luxembourg", { lei: "BANK", kind: "bank", isServiceProvider: true }),
    C("umb", "MERCHBANC FCP", { lei: "UMB", kind: "fund" }),
    C("sub1", "MERCHFONDO", { lei: "SUB1", kind: "fund" }),
    C("sub2", "RENTA FIJA", { kind: "fund" }),
    C("feeder", "Feeder Fund", { lei: "FEED", kind: "fund" }),
    C("blue", "Blue Ocean Fund SCSp", { lei: "BLUE", kind: "fund" }),
    C("gp", "Blue Ocean GP S.à r.l.", { kind: "fund_vehicle", fundRole: "general_partner" }),
    C("spv", "Blue Ocean Holding S.à r.l.", { lei: "SPV" }),
    C("d1", "Deloitte Audit", { isServiceProvider: true }),
    C("d2", "Deloitte Tax & Consulting", { isServiceProvider: true }),
    C("solo", "Lonely Advisers", { isServiceProvider: true }),
  ];
  const rels: Rel[] = [
    { start: "MGR", end: "ANDORRA", type: "IS_ULTIMATELY_CONSOLIDATED_BY" },
    { start: "BANK", end: "ANDORRA", type: "IS_ULTIMATELY_CONSOLIDATED_BY" },
    { start: "UMB", end: "MGR", type: "IS_FUND-MANAGED_BY" },
    { start: "SUB1", end: "UMB", type: "IS_SUBFUND_OF" },
    { start: "SUB1", end: "MGR", type: "IS_FUND-MANAGED_BY" },
    { start: "FEED", end: "UMB", type: "IS_FEEDER_TO" },
    { start: "SPV", end: "BLUE", type: "IS_DIRECTLY_CONSOLIDATED_BY" },
  ];
  const plan = planGroups({ companies, rels, compartments: [{ umbrellaId: "umb", companyId: "sub2", code: "O1_00000002" }], leiInfo: new Map([["ANDORRA", { name: "Andorra Banc Agricol Reig", country: "AD" }]]) });
  const roles = (key: string) => Object.fromEntries(plan.members.get(key) ?? []);

  const corp = plan.groups.get("gleif:corp:ANDORRA")!;
  assert.deepEqual([corp.name, corp.layer, corp.headCountry, corp.headCompanyId], ["Andorra Banc Agricol Reig", "corporate", "AD", null]);
  assert.deepEqual(Object.keys(roles("gleif:corp:ANDORRA")).sort(), ["bank", "mgr"]);

  const platform = plan.groups.get("gleif:mgr:MGR")!;
  assert.equal(platform.parentKey, "gleif:corp:ANDORRA");
  assert.equal(roles("gleif:mgr:MGR").mgr.role, "head");
  assert.equal(roles("gleif:mgr:MGR").umb.role, "managed_fund");
  assert.equal(roles("gleif:mgr:MGR").sub1, undefined, "sub-funds hang under the umbrella, not the platform");

  const fund = plan.groups.get("fund:UMB")!;
  assert.equal(fund.parentKey, "gleif:mgr:MGR");
  const fr = roles("fund:UMB");
  assert.deepEqual([fr.umb.role, fr.sub1.role, fr.sub2.role, fr.sub2.source, fr.feeder.role], ["umbrella_fund", "sub_fund", "sub_fund", "cssf", "feeder_fund"]);

  const blue = roles("fund:BLUE");
  assert.equal(blue.gp.role, "general_partner");
  assert.equal(blue.gp.source, "name_rule");
  assert.equal(blue.spv.role, "holding");

  // The bank is the group's service provider; Deloitte entities share a brand; a lone provider gets no group.
  assert.deepEqual(Object.keys(roles("prov:ANDORRA")), ["bank"]);
  assert.equal(plan.groups.get("prov:ANDORRA")!.parentKey, "gleif:corp:ANDORRA");
  assert.deepEqual(Object.keys(roles("brand:deloitte")).sort(), ["d1", "d2"]);
  assert.equal(plan.groups.get("brand:deloitte")!.confidence, 0.5);
  assert.ok(![...plan.groups.keys()].some((k) => k.includes("lonely")));
  for (const [key, g] of plan.groups) assert.ok(plan.members.get(key)?.size, `group ${g.name} has members`);
});

// ------------------------------------------------------------------ persist (needs the engine DB)

async function dbReady() {
  try {
    return (await pool.query("select to_regclass('core.company_groups') as t")).rows[0].t !== null;
  } catch {
    return false;
  }
}
const ready = await dbReady();
const RUN = `test:${Date.now()}:`;
const made: string[] = [];
after(async () => {
  if (ready) {
    await db.delete(companyGroups).where(like(companyGroups.key, `${RUN}%`));
    if (made.length) await db.delete(companies).where(inArray(companies.id, made));
  }
  await pool.end();
});

test("persist: idempotent, ends stale memberships, keeps manual ones", { skip: !ready && "engine DB not reachable" }, async () => {
  const ids: string[] = [];
  for (const n of ["A", "B", "C"]) {
    const [c] = await db.insert(companies).values({ canonicalName: `Groups Test ${n} ${RUN}`, normalizedName: `groups test ${n.toLowerCase()} ${RUN}` }).returning({ id: companies.id });
    ids.push(c.id);
    made.push(c.id);
  }
  const plan = (members: string[]): GroupPlan => ({
    groups: new Map([[`${RUN}g`, { key: `${RUN}g`, name: "Test group", layer: "corporate", kind: "corporate_group", source: "gleif", confidence: 1, headCompanyId: ids[0], headLei: null, headCountry: "LU", parentKey: null }]]),
    members: new Map([[`${RUN}g`, new Map(members.map((id, i) => [id, { role: i === 0 ? "head" : "subsidiary", source: "gleif", confidence: 1, evidence: "test" } as const]))]]),
  });
  const first = await persist(plan([ids[0], ids[1]]), RUN);
  assert.equal(first.stats.memberships, 2);
  const again = await persist(plan([ids[0], ids[1]]), RUN);
  assert.equal(again.stats.ended, 0);
  const [g] = await db.select().from(companyGroups).where(eq(companyGroups.key, `${RUN}g`));
  assert.equal(g.memberCount, 2);

  // A staff member added by hand survives; B is no longer planned and is ended.
  await db.insert(companyGroupMembers).values({ groupId: g.id, companyId: ids[2], role: "member", source: "manual" });
  const third = await persist(plan([ids[0]]), RUN);
  assert.equal(third.stats.ended, 1);
  const rows = await db.select().from(companyGroupMembers).where(eq(companyGroupMembers.groupId, g.id));
  const byId = Object.fromEntries(rows.map((r) => [r.companyId, r]));
  assert.equal(byId[ids[1]].validTo instanceof Date, true);
  assert.equal(byId[ids[2]].validTo, null);
  assert.equal(byId[ids[2]].source, "manual");

  // A plan without the group deletes it only if no staff member is in it: here one is, so it stays.
  const empty: GroupPlan = { groups: new Map(), members: new Map() };
  const fourth = await persist(empty, RUN);
  assert.equal(fourth.stats.deletedGroups, 0);
});

// ------------------------------------------------------------------ manager mandates (pure planning)


const link = (fundId: string, managerLei: string, extra: Partial<ManagerLink> = {}): ManagerLink => ({ fundId, fundRegime: "aif", managerLei, managerId: null, managerName: `Mgr ${managerLei}`, managerType: null, since: null, ...extra });
const cur = (id: number, clientId: string, providerLei: string, extra: Partial<CurrentMandate> = {}): CurrentMandate => ({ id, clientId, role: "aifm", providerCompanyId: null, providerLei, providerName: `Mgr ${providerLei}`, decidedBy: "gleif", validFrom: "2015-01-01", ...extra });

test("managerRole: ManCo for UCITS, AIFM otherwise", () => {
  assert.equal(managerRole({ managerType: "ucits_manco", fundRegime: "ucits" }), "management_company");
  assert.equal(managerRole({ managerType: "aifm_authorised", fundRegime: "aif" }), "aifm");
  assert.equal(managerRole({ managerType: "super_manco", fundRegime: "aif" }), "aifm");
  assert.equal(managerRole({ managerType: null, fundRegime: "ucits" }), "management_company");
  assert.equal(managerRole({ managerType: null, fundRegime: null }), "aifm");
});

test("planManagerMandates: start, keep, switch, end, staff wins, quiet first load", () => {
  const today = "2026-11-27";
  const plan = planManagerMandates(
    [
      link("new", "M1", { since: "2020-05-04" }), // no mandate yet → starts on GLEIF's date
      link("same", "M2", { since: "2015-01-01" }), // same manager → refreshed only
      link("switch", "M3", { since: "2024-03-01" }), // was M9 since 2015 → switch on 2024-03-01
      link("oldstart", "M4", { since: "2010-01-01" }), // was M8 since 2015; GLEIF date before → switch dated today
      link("staff", "M5"), // a person set this fund's manager → untouched
    ],
    [cur(1, "same", "M2"), cur(2, "switch", "M9"), cur(3, "oldstart", "M8"), cur(4, "staff", "MX", { decidedBy: "staff:a@b.c" }), cur(5, "gone", "M7")],
    today,
  );
  const ins = Object.fromEntries(plan.insert.map((n) => [n.clientId, n]));
  assert.deepEqual([ins.new.validFrom, ins.new.precision, ins.new.event], ["2020-05-04", "day", "mandate_started"]);
  assert.deepEqual([ins.switch.validFrom, ins.switch.event, ins.switch.previous], ["2024-03-01", "mandate_switched", "Mgr M9"]);
  assert.deepEqual([ins.oldstart.validFrom, ins.oldstart.precision], [today, "unknown"]);
  assert.equal(ins.same, undefined);
  assert.equal(ins.staff, undefined);
  const ends = Object.fromEntries(plan.end.map((e) => [e.id, e]));
  assert.deepEqual([ends[2].validTo, ends[2].precision, ends[2].reason], ["2024-03-01", "day", "switched"]);
  assert.deepEqual([ends[3].validTo, ends[3].precision], [today, "month"]);
  assert.deepEqual([ends[5].reason, ends[5].validTo], ["gone", today]);
  assert.equal(ends[4], undefined, "staff mandate never ended by the builder");
  assert.deepEqual(plan.touch.map((t) => t.id), [1]);
  // First load: history, not news.
  assert.ok(planManagerMandates([link("x", "M1")], [], today, true).insert.every((n) => n.event === null));
});

// ------------------------------------------------------------------ domiciliation by shared address


test("addressKey: postcode + house number, spelling-proof", () => {
  assert.equal(addressKey({ street: "5, Allée Scheffer", postcode: "L-2520", raw: "5, Allée Scheffer, L-2520 Luxembourg" }), "L-2520|5");
  assert.equal(addressKey({ raw: "5, ALLÉE SCHEFFER, L-2520 LUXEMBOURG, LU" }), "L-2520|5");
  assert.equal(addressKey({ raw: "2-4, rue Eugène Ruppert, L-2453 Luxembourg" }), "L-2453|2");
  assert.equal(addressKey({ raw: "1c, rue Gabriel Lippmann, L-5365 Munsbach" }), "L-5365|1c");
  assert.equal(addressKey({ raw: "WestSide Village, Immeuble Daphné, 89D, Parc d'activités Cap L-8308 Capellen" }), "L-8308|89d");
  assert.equal(addressKey({ street: "9, Rue de Bitbourg", postcode: "1273", raw: "9, Rue de Bitbourg, 1273 Luxembourg" }), "L-1273|9");
  assert.equal(addressKey({ raw: "rue sans numéro, L-1111 Luxembourg" }), null, "no house number: no key");
  assert.equal(addressKey({ raw: "1 Main St, Dublin", country: "IE" }), null, "only Luxembourg addresses");
});

test("planDomiciliation: start, keep, switch, end, own group excluded, ambiguous building, staff wins", () => {
  const P = (id: string, key: string, groups: number[] = []): Provider => ({ id, name: `Admin ${id}`, key, groups });
  const C = (id: string, key: string, groups: number[] = [], since: string | null = "2021-01-01"): Client => ({ id, key, groups, addressSince: since });
  const providers = [P("A", "L-2520|5", [1]), P("B", "L-1855|49", [2]), P("X", "L-1111|1", [7]), P("Y", "L-1111|1", [8])];
  const clients = [
    C("new", "L-2520|5"), // at A → new mandate dated by its address
    C("kept", "L-2520|5"), // already A's
    C("moved", "L-1855|49"), // was A's, now at B's address → switch
    C("sister", "L-2520|5", [1]), // A's own group → not a client
    C("shared", "L-1111|1"), // two unrelated admins in one building → ambiguous
    C("staff", "L-2520|5"), // a person set its domiciliation agent → untouched
  ];
  const current = [
    { id: 1, clientId: "kept", providerId: "A", providerName: "Admin A" },
    { id: 2, clientId: "moved", providerId: "A", providerName: "Admin A" },
    { id: 3, clientId: "left", providerId: "B", providerName: "Admin B" }, // no longer at an admin's address
  ];
  const plan = planDomiciliation(providers, clients, current, new Set(["staff"]), "2026-11-27");
  const ins = Object.fromEntries(plan.insert.map((n) => [n.clientId, n]));
  assert.deepEqual(Object.keys(ins).sort(), ["moved", "new"]);
  assert.deepEqual([ins.new.providerId, ins.new.validFrom, ins.new.event], ["A", "2021-01-01", "mandate_started"]);
  assert.deepEqual([ins.moved.providerId, ins.moved.event, ins.moved.previous, ins.moved.validFrom], ["B", "mandate_switched", "Admin A", "2026-11-27"]);
  assert.deepEqual(plan.end.map((e) => [e.id, e.reason]).sort(), [[2, "switched"], [3, "gone"]]);
  assert.deepEqual(plan.touch, [1]);
  assert.equal(plan.ambiguous, 1);
});

test("pickProvider: one firm (group or brand) → its best entity; several firms → the only one that domiciles", () => {
  const P = (id: string, extra: Partial<Provider> = {}): Provider => ({ id, name: id, key: "k", groups: [], ...extra });
  assert.equal(pickProvider([P("Alter Domus Luxembourg", { brand: "alter", domiciles: true }), P("Alter Domus Fund Services", { brand: "alter", fundAdmin: true })])?.id, "Alter Domus Luxembourg");
  assert.equal(pickProvider([P("UBS Fund Services", { brand: "ubs", fundAdmin: true }), P("UBS Fund Administration", { brand: "ubs", fundAdmin: true })])?.id, "UBS Fund Administration", "same brand: by name");
  assert.equal(pickProvider([P("A", { groups: [5] }), P("B", { groups: [5], domiciles: true })])?.id, "B", "same ownership group");
  assert.equal(pickProvider([P("GPFS", { brand: "gpfs", domiciles: true }), P("Fisch Fund Services", { brand: "fisch" })])?.id, "GPFS", "only one firm domiciles");
  assert.equal(pickProvider([P("X", { brand: "x" }), P("Y", { brand: "y" })]), null, "two unrelated firms: ambiguous");
});
