/**
 * FILE: packages/engine-db/src/core/services.ts
 * PART: shared package (packages/engine-db) — engine core
 * WHAT IT DOES: Keeps core.company_services (the categories / services a company offers, several per company) in
 *   step with each source:
 *   - "rule": every category / service the classification rules give (CSSF licences → several services);
 *   - each source that states services in words (FundHub account, company website): mapped to the taxonomy by
 *     label, and kept as free text when the taxonomy has no such service;
 *   - "manual": staff choices (setManualServices), never touched by the other sources.
 *   A source's service that disappears gets valid_to (history); one that comes back is reopened.
 * WHERE IT RUNS: recomputeCompany() (engine workers, admin console).
 */

import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { EngineTx } from "../client";
import { activityCategories, companyServices } from "../schema";

/** Kind: type alias. One wanted service row. */
export type ServiceRow = { key: string; categoryId: number | null; label: string | null; confidence?: number; evidence?: string | null };

const plainLabel = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

let catCache: { id: number; slug: string; label: string; level: number; serviceProvider: boolean }[] | null = null;
/** Kind: async function. All activity categories (cached for the process). */
export async function loadCategories(tx: EngineTx) {
  catCache ??= await tx.select({ id: activityCategories.id, slug: activityCategories.slug, label: activityCategories.label, level: activityCategories.level, serviceProvider: activityCategories.serviceProvider }).from(activityCategories);
  return catCache;
}

/** Kind: function. Rows for taxonomy category / service ids. */
export const serviceRowsFromIds = (ids: number[]): ServiceRow[] => [...new Set(ids)].map((id) => ({ key: `cat:${id}`, categoryId: id, label: null }));

/**
 * Kind: function. Words → rows: a label equal to a taxonomy service / category (accents, case, "&" ignored) maps
 * to it; otherwise it is kept as free text.
 */
export function serviceRowsFromLabels(labels: unknown, categories: { id: number; label: string }[]): ServiceRow[] {
  if (!Array.isArray(labels)) return [];
  const byLabel = new Map(categories.map((c) => [plainLabel(c.label), c.id]));
  const out = new Map<string, ServiceRow>();
  for (const raw of labels) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const p = plainLabel(raw);
    const id = byLabel.get(p);
    const row: ServiceRow = id ? { key: `cat:${id}`, categoryId: id, label: raw.trim() } : { key: `txt:${p.slice(0, 120)}`, categoryId: null, label: raw.trim().slice(0, 200) };
    out.set(row.key, row);
  }
  return [...out.values()];
}

/** Kind: async function. Makes one source's current services equal to `rows` (upsert, end the others). */
export async function syncServices(tx: EngineTx, companyId: string, source: string, rows: ServiceRow[]) {
  const now = new Date();
  if (rows.length) {
    await tx
      .insert(companyServices)
      .values(rows.map((r) => ({ companyId, source, key: r.key, categoryId: r.categoryId, label: r.label, confidence: r.confidence ?? 1, evidence: r.evidence ?? null })))
      .onConflictDoUpdate({
        target: [companyServices.companyId, companyServices.key, companyServices.source],
        set: { validTo: null, lastSeenAt: now, label: sql`excluded.label`, confidence: sql`excluded.confidence`, evidence: sql`excluded.evidence` },
      });
  }
  const keep = rows.map((r) => r.key);
  await tx
    .update(companyServices)
    .set({ validTo: now })
    .where(and(eq(companyServices.companyId, companyId), eq(companyServices.source, source), isNull(companyServices.validTo), keep.length ? notInArray(companyServices.key, keep) : sql`true`));
}

/** Kind: async function. Staff choice of services (source "manual"): category / service ids plus free-text services. */
export async function setManualServices(tx: EngineTx, companyId: string, categoryIds: number[], freeText: string[] = []) {
  const cats = await loadCategories(tx);
  const valid = categoryIds.filter((id) => cats.some((c) => c.id === id));
  await syncServices(tx, companyId, "manual", [...serviceRowsFromIds(valid), ...serviceRowsFromLabels(freeText, [])]);
}

/** Kind: async function. Current services of companies (for screens): one row per key, staff first. */
export async function currentServices(tx: EngineTx, companyIds: string[]) {
  if (!companyIds.length) return [];
  return tx.select().from(companyServices).where(and(inArray(companyServices.companyId, companyIds), isNull(companyServices.validTo)));
}
