/**
 * FILE: services/engine/src/pipeline/domiciliation.ts
 * PART: scraping engine (services/engine) — domiciliation by shared address (core.mandates, role domiciliation_agent)
 * WHAT IT DOES: Job `domiciliation_match`. Many fund administrators domicile the funds and vehicles they serve
 *   at their own office: an entity registered at a fund administrator's (or domiciliation agent's) address is
 *   very probably its domiciliation client. The job:
 *   1. builds an address key per company: Luxembourg postcode + house number ("L-2520|5"): in Luxembourg a
 *      postcode covers one street (or part of it), so the key ignores spelling ("allée" / "ALLÉE", "J.F." /
 *      "John F.");
 *   2. providers = active service providers offering Fund Administration (category or any of its services) or
 *      Domiciliation & Registered Office (core.company_services, or their primary category);
 *   3. clients = the other active companies at a provider's key, except other service providers and companies of
 *      the provider's own groups (its subsidiaries / sister companies are not clients); an address shared by two
 *      unrelated providers is ambiguous: no mandate (counted);
 *   4. keeps the episodes: a new client → mandate (from the date its address was first seen, "on or before");
 *      an address now at another provider → the old episode ends, a new one starts ("mandate_switched");
 *      no longer at a provider's address (moved, struck off) → the episode ends. This register is what tracks
 *      clients moving between fund administrators.
 *   Episodes from staff or from documents win: a client with such a current domiciliation mandate is left alone.
 * WHERE IT RUNS: engine workers (group "maintenance"), daily after fund_lifecycle.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { withActor } from "@fundhub/engine-db/core/entity";
import { changes, mandateEvidence, mandates } from "@fundhub/engine-db/schema";
import { log } from "../log";
import { brandOf } from "./groups";

/** Kind: constant. Who decides address-matched mandates (core.mandates.decided_by). */
export const ADDRESS_MATCH = "address_match";

/** Kind: function. "L-2520|5" from a stored address, or null when postcode or house number is missing. */
export function addressKey(a: { street?: string | null; postcode?: string | null; raw?: string | null; country?: string | null } | null | undefined): string | null {
  if (!a) return null;
  if (a.country && a.country !== "LU") return null;
  const raw = a.raw ?? "";
  const pc = (a.postcode ?? raw.match(/\bL\s?-?\s?(\d{4})\b/i)?.[1] ?? "").replace(/\D/g, "");
  if (!/^\d{4}$/.test(pc)) return null;
  // House number: first number in the street ("2-4, rue …" → 2, "1c, rue …" → 1c); else in the raw text,
  // ignoring the postcode itself.
  const num = (s: string) => s.match(/(?:^|[\s,])(\d{1,4}[a-z]?)(?=[\s,\-–/]|$)/i)?.[1]?.toLowerCase() ?? null;
  const n = (a.street ? num(a.street) : null) ?? num(raw.replace(new RegExp(`\\bL\\s?-?\\s?${pc}\\b`, "gi"), " ").replace(new RegExp(`\\b${pc}\\b`, "g"), " "));
  return n ? `L-${pc}|${n}` : null;
}

/**
 * Kind: type alias. A provider able to domicile. `groups` = its ownership groups (corporate / provider layers);
 * `brand` = its brand word (Alter Domus Luxembourg / Alter Domus Fund Services → "alter"); `domiciles` = licensed or
 * listed for Domiciliation & Registered Office; `fundAdmin` = in the Fund Administration category.
 */
export type Provider = { id: string; name: string; key: string; groups: number[]; brand?: string; domiciles?: boolean; fundAdmin?: boolean };
/** Kind: type alias. A possible client. */
export type Client = { id: string; key: string; groups: number[]; addressSince: string | null };
/** Kind: type alias. A current address-matched mandate. */
export type CurrentDomiciliation = { id: number; clientId: string; providerId: string | null; providerName: string };

export type DomiciliationPlan = {
  insert: { clientId: string; providerId: string; providerName: string; validFrom: string | null; key: string; event: "mandate_started" | "mandate_switched" | null; previous: string | null }[];
  end: { id: number; clientId: string; validTo: string; providerName: string; reason: "switched" | "gone" }[];
  touch: number[];
  ambiguous: number;
};

/**
 * Kind: function. Decides the episodes (pure).
 * @param skip     clients with a current domiciliation mandate from staff / documents (left alone).
 * @param initial  first load: no change events (start dates are "on or before", not news).
 */
/** Kind: function. Best entity of one firm: licensed / listed for domiciliation, then fund administration, then name. */
const best = (ps: Provider[]) => [...ps].sort((a, b) => Number(!!b.domiciles) - Number(!!a.domiciles) || Number(!!b.fundAdmin) - Number(!!a.fundAdmin) || a.name.localeCompare(b.name))[0];
/** Kind: function. Two providers are one firm: a shared ownership group, or the same brand word. */
const sameFirm = (a: Provider, b: Provider) => a.groups.some((g) => b.groups.includes(g)) || (!!a.brand && a.brand === b.brand);

/**
 * Kind: function. Which provider domiciles an entity at an address several providers share (or null = ambiguous):
 * one firm (shared group or brand) → its best entity; several firms → the only firm offering domiciliation, if one.
 */
export function pickProvider(candidates: Provider[]): Provider | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  if (candidates.every((p) => sameFirm(p, candidates[0]))) return best(candidates);
  const dom = candidates.filter((p) => p.domiciles);
  if (dom.length && dom.every((p) => sameFirm(p, dom[0]))) return best(dom);
  return null;
}

export function planDomiciliation(providers: Provider[], clients: Client[], current: CurrentDomiciliation[], skip: Set<string>, today: string, initial = false): DomiciliationPlan {
  const plan: DomiciliationPlan = { insert: [], end: [], touch: [], ambiguous: 0 };
  const byKey = new Map<string, Provider[]>();
  for (const p of providers) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const providerIds = new Set(providers.map((p) => p.id));
  const cur = new Map(current.map((c) => [c.clientId, c]));
  const matched = new Set<string>();

  for (const c of clients) {
    if (providerIds.has(c.id) || skip.has(c.id)) continue;
    const at = byKey.get(c.key);
    if (!at) continue;
    // The provider's own group companies are not its clients.
    const candidates = at.filter((p) => !p.groups.some((g) => c.groups.includes(g)));
    if (!candidates.length) continue;
    const p = pickProvider(candidates);
    if (!p) {
      plan.ambiguous++;
      continue;
    }
    matched.add(c.id);
    const before = cur.get(c.id);
    if (before && (before.providerId === p.id || candidates.some((x) => x.id === before.providerId))) {
      plan.touch.push(before.id);
      continue;
    }
    if (before) plan.end.push({ id: before.id, clientId: c.id, validTo: today, providerName: before.providerName, reason: "switched" });
    plan.insert.push({
      clientId: c.id, providerId: p.id, providerName: p.name, key: c.key,
      validFrom: before ? today : c.addressSince,
      event: initial ? null : before ? "mandate_switched" : "mandate_started",
      previous: before?.providerName ?? null,
    });
  }
  for (const c of current) if (!matched.has(c.clientId) && !skip.has(c.clientId)) plan.end.push({ id: c.id, clientId: c.clientId, validTo: today, providerName: c.providerName, reason: "gone" });
  return plan;
}

const FUND_ADMIN = "fund-administration";
const DOMICILIATION = "governance-domiciliation--domiciliation-registered-office";

/** Kind: async function. Job "domiciliation_match". */
export async function domiciliationMatch() {
  const t0 = Date.now();
  // Providers: active service providers offering fund administration (category or its services) or domiciliation.
  const prov = (
    await db.execute<{ id: string; name: string; address: Record<string, string> | null; groups: number[] | null; domiciles: boolean; fund_admin: boolean }>(sql`
      select c.id, c.canonical_name as name, c.registered_address as address,
             (select array_agg(m.group_id) from core.company_group_members m join core.company_groups g on g.id = m.group_id
                where m.company_id = c.id and m.valid_to is null and g.layer in ('corporate', 'service_provider')) as groups,
             exists (select 1 from core.activity_categories a where a.slug = ${DOMICILIATION} and (a.id = c.activity_subcategory_id
                       or exists (select 1 from core.company_services s where s.company_id = c.id and s.valid_to is null and s.category_id = a.id))) as domiciles,
             exists (select 1 from core.activity_categories a where a.id = c.activity_category_id and a.slug = ${FUND_ADMIN}) as fund_admin
      from core.companies c
      where c.is_service_provider and c.status <> 'struck_off' and (
        exists (select 1 from core.activity_categories a where a.id in (c.activity_category_id, c.activity_subcategory_id)
                  and (a.slug = ${FUND_ADMIN} or a.slug like ${FUND_ADMIN + "--%"} or a.slug = ${DOMICILIATION}))
        or exists (select 1 from core.company_services s join core.activity_categories a on a.id = s.category_id
                   where s.company_id = c.id and s.valid_to is null
                     and (a.slug = ${FUND_ADMIN} or a.slug like ${FUND_ADMIN + "--%"} or a.slug = ${DOMICILIATION})))`)
  ).rows;
  const providers: Provider[] = prov
    .map((p) => ({ id: p.id, name: p.name, key: addressKey(p.address)!, groups: p.groups ?? [], brand: brandOf(p.name) || undefined, domiciles: p.domiciles, fundAdmin: p.fund_admin }))
    .filter((p) => p.key);

  // Possible clients: active, not service providers, with an address; when their address (winning claim) was first seen.
  const keys = [...new Set(providers.map((p) => p.key))];
  const cli = (
    await db.execute<{ id: string; address: Record<string, string> | null; groups: number[] | null; since: string | null }>(sql`
      select c.id, c.registered_address as address,
             (select array_agg(m.group_id) from core.company_group_members m join core.company_groups g on g.id = m.group_id
                where m.company_id = c.id and m.valid_to is null and g.layer in ('corporate', 'service_provider')) as groups,
             (select min(cl.valid_from)::date::text from core.field_lineage l join clean.claims cl on cl.id = l.claim_id
                where l.company_id = c.id and l.attribute = 'address') as since
      from core.companies c
      where not c.is_service_provider and c.status <> 'struck_off' and c.registered_address is not null`)
  ).rows;
  const clients: Client[] = cli
    .map((c) => ({ id: c.id, key: addressKey(c.address)!, groups: c.groups ?? [], addressSince: c.since }))
    .filter((c) => c.key && keys.includes(c.key));

  const currentRows = await db
    .select({ id: mandates.id, clientId: mandates.clientCompanyId, providerId: mandates.providerCompanyId, providerName: mandates.providerName, decidedBy: mandates.decidedBy })
    .from(mandates)
    .where(and(eq(mandates.role, "domiciliation_agent"), eq(mandates.status, "current")));
  const current = currentRows.filter((m) => m.decidedBy === ADDRESS_MATCH);
  const skip = new Set(currentRows.filter((m) => m.decidedBy !== ADDRESS_MATCH).map((m) => m.clientId));
  const today = new Date().toISOString().slice(0, 10);
  const initial = current.length === 0;
  const plan = planDomiciliation(providers, clients, current, skip, today, initial);

  const now = new Date();
  for (let i = 0; i < plan.end.length; i += 500) {
    await db.transaction(async (tx) => {
      await withActor(tx, "engine:domiciliation");
      for (const e of plan.end.slice(i, i + 500)) {
        await tx.update(mandates).set({ status: "ended", validTo: e.validTo, validToPrecision: "month", lastSeenAt: now }).where(eq(mandates.id, e.id));
        if (e.reason === "gone") await tx.insert(changes).values({ companyId: e.clientId, source: "engine", kind: "mandate_ended", attribute: "domiciliation_agent", oldValue: e.providerName, actor: "engine:domiciliation" });
      }
    });
  }
  for (let i = 0; i < plan.insert.length; i += 500) {
    const batch = plan.insert.slice(i, i + 500);
    await db.transaction(async (tx) => {
      await withActor(tx, "engine:domiciliation");
      const ids = await tx
        .insert(mandates)
        .values(batch.map((n) => ({
          clientCompanyId: n.clientId, providerCompanyId: n.providerId, providerName: n.providerName, role: "domiciliation_agent", exclusive: true,
          validFrom: n.validFrom, validFromPrecision: "unknown" as const, status: "current" as const, confidence: 0.8, decidedBy: ADDRESS_MATCH,
        })))
        .returning({ id: mandates.id });
      await tx
        .insert(mandateEvidence)
        .values(batch.map((n, k) => ({ mandateId: ids[k].id, source: "engine" as const, documentDate: n.validFrom, quote: `same registered address as ${n.providerName} (${n.key})` })))
        .onConflictDoNothing();
      const ev = batch.filter((n) => n.event);
      if (ev.length) await tx.insert(changes).values(ev.map((n) => ({ companyId: n.clientId, source: "engine" as const, kind: n.event!, attribute: "domiciliation_agent", oldValue: n.previous, newValue: n.providerName, actor: "engine:domiciliation" })));
    });
  }
  for (let i = 0; i < plan.touch.length; i += 1000) await db.update(mandates).set({ lastSeenAt: now }).where(inArray(mandates.id, plan.touch.slice(i, i + 1000)));

  const result = {
    providers: providers.length, candidates: clients.length, started: plan.insert.filter((n) => n.event !== "mandate_switched").length,
    switched: plan.insert.filter((n) => n.event === "mandate_switched").length, ended: plan.end.filter((e) => e.reason === "gone").length,
    kept: plan.touch.length, ambiguous: plan.ambiguous, initial, seconds: Math.round((Date.now() - t0) / 1000),
  };
  log.info("domiciliation_match", result);
  return result;
}
