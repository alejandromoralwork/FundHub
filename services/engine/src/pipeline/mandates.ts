/**
 * FILE: services/engine/src/pipeline/mandates.ts
 * PART: scraping engine (services/engine) — service mandates (core.mandates, core.mandate_evidence)
 * WHAT IT DOES: Keeps the fund-manager mandates (ManCo / AIFM of every fund and sub-fund) as dated episodes, from
 *   GLEIF's "IS_FUND-MANAGED_BY" relationships and their RELATIONSHIP_PERIOD start date:
 *   - a new manager → a mandate starting on the relationship's start date ("mandate_started");
 *   - a different manager than the current episode → the old episode ends, a new one starts ("mandate_switched");
 *   - the relationship disappeared → the episode ends today ("mandate_ended", month precision);
 *   - same manager → last_seen_at refreshed, a missing start date filled in.
 *   Role: management_company when the manager is a UCITS ManCo (or the fund is UCITS), otherwise aifm.
 *   Episodes made by staff (decided_by "staff:…") win: a fund with a staff manager mandate is left alone.
 *   planManagerMandates() is pure (tested); syncManagerMandates() reads and writes. Called by build_groups.
 * WHERE IT RUNS: engine workers.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { withActor } from "@fundhub/engine-db/core/entity";
import { changes, mandateEvidence, mandates, type MandateRole } from "@fundhub/engine-db/schema";
import { log } from "../log";
import type { Rel } from "./groups";

/** Kind: type alias. A fund and the manager GLEIF names for it. */
export type ManagerLink = {
  fundId: string;
  fundRegime: string | null;
  managerLei: string;
  managerId: string | null;
  managerName: string;
  managerType: string | null;
  /** GLEIF relationship start (YYYY-MM-DD), when given. */
  since: string | null;
};
/** Kind: type alias. A current manager mandate already in the database. */
export type CurrentMandate = { id: number; clientId: string; role: string; providerCompanyId: string | null; providerLei: string | null; providerName: string; decidedBy: string; validFrom: string | null };

export type MandatePlan = {
  insert: { clientId: string; role: MandateRole; providerCompanyId: string | null; providerLei: string; providerName: string; validFrom: string; precision: "day" | "unknown"; since: string | null; event: "mandate_started" | "mandate_switched" | null; previous: string | null }[];
  end: { id: number; clientId: string; validTo: string; precision: "day" | "month"; providerName: string; reason: "switched" | "gone" }[];
  touch: { id: number; role: MandateRole; providerCompanyId: string | null; providerName: string; fillFrom: string | null }[];
};

/**
 * Kind: constant. GLEIF began collecting fund relationships (data format 3.1) in spring 2023: thousands of fund
 * managers were reported then with that date as the relationship start. A start in this window means "on or
 * before", not an appointment: stored with precision "unknown" so it never counts as a change.
 */
export const GLEIF_FUND_ONBOARDING = { from: "2023-03-01", to: "2023-06-30" };
const onboarding = (d: string | null) => !!d && d >= GLEIF_FUND_ONBOARDING.from && d <= GLEIF_FUND_ONBOARDING.to;

const MANCO = new Set(["ucits_manco", "super_manco", "manco_branch", "manco_ch16"]);
const AIFM = new Set(["aifm_authorised", "aifm_registered", "aifm_branch"]);

/** Kind: function. Which manager role a link means. */
export function managerRole(l: Pick<ManagerLink, "managerType" | "fundRegime">): MandateRole {
  if (l.managerType && MANCO.has(l.managerType) && l.fundRegime !== "aif") return "management_company";
  if (l.managerType && AIFM.has(l.managerType)) return "aifm";
  if (l.managerType === "super_manco") return "aifm"; // a super-ManCo managing an AIF acts as its AIFM
  return l.fundRegime === "ucits" ? "management_company" : "aifm";
}

/**
 * Kind: function. Decides inserts, ends and refreshes.
 * @param links    one per fund (GLEIF links).
 * @param current  current manager mandates (gleif-made and staff-made) of every fund.
 * @param today    YYYY-MM-DD.
 * @param initial  first load: no change events (the start dates are history, not news).
 */
export function planManagerMandates(links: ManagerLink[], current: CurrentMandate[], today: string, initial = false): MandatePlan {
  const plan: MandatePlan = { insert: [], end: [], touch: [] };
  const byFund = new Map<string, CurrentMandate[]>();
  for (const m of current) byFund.set(m.clientId, [...(byFund.get(m.clientId) ?? []), m]);
  const linked = new Set<string>();

  for (const l of links) {
    linked.add(l.fundId);
    const mine = byFund.get(l.fundId) ?? [];
    if (mine.some((m) => m.decidedBy.startsWith("staff:"))) continue; // staff decided this fund's manager
    const role = managerRole(l);
    const cur = mine.find((m) => m.decidedBy === "gleif");
    const sameProvider = cur && (cur.providerLei === l.managerLei || (!!cur.providerCompanyId && cur.providerCompanyId === l.managerId));
    if (cur && sameProvider) {
      const fillFrom = !cur.validFrom && l.since ? l.since : null;
      if (fillFrom || cur.role !== role || cur.providerCompanyId !== l.managerId || cur.providerName !== l.managerName) {
        plan.touch.push({ id: cur.id, role, providerCompanyId: l.managerId, providerName: l.managerName, fillFrom });
      } else plan.touch.push({ id: cur.id, role, providerCompanyId: l.managerId, providerName: l.managerName, fillFrom: null });
      continue;
    }
    // New episode: dated by GLEIF when that start is after the old episode's start, else from today.
    const usable = l.since && (!cur || !cur.validFrom || l.since > cur.validFrom) && l.since <= today ? l.since : null;
    const start = usable ?? today;
    if (cur) plan.end.push({ id: cur.id, clientId: l.fundId, validTo: start, precision: usable ? "day" : "month", providerName: cur.providerName, reason: "switched" });
    plan.insert.push({
      clientId: l.fundId, role, providerCompanyId: l.managerId, providerLei: l.managerLei, providerName: l.managerName,
      validFrom: start, precision: usable && !onboarding(usable) ? "day" : "unknown", since: l.since,
      event: initial ? null : cur ? "mandate_switched" : "mandate_started", previous: cur?.providerName ?? null,
    });
  }
  // GLEIF no longer names a manager for a fund we had one for: the episode ends.
  for (const m of current) {
    if (m.decidedBy !== "gleif" || linked.has(m.clientId)) continue;
    plan.end.push({ id: m.id, clientId: m.clientId, validTo: today, precision: "month", providerName: m.providerName, reason: "gone" });
  }
  return plan;
}

/**
 * Kind: async function. Builds the links from GLEIF relationships and applies the plan.
 * @param input.rels       GLEIF relationships (only IS_FUND-MANAGED_BY are used).
 * @param input.companies  our companies with LEI, manager type and fund regime.
 * @param input.leiInfo    names of managers that are not our companies.
 */
export async function syncManagerMandates(input: {
  rels: Rel[];
  companies: { id: string; lei: string | null; name: string; managerType: string | null; regime: string | null }[];
  leiInfo: Map<string, { name: string; country: string | null }>;
}) {
  const byLei = new Map(input.companies.filter((c) => c.lei).map((c) => [c.lei!, c]));
  const links: ManagerLink[] = [];
  const seen = new Set<string>();
  for (const r of input.rels) {
    if (r.type !== "IS_FUND-MANAGED_BY") continue;
    const fund = byLei.get(r.start);
    if (!fund || seen.has(fund.id)) continue;
    seen.add(fund.id);
    const mgr = byLei.get(r.end);
    links.push({
      fundId: fund.id, fundRegime: fund.regime, managerLei: r.end, managerId: mgr?.id ?? null,
      managerName: mgr?.name ?? input.leiInfo.get(r.end)?.name ?? r.end, managerType: mgr?.managerType ?? null, since: r.since ?? null,
    });
  }
  const current = (
    await db
      .select({ id: mandates.id, clientId: mandates.clientCompanyId, role: mandates.role, providerCompanyId: mandates.providerCompanyId, providerLei: mandates.providerLei, providerName: mandates.providerName, decidedBy: mandates.decidedBy, validFrom: mandates.validFrom })
      .from(mandates)
      .where(and(eq(mandates.status, "current"), inArray(mandates.role, ["management_company", "aifm"])))
  ).map((m) => ({ ...m, validFrom: m.validFrom ? String(m.validFrom).slice(0, 10) : null }));
  const initial = !current.some((m) => m.decidedBy === "gleif");
  const today = new Date().toISOString().slice(0, 10);
  const plan = planManagerMandates(links, current, today, initial);

  const now = new Date();
  // Ends first (a switch's old episode must end before the new one starts: exclusion constraint).
  for (let i = 0; i < plan.end.length; i += 500) {
    await db.transaction(async (tx) => {
      await withActor(tx, "engine:mandates");
      for (const e of plan.end.slice(i, i + 500)) {
        await tx.update(mandates).set({ status: "ended", validTo: e.validTo, validToPrecision: e.precision, lastSeenAt: now }).where(eq(mandates.id, e.id));
        if (e.reason === "gone") await tx.insert(changes).values({ companyId: e.clientId, source: "gleif", kind: "mandate_ended", attribute: "manager", oldValue: e.providerName, actor: "engine:mandates" });
      }
    });
  }
  for (let i = 0; i < plan.insert.length; i += 500) {
    const batch = plan.insert.slice(i, i + 500);
    await db.transaction(async (tx) => {
      await withActor(tx, "engine:mandates");
      const ids = await tx
        .insert(mandates)
        .values(batch.map((n) => ({ clientCompanyId: n.clientId, providerCompanyId: n.providerCompanyId, providerName: n.providerName, providerLei: n.providerLei, role: n.role, exclusive: true, validFrom: n.validFrom, validFromPrecision: n.precision, status: "current" as const, decidedBy: "gleif" })))
        .returning({ id: mandates.id });
      await tx
        .insert(mandateEvidence)
        .values(batch.map((n, k) => ({ mandateId: ids[k].id, source: "gleif" as const, documentDate: n.since, url: `https://search.gleif.org/#/record/${n.providerLei}`, quote: `GLEIF IS_FUND-MANAGED_BY ${n.providerLei}${n.since ? ` since ${n.since}` : ""}` })))
        .onConflictDoNothing();
      const events = batch.filter((n) => n.event);
      if (events.length) {
        await tx.insert(changes).values(events.map((n) => ({ companyId: n.clientId, source: "gleif" as const, kind: n.event!, attribute: "manager", oldValue: n.previous, newValue: n.providerName, actor: "engine:mandates" })));
      }
    });
  }
  // Refreshes: one statement per batch (role / provider / name / missing start / last seen).
  for (let i = 0; i < plan.touch.length; i += 1000) {
    const batch = plan.touch.slice(i, i + 1000);
    await db.execute(sql`
      update core.mandates m set last_seen_at = now(), role = v.role, provider_company_id = v.pid::uuid, provider_name = v.pname,
        valid_from = coalesce(m.valid_from, v.vfrom::date),
        valid_from_precision = case when m.valid_from is null and v.vfrom is not null
                                    then case when v.vfrom between ${GLEIF_FUND_ONBOARDING.from} and ${GLEIF_FUND_ONBOARDING.to} then 'unknown' else 'day' end
                                    else m.valid_from_precision end
      from (select * from jsonb_to_recordset(${JSON.stringify(batch.map((t) => ({ id: t.id, role: t.role, pid: t.providerCompanyId, pname: t.providerName, vfrom: t.fillFrom })))}::jsonb)
            as x(id bigint, role text, pid text, pname text, vfrom text)) v
      where m.id = v.id`);
  }
  const result = { links: links.length, started: plan.insert.filter((n) => n.event !== "mandate_switched").length, switched: plan.insert.filter((n) => n.event === "mandate_switched").length, ended: plan.end.filter((e) => e.reason === "gone").length, refreshed: plan.touch.length, initial };
  log.info("manager mandates", result);
  return result;
}
