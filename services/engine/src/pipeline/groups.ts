/**
 * FILE: services/engine/src/pipeline/groups.ts
 * PART: scraping engine (services/engine) — company groups (core.company_groups / core.company_group_members)
 * WHAT IT DOES: Builds the three grouping layers from the evidence we have, then saves them (job `build_groups`):
 *   corporate        corporate_group  ← GLEIF "is ultimately / directly consolidated by", international branches;
 *   fund             fund_platform    ← GLEIF "is fund-managed by" (one ManCo/AIFM + the funds it manages),
 *                      └ fund_structure ← GLEIF "is sub-fund of" / "is feeder to", CSSF compartments (sub-funds),
 *                                       general partners matched by name, SPVs / holdings whose parent is a fund;
 *   service_provider provider_group   ← the service providers of a corporate group, or a shared brand word.
 *   Steps: (1) CSSF compartments become sub-fund companies; (2) GLEIF's daily relationship file (golden copy,
 *   ~25 MB) is read, keeping links that touch our companies; (3) names of foreign parents / managers come from
 *   the GLEIF API; (4) planGroups() — pure — decides every group and membership; (5) persist() upserts them,
 *   ends memberships that disappeared and deletes empty generated groups; (6) companies whose structure role
 *   changed are reclassified (fund role, UCITS / AIF inherited from the umbrella).
 *   Staff-made groups and memberships (source "manual") are never changed.
 * WHERE IT RUNS: engine workers (group "maintenance"). Needs the `unzip` command.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { recomputeCompany, withActor } from "@fundhub/engine-db/core/entity";
import { plain } from "@fundhub/engine-db/core/fund-profile";
import { normalizeName } from "@fundhub/engine-db/core/normalize";
import { changes, companies, companyGroupMembers, companyGroups, companyIdentifiers, type GroupKind, type GroupLayer, type GroupRole, type GroupSource } from "@fundhub/engine-db/schema";
import type { PoliteHttp } from "../http";
import { log } from "../log";
import { syncManagerMandates } from "./mandates";

// ------------------------------------------------------------------ types

/** Kind: type alias. What planning needs to know about a company. */
export type CompanyLite = {
  id: string;
  name: string;
  lei: string | null;
  isServiceProvider: boolean;
  kind: string;
  fundRole: string | null;
};
/** Kind: type alias. One GLEIF relationship (only ACTIVE ones are kept). */
/** `since` = the relationship period start (GLEIF RELATIONSHIP_PERIOD), e.g. when a fund manager was appointed. */
export type Rel = { start: string; end: string; type: string; since?: string | null };
/** Kind: type alias. A CSSF sub-fund (compartment) of a fund in our database. */
export type Compartment = { umbrellaId: string; companyId: string; code: string };
export type PlannedGroup = {
  key: string;
  name: string;
  layer: GroupLayer;
  kind: GroupKind;
  source: Exclude<GroupSource, "manual">;
  confidence: number;
  headCompanyId: string | null;
  headLei: string | null;
  headCountry: string | null;
  parentKey: string | null;
};
export type PlannedMember = { role: GroupRole; source: Exclude<GroupSource, "manual">; confidence: number; evidence: string };
export type GroupPlan = { groups: Map<string, PlannedGroup>; members: Map<string, Map<string, PlannedMember>> };

// ------------------------------------------------------------------ name helpers

/** Words removed to compare a general partner's name with its fund's ("Blue Ocean GP S.à r.l." ↔ "Blue Ocean Fund SCSp"). */
const STEM_NOISE = new Set(
  "gp general partner associe commandite gerant managing s a r l sarl scsp sp slp scs sca sa sas sicav sicaf sicar raif sif fis fcp fund funds fonds lux luxembourg i ii iii iv v vi vii viii ix x the co".split(" "),
);
/** Kind: function. The distinctive part of a fund-world name, or "" when too generic to compare. */
export function stem(name: string): string {
  const s = plain(name)
    .split(" ")
    .filter((w) => w && !STEM_NOISE.has(w))
    .join(" ");
  return s.replace(/\s/g, "").length >= 4 ? s : "";
}

/** Words too common to be a provider brand. */
const BRAND_NOISE = new Set(
  "the la le les de du des et and of banque bank banca banco fund funds fonds luxembourg lux international internationale european europe global capital asset assets management managers investment investments services service trust trustees financial finance partners partner group groupe company societe first new advisory advisors consulting conseil corporate solutions fiduciaire fiduciary audit tax accounting legal law private wealth securities custody depositary administration administrative compliance risk data digital it systems technologies technology"
    .split(" "),
);
/** Kind: function. A service provider's brand word (first distinctive word), or "". */
export function brandOf(name: string): string {
  const w = plain(name).split(" ").find((x) => x.length >= 3 && !BRAND_NOISE.has(x) && !/^\d+$/.test(x));
  return w ?? "";
}

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ planning (pure)

/**
 * Kind: function. Decides every generated group and membership.
 * @param input.companies     our companies (all, or at least every one with an LEI and every service provider / fund / GP).
 * @param input.rels          GLEIF relationships touching our companies.
 * @param input.compartments  CSSF sub-funds and their umbrella.
 * @param input.leiInfo       names / countries of LEIs that are not our companies (foreign parents, managers).
 * @returns `GroupPlan`.
 */
export function planGroups(input: { companies: CompanyLite[]; rels: Rel[]; compartments: Compartment[]; leiInfo: Map<string, { name: string; country: string | null }> }): GroupPlan {
  const groups = new Map<string, PlannedGroup>();
  const members = new Map<string, Map<string, PlannedMember>>();
  const byLei = new Map(input.companies.filter((c) => c.lei).map((c) => [c.lei!, c]));
  const byId = new Map(input.companies.map((c) => [c.id, c]));
  const nameOf = (lei: string) => byLei.get(lei)?.name ?? input.leiInfo.get(lei)?.name ?? lei;

  const rel = (type: string) => new Map(input.rels.filter((r) => r.type === type).map((r) => [r.start, r.end]));
  const ultimate = rel("IS_ULTIMATELY_CONSOLIDATED_BY");
  const direct = rel("IS_DIRECTLY_CONSOLIDATED_BY");
  const manager = rel("IS_FUND-MANAGED_BY");
  const umbrella = rel("IS_SUBFUND_OF");
  const master = rel("IS_FEEDER_TO");
  const branchOf = rel("IS_INTERNATIONAL_BRANCH_OF");

  const group = (g: Omit<PlannedGroup, "confidence" | "headCountry"> & { confidence?: number; headCountry?: string | null }) => {
    if (!groups.has(g.key)) groups.set(g.key, { confidence: 1, headCountry: null, ...g });
    return g.key;
  };
  const member = (key: string, companyId: string, m: PlannedMember) => {
    if (!members.has(key)) members.set(key, new Map());
    const list = members.get(key)!;
    const before = list.get(companyId);
    // Keep the most specific claim: a head stays head; otherwise the more confident one wins.
    if (!before || (before.role !== "head" && (m.role === "head" || m.confidence > before.confidence))) list.set(companyId, m);
  };
  const country = (lei: string) => input.leiInfo.get(lei)?.country ?? (byLei.has(lei) ? "LU" : null);

  // ---- corporate layer
  const topOf = (lei: string) => ultimate.get(lei) ?? direct.get(lei) ?? null;
  const corpKey = (lei: string) => `gleif:corp:${lei}`;
  const corpGroup = (top: string) =>
    group({ key: corpKey(top), name: nameOf(top), layer: "corporate", kind: "corporate_group", source: "gleif", headCompanyId: byLei.get(top)?.id ?? null, headLei: top, headCountry: country(top), parentKey: null });
  for (const c of input.companies) {
    if (!c.lei) continue;
    const top = topOf(c.lei);
    if (!top || top === c.lei) continue;
    const key = corpGroup(top);
    member(key, c.id, { role: "subsidiary", source: "gleif", confidence: 1, evidence: `GLEIF ${ultimate.has(c.lei) ? "IS_ULTIMATELY_CONSOLIDATED_BY" : "IS_DIRECTLY_CONSOLIDATED_BY"} ${top}` });
    const head = byLei.get(top);
    if (head) member(key, head.id, { role: "head", source: "gleif", confidence: 1, evidence: "GLEIF ultimate parent" });
  }
  for (const [branch, headLei] of branchOf) {
    const b = byLei.get(branch);
    if (!b) continue;
    const top = topOf(headLei) ?? headLei;
    const key = corpGroup(top);
    member(key, b.id, { role: "branch", source: "gleif", confidence: 1, evidence: `GLEIF IS_INTERNATIONAL_BRANCH_OF ${headLei}` });
  }
  /** The corporate group a company (by LEI) belongs to, if any. */
  const corpOf = (lei: string) => {
    const top = topOf(lei);
    if (top && groups.has(corpKey(top))) return corpKey(top);
    return groups.has(corpKey(lei)) ? corpKey(lei) : null;
  };

  // ---- fund platforms (one manager, the funds it manages)
  const platformKey = (mgr: string) => `gleif:mgr:${mgr}`;
  const platform = (mgr: string) => {
    const key = group({ key: platformKey(mgr), name: nameOf(mgr), layer: "fund", kind: "fund_platform", source: "gleif", headCompanyId: byLei.get(mgr)?.id ?? null, headLei: mgr, headCountry: country(mgr), parentKey: corpOf(mgr) });
    const head = byLei.get(mgr);
    if (head) member(key, head.id, { role: "head", source: "gleif", confidence: 1, evidence: "GLEIF fund manager" });
    return key;
  };
  for (const [fundLei, mgr] of manager) {
    const f = byLei.get(fundLei);
    if (!f || umbrella.has(fundLei)) continue; // sub-funds hang under their umbrella's structure
    member(platform(mgr), f.id, { role: "managed_fund", source: "gleif", confidence: 1, evidence: `GLEIF IS_FUND-MANAGED_BY ${mgr}` });
  }

  // ---- fund structures (umbrella / master / standalone fund + sub-funds, feeders, vehicles)
  const fundKey = (c: { id: string; lei: string | null }) => (c.lei ? `fund:${c.lei}` : `fund:c:${c.id}`);
  const structure = (head: { id: string | null; lei: string | null; name: string }, headRole: GroupRole) => {
    const key = head.lei ? `fund:${head.lei}` : `fund:c:${head.id}`;
    const mgr = head.lei ? manager.get(head.lei) : undefined;
    group({ key, name: head.name, layer: "fund", kind: "fund_structure", source: "gleif", headCompanyId: head.id, headLei: head.lei, headCountry: head.lei ? country(head.lei) : "LU", parentKey: mgr ? platform(mgr) : null });
    if (head.id) member(key, head.id, { role: headRole, source: "gleif", confidence: 1, evidence: "structure head" });
    return key;
  };
  for (const [sub, umb] of umbrella) {
    const s = byLei.get(sub);
    if (!s) continue;
    const key = structure({ id: byLei.get(umb)?.id ?? null, lei: umb, name: nameOf(umb) }, "umbrella_fund");
    member(key, s.id, { role: "sub_fund", source: "gleif", confidence: 1, evidence: `GLEIF IS_SUBFUND_OF ${umb}` });
  }
  for (const comp of input.compartments) {
    const u = byId.get(comp.umbrellaId);
    if (!u || comp.companyId === u.id) continue;
    const key = structure({ id: u.id, lei: u.lei, name: u.name }, "umbrella_fund");
    member(key, comp.companyId, { role: "sub_fund", source: "cssf", confidence: 1, evidence: `CSSF compartment ${comp.code}` });
  }
  for (const [feeder, mst] of master) {
    const f = byLei.get(feeder);
    if (!f) continue;
    const key = structure({ id: byLei.get(mst)?.id ?? null, lei: mst, name: nameOf(mst) }, "master_fund");
    member(key, f.id, { role: "feeder_fund", source: "gleif", confidence: 1, evidence: `GLEIF IS_FEEDER_TO ${mst}` });
  }
  // SPVs / holdings whose direct parent is a fund.
  for (const c of input.companies) {
    if (!c.lei) continue;
    const p = direct.get(c.lei);
    const parent = p ? byLei.get(p) : undefined;
    if (!parent || parent.kind !== "fund" || c.kind === "fund") continue;
    const key = structure({ id: parent.id, lei: parent.lei, name: parent.name }, "head");
    member(key, c.id, { role: /\bholding/.test(plain(c.name)) ? "holding" : "spv", source: "gleif", confidence: 0.9, evidence: `GLEIF IS_DIRECTLY_CONSOLIDATED_BY fund ${p}` });
  }
  // General partners matched by name with at most 5 funds ("Blue Ocean GP" ↔ "Blue Ocean Fund I/II SCSp").
  const fundsByStem = new Map<string, CompanyLite[]>();
  for (const c of input.companies) {
    if (c.kind !== "fund" || c.fundRole === "sub_fund") continue;
    const s = stem(c.name);
    if (s) fundsByStem.set(s, [...(fundsByStem.get(s) ?? []), c]);
  }
  for (const gp of input.companies) {
    if (gp.fundRole !== "general_partner") continue;
    const funds = fundsByStem.get(stem(gp.name)) ?? [];
    if (!funds.length || funds.length > 5) continue;
    for (const f of funds) {
      const key = structure({ id: f.id, lei: f.lei, name: f.name }, members.get(fundKey(f))?.size ? "umbrella_fund" : "head");
      member(key, gp.id, { role: "general_partner", source: "name_rule", confidence: 0.7, evidence: `name: ${gp.name} ↔ ${f.name}` });
    }
  }
  // Structures found only through vehicles are "name_rule" groups.
  for (const [key, g] of groups) {
    if (g.kind !== "fund_structure") continue;
    const ms = [...(members.get(key)?.values() ?? [])];
    if (ms.length && ms.every((m) => m.source === "name_rule" || m.evidence === "structure head")) {
      g.source = ms.some((m) => m.source === "name_rule") ? "name_rule" : g.source;
      g.confidence = 0.7;
    }
    if (ms.some((m) => m.source === "cssf") && !ms.some((m) => m.source === "gleif" && m.evidence !== "structure head")) g.source = "cssf";
  }

  // ---- service-provider layer: providers of a corporate group, else a shared brand word
  const inProvider = new Set<string>();
  for (const [key, g] of [...groups]) {
    if (g.kind !== "corporate_group") continue;
    const sps = [...(members.get(key) ?? new Map()).entries()].filter(([id]) => byId.get(id)?.isServiceProvider);
    if (!sps.length) continue;
    const pk = group({ key: `prov:${g.headLei}`, name: g.name, layer: "service_provider", kind: "provider_group", source: "gleif", headCompanyId: g.headCompanyId, headLei: g.headLei, headCountry: g.headCountry, parentKey: key });
    for (const [id, m] of sps) {
      member(pk, id, { role: m.role === "head" ? "head" : "member", source: "gleif", confidence: 1, evidence: m.evidence });
      inProvider.add(id);
    }
  }
  const byBrand = new Map<string, CompanyLite[]>();
  for (const c of input.companies) {
    if (!c.isServiceProvider || inProvider.has(c.id)) continue;
    const b = brandOf(c.name);
    if (b) byBrand.set(b, [...(byBrand.get(b) ?? []), c]);
  }
  for (const [b, list] of byBrand) {
    if (list.length < 2) continue;
    const key = group({ key: `brand:${b}`, name: title(b), layer: "service_provider", kind: "provider_group", source: "name_rule", confidence: 0.5, headCompanyId: null, headLei: null, parentKey: null });
    for (const c of list) member(key, c.id, { role: "member", source: "name_rule", confidence: 0.5, evidence: `brand word "${b}"` });
  }

  // Drop groups that ended up with no members of ours (e.g. a platform whose funds are all sub-funds).
  for (const key of [...groups.keys()]) if (!members.get(key)?.size) groups.delete(key);
  for (const g of groups.values()) if (g.parentKey && !groups.has(g.parentKey)) g.parentKey = null;
  return { groups, members };
}

// ------------------------------------------------------------------ inputs

/** Kind: function. Splits one CSV line with "quoted" fields ("" = a quote inside a field). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const GOLDEN_COPY = "https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest";

/** Kind: async function. Downloads GLEIF's relationship golden copy (once per ~20 h) and returns the zip path. */
async function relationshipFile(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, "gleif-rr.csv.zip");
  if (existsSync(zip) && Date.now() - statSync(zip).mtimeMs < 20 * 3600_000) return zip;
  try {
    const meta = (await (await fetch(GOLDEN_COPY, { signal: AbortSignal.timeout(30_000) })).json()) as { data: { rr: { full_file: { csv: { url: string } } } } };
    const res = await fetch(meta.data.rr.full_file.csv.url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    if (!existsSync(zip)) throw err;
    log.warn("gleif relationship file: download failed, using the previous copy", { error: String(err) });
  }
  return zip;
}

/** Kind: async function. Active GLEIF relationships where at least one side is one of `ours`. */
export async function readRelationships(zip: string, ours: Set<string>): Promise<Rel[]> {
  const unzip = spawn("unzip", ["-p", zip], { stdio: ["ignore", "pipe", "inherit"] });
  const rl = createInterface({ input: unzip.stdout, crlfDelay: Infinity });
  const rels: Rel[] = [];
  let head: string[] | null = null;
  let iS = 0, iE = 0, iT = 0, iSt = 0;
  let periods: [number, number][] = [];
  for await (const line of rl) {
    if (!head) {
      head = csvFields(line);
      iS = head.indexOf("Relationship.StartNode.NodeID");
      iE = head.indexOf("Relationship.EndNode.NodeID");
      iT = head.indexOf("Relationship.RelationshipType");
      iSt = head.indexOf("Relationship.RelationshipStatus");
      // Up to 5 periods per relationship; the one typed RELATIONSHIP_PERIOD dates the relationship itself.
      periods = [1, 2, 3, 4, 5]
        .map((n) => [head!.indexOf(`Relationship.Period.${n}.startDate`), head!.indexOf(`Relationship.Period.${n}.periodType`)] as [number, number])
        .filter(([a, b]) => a >= 0 && b >= 0);
      continue;
    }
    // Cheap pre-filter: only parse lines that mention one of our LEIs (first two fields).
    const start = line.slice(1, 21);
    const end = line.slice(line.indexOf(",") + 2, line.indexOf(",") + 22);
    if (!ours.has(start) && !ours.has(end)) continue;
    const f = csvFields(line);
    if (f[iSt] !== "ACTIVE") continue;
    const period = periods.find(([, t]) => f[t] === "RELATIONSHIP_PERIOD");
    // A start date before 1900 is a typing error at the source (GLEIF has "1019-…"): treated as unknown.
    const since = period && f[period[0]] ? f[period[0]].slice(0, 10) : null;
    rels.push({ start: f[iS], end: f[iE], type: f[iT], since: since && since >= "1900-01-01" ? since : null });
  }
  await new Promise((r) => unzip.on("close", r));
  return rels;
}

/** Kind: async function. Names and countries of LEIs that are not our companies (GLEIF API, 100 per call). */
async function lookupLeis(leis: string[], http: PoliteHttp, apiBase: string, delayMs: number) {
  const out = new Map<string, { name: string; country: string | null }>();
  for (let i = 0; i < leis.length; i += 100) {
    const batch = leis.slice(i, i + 100);
    const url = `${apiBase}/lei-records?filter[lei]=${batch.join(",")}&page[size]=100`;
    try {
      const { json } = await http.getJson<{ data: { attributes: { lei: string; entity: { legalName: { name: string }; legalAddress: { country: string } } } }[] }>(url, { delayMs });
      for (const d of json?.data ?? []) out.set(d.attributes.lei, { name: d.attributes.entity.legalName.name, country: d.attributes.entity.legalAddress?.country ?? null });
    } catch (err) {
      log.warn("gleif lookup failed", { error: String(err) });
    }
  }
  return out;
}

/**
 * Kind: async function. Every active CSSF compartment becomes (or is linked to) a sub-fund company: matched by
 * its CSSF code or LEI, otherwise created. @returns the compartments with their company ids, and how many were created.
 */
export async function ensureCompartmentCompanies(): Promise<{ compartments: Compartment[]; created: number; createdIds: string[] }> {
  const rows = (
    await db.execute<{ umbrella_id: string; code: string; label: string | null; lei: string | null }>(sql`
      select distinct on (split_part(l.code, '-', 1)) r.company_id as umbrella_id, split_part(l.code, '-', 1) as code, l.label, l.lei
      from clean.licences l join staging.source_records r on r.id = l.source_record_id
      where l.kind = 'compartment' and l.end_date is null and r.company_id is not null and r.state = 'found'
      order by split_part(l.code, '-', 1), l.last_seen_at desc`)
  ).rows;
  if (!rows.length) return { compartments: [], created: 0, createdIds: [] };
  const ids = await db
    .select({ scheme: companyIdentifiers.scheme, value: companyIdentifiers.value, companyId: companyIdentifiers.companyId })
    .from(companyIdentifiers)
    .where(inArray(companyIdentifiers.scheme, ["cssf_compartment", "lei"]));
  const byCode = new Map(ids.filter((i) => i.scheme === "cssf_compartment").map((i) => [i.value, i.companyId]));
  const byLei = new Map(ids.filter((i) => i.scheme === "lei").map((i) => [i.value, i.companyId]));
  const leiTaken = new Set((await db.select({ lei: companies.lei }).from(companies).where(sql`${companies.lei} is not null`)).map((r) => r.lei!));
  const out: Compartment[] = [];
  let created = 0;
  const createdIds: string[] = [];
  for (const r of rows) {
    let companyId = byCode.get(r.code) ?? (r.lei ? byLei.get(r.lei) : undefined);
    const name = (r.label ?? r.code).trim();
    await db.transaction(async (tx) => {
      await withActor(tx, "engine:groups");
      if (!companyId) {
        const lei = r.lei && !leiTaken.has(r.lei) ? r.lei : null;
        const [c] = await tx
          .insert(companies)
          .values({ canonicalName: name, normalizedName: normalizeName(name), status: "active", companyKind: "fund", fundRole: "sub_fund", legalVehicle: "sub_fund", registryStatus: "compartment", lei })
          .returning({ id: companies.id });
        companyId = c.id;
        created++;
        createdIds.push(c.id);
        if (lei) {
          leiTaken.add(lei);
          await tx.insert(companyIdentifiers).values({ companyId, scheme: "lei", value: lei, source: "cssf" }).onConflictDoNothing();
          byLei.set(lei, companyId);
        }
        await tx.insert(changes).values({ companyId, source: "cssf", kind: "new_company", newValue: { name, compartment: r.code }, actor: "engine:groups" });
      }
      if (!byCode.has(r.code)) {
        await tx.insert(companyIdentifiers).values({ companyId: companyId!, scheme: "cssf_compartment", value: r.code, source: "cssf" }).onConflictDoNothing();
        byCode.set(r.code, companyId!);
      }
    });
    out.push({ umbrellaId: r.umbrella_id, companyId: companyId!, code: r.code });
  }
  return { compartments: out, created, createdIds };
}

// ------------------------------------------------------------------ persist

/** Kind: async function. Which of these company ids still exist (in chunks: Postgres takes at most 65 535 parameters). */
async function existingCompanies(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 5000) {
    for (const r of await db.select({ id: companies.id }).from(companies).where(inArray(companies.id, ids.slice(i, i + 5000)))) out.add(r.id);
  }
  return out;
}

/**
 * Kind: async function. Saves a plan. Never touches manual groups or memberships.
 * @param keyPrefix  only generated groups whose key starts with this are cleaned up (memberships ended, empty
 *                   groups deleted). Default "": all of them. Tests pass their own prefix.
 */
export async function persist(plan: GroupPlan, keyPrefix = "") {
  const stats = { groups: plan.groups.size, memberships: 0, ended: 0, deletedGroups: 0 };
  const heads = [...new Set([...plan.groups.values()].map((g) => g.headCompanyId).filter(Boolean))] as string[];
  const liveHeads = await existingCompanies(heads);
  const rows = [...plan.groups.values()].map((g) => (g.headCompanyId && !liveHeads.has(g.headCompanyId) ? { ...g, headCompanyId: null } : g));
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((g) => ({
      key: g.key, name: g.name, layer: g.layer, kind: g.kind, source: g.source, confidence: g.confidence,
      headCompanyId: g.headCompanyId, headLei: g.headLei, headCountry: g.headCountry,
    }));
    await db
      .insert(companyGroups)
      .values(batch)
      .onConflictDoUpdate({
        target: companyGroups.key,
        set: {
          name: sql`excluded.name`, layer: sql`excluded.layer`, kind: sql`excluded.kind`, source: sql`excluded.source`, confidence: sql`excluded.confidence`,
          headCompanyId: sql`excluded.head_company_id`, headLei: sql`excluded.head_lei`, headCountry: sql`excluded.head_country`, updatedAt: sql`now()`,
        },
        setWhere: sql`${companyGroups.source} <> 'manual'`,
      });
  }
  const all = (await db.select({ id: companyGroups.id, key: companyGroups.key, source: companyGroups.source, parent: companyGroups.parentGroupId }).from(companyGroups)).filter((g) =>
    g.key.startsWith(keyPrefix) || plan.groups.has(g.key) || [...plan.groups.values()].some((p) => p.parentKey === g.key),
  );
  const scoped = new Set(all.filter((g) => g.key.startsWith(keyPrefix)).map((g) => g.id));
  const idOf = new Map(all.map((g) => [g.key, g.id]));

  // Parents (generated groups only).
  for (const g of rows) {
    const id = idOf.get(g.key)!;
    const parent = g.parentKey ? (idOf.get(g.parentKey) ?? null) : null;
    const now = all.find((a) => a.id === id);
    if (now && now.source !== "manual" && now.parent !== parent) await db.update(companyGroups).set({ parentGroupId: parent }).where(eq(companyGroups.id, id));
  }

  // Memberships: upsert planned ones.
  const planned = new Set<string>();
  const mrows: (typeof companyGroupMembers.$inferInsert)[] = [];
  for (const [key, ms] of plan.members) {
    const groupId = idOf.get(key);
    if (!groupId) continue;
    for (const [companyId, m] of ms) {
      planned.add(`${groupId}|${companyId}`);
      mrows.push({ groupId, companyId, role: m.role, source: m.source, confidence: m.confidence, evidence: m.evidence });
    }
  }
  // Companies can be merged (deleted) by ingestion while the builder runs: drop rows whose company is gone.
  const alive = await existingCompanies([...new Set(mrows.map((m) => m.companyId))]);
  const liveRows = mrows.filter((m) => alive.has(m.companyId));
  for (let i = 0; i < liveRows.length; i += 1000) {
    await db
      .insert(companyGroupMembers)
      .values(liveRows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [companyGroupMembers.groupId, companyGroupMembers.companyId],
        set: { role: sql`excluded.role`, source: sql`excluded.source`, confidence: sql`excluded.confidence`, evidence: sql`excluded.evidence`, validTo: null },
        setWhere: sql`${companyGroupMembers.source} <> 'manual'`,
      });
  }
  stats.memberships = liveRows.length;

  // End generated memberships that are no longer planned.
  const current = await db
    .select({ id: companyGroupMembers.id, groupId: companyGroupMembers.groupId, companyId: companyGroupMembers.companyId })
    .from(companyGroupMembers)
    .where(and(isNull(companyGroupMembers.validTo), sql`${companyGroupMembers.source} <> 'manual'`));
  const stale = current.filter((m) => scoped.has(m.groupId) && !planned.has(`${m.groupId}|${m.companyId}`)).map((m) => m.id);
  for (let i = 0; i < stale.length; i += 1000) await db.update(companyGroupMembers).set({ validTo: new Date() }).where(inArray(companyGroupMembers.id, stale.slice(i, i + 1000)));
  stats.ended = stale.length;

  // Generated groups no longer planned and without staff members: removed.
  const gone = all.filter((g) => scoped.has(g.id) && g.source !== "manual" && !plan.groups.has(g.key)).map((g) => g.id);
  if (gone.length) {
    const keep = new Set(
      (await db.selectDistinct({ id: companyGroupMembers.groupId }).from(companyGroupMembers).where(and(inArray(companyGroupMembers.groupId, gone), eq(companyGroupMembers.source, "manual")))).map((r) => r.id),
    );
    const del = gone.filter((id) => !keep.has(id));
    for (let i = 0; i < del.length; i += 1000) await db.delete(companyGroups).where(inArray(companyGroups.id, del.slice(i, i + 1000)));
    stats.deletedGroups = del.length;
  }
  await db.execute(sql`
    update core.company_groups g set member_count = coalesce(m.n, 0)
    from core.company_groups g2 left join (select group_id, count(*)::int n from core.company_group_members where valid_to is null group by 1) m on m.group_id = g2.id
    where g.id = g2.id and g.member_count is distinct from coalesce(m.n, 0)`);
  return { stats, staleCompanyIds: current.filter((m) => stale.includes(m.id)).map((m) => m.companyId) };
}

// ------------------------------------------------------------------ job

const ROLE_TO_FUND_ROLE: Partial<Record<GroupRole, string>> = {
  sub_fund: "sub_fund", feeder_fund: "feeder_fund", master_fund: "master_fund", umbrella_fund: "umbrella_fund", general_partner: "general_partner", spv: "spv", holding: "holding",
};

/**
 * Kind: async function. Job "build_groups": rebuilds every generated group, then reclassifies the companies whose
 * place in a fund structure changed. Heads (umbrellas, masters) are reclassified first so sub-funds inherit
 * their UCITS / AIF profile.
 */
export async function buildGroups(opts: { http: PoliteHttp; gleifApiBase: string; gleifDelayMs: number; cacheDir?: string; skipGleif?: boolean }) {
  const t0 = Date.now();
  const { compartments, created, createdIds } = await ensureCompartmentCompanies();
  const list = (
    await db.execute<{ id: string; name: string; lei: string | null; sp: boolean; kind: string; fund_role: string | null; regime: string | null; manager_type: string | null }>(sql`
      select c.id, c.canonical_name as name, coalesce(c.lei, (select value from core.company_identifiers i where i.company_id = c.id and i.scheme = 'lei' limit 1)) as lei,
             c.is_service_provider as sp, c.company_kind as kind, c.fund_role, c.fund_regime as regime, c.manager_type
      from core.companies c`)
  ).rows;
  const lite: CompanyLite[] = list.map((r) => ({ id: r.id, name: r.name, lei: r.lei, isServiceProvider: r.sp, kind: r.kind, fundRole: r.fund_role }));
  const ours = new Set(lite.filter((c) => c.lei).map((c) => c.lei!));

  let rels: Rel[] = [];
  let leiInfo = new Map<string, { name: string; country: string | null }>();
  if (!opts.skipGleif && ours.size) {
    const zip = await relationshipFile(opts.cacheDir ?? resolve(".engine-data", "gleif"));
    rels = await readRelationships(zip, ours);
    const foreign = [...new Set(rels.flatMap((r) => [r.start, r.end]))].filter((l) => !ours.has(l));
    leiInfo = await lookupLeis(foreign, opts.http, opts.gleifApiBase, opts.gleifDelayMs);
  }
  const plan = planGroups({ companies: lite, rels, compartments, leiInfo });
  const { stats, staleCompanyIds } = await persist(plan);

  // Reclassify where the structure role (or the umbrella's regime) no longer matches the company.
  const info = new Map(list.map((r) => [r.id, r]));
  const heads: string[] = [];
  const others = new Set<string>(staleCompanyIds);
  for (const [key, ms] of plan.members) {
    const g = plan.groups.get(key)!;
    if (g.kind !== "fund_structure") continue;
    for (const [id, m] of ms) {
      const want = ROLE_TO_FUND_ROLE[m.role] ?? null;
      const c = info.get(id);
      const headRegime = g.headCompanyId ? info.get(g.headCompanyId)?.regime : null;
      // Inheritance only matters when the umbrella is ours and has a regime of its own.
      const stale = !c || (want && c.fund_role !== want) || ((m.role === "sub_fund" || m.role === "feeder_fund") && !!headRegime && c.regime !== headRegime);
      if (!stale) continue;
      if (m.role === "umbrella_fund" || m.role === "master_fund" || m.role === "head") heads.push(id);
      else others.add(id);
    }
  }
  // New sub-fund companies have no classification yet.
  for (const id of createdIds) others.add(id);
  const order = [...new Set(heads), ...[...others].filter((id) => !heads.includes(id))];
  for (let i = 0; i < order.length; i += 200) {
    await db.transaction(async (tx) => {
      await withActor(tx, "engine:groups");
      for (const id of order.slice(i, i + 200)) await recomputeCompany(tx, id);
    });
  }
  // Fund-manager mandates (dated episodes) from the same GLEIF relationships.
  const mandateStats = opts.skipGleif
    ? null
    : await syncManagerMandates({
        rels,
        leiInfo,
        // Fresh regimes / manager types: the reclassification above just gave sub-funds their umbrella's UCITS / AIF.
        companies: (
          await db.execute<{ id: string; lei: string | null; name: string; manager_type: string | null; regime: string | null }>(sql`
            select c.id, coalesce(c.lei, (select value from core.company_identifiers i where i.company_id = c.id and i.scheme = 'lei' limit 1)) as lei,
                   c.canonical_name as name, c.manager_type, c.fund_regime as regime
            from core.companies c`)
        ).rows.map((r) => ({ id: r.id, lei: r.lei, name: r.name, managerType: r.manager_type, regime: r.regime })),
      });
  const result = { ...stats, mandates: mandateStats, relationships: rels.length, compartments: compartments.length, subFundsCreated: created, reclassified: order.length, seconds: Math.round((Date.now() - t0) / 1000) };
  log.info("build_groups", result);
  return result;
}
