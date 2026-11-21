/**
 * FILE: services/engine/src/pipeline/mentions.ts
 * PART: scraping engine (services/engine) — match stage for news (which companies an article mentions)
 * WHAT IT DOES: Finds the companies an article talks about by looking up their normalized names in the
 *   article's normalized text, token by token (a dictionary keyed by first word, so 100k+ names cost little).
 *   Only companies worth following are in the dictionary (tier ≥ 1, service providers, FundHub listings,
 *   banks / asset managers / financial institutions); one-word names must be distinctive (≥ 6 letters, not a
 *   common word). Each hit gets a confidence:
 *     0.55 base · +0.2 the full legal name (with legal form) appears verbatim · +0.1 multi-word name ·
 *     +0.05 "Luxembourg" in the text · +0.25 the article was found by searching for this company.
 *   ≥ 0.7 → "auto" (counted); below → "pending" (Review → Mentions in the console).
 * WHERE IT RUNS: engine workers, inside the release transaction.
 */

import { sql } from "drizzle-orm";
import type { EngineTx } from "@fundhub/engine-db/client";
import { changes, newsMentions } from "@fundhub/engine-db/schema";
import { normalizeName } from "../core/normalize";

type Entry = { companyId: string; tokens: string[]; canonical: string };

const COMMON = new Set(["group", "capital", "invest", "finance", "services", "partners", "global", "europe", "holding", "management", "luxembourg", "international", "solutions", "consulting", "trust", "fund", "funds", "asset", "assets", "bank", "national", "general"]);
export const AUTO_THRESHOLD = 0.7;

let dict: { at: number; byFirst: Map<string, Entry[]> } | null = null;

/** Kind: function. Normalized tokens of a text (same normalization as company names). */
export const tokens = (text: string) => normalizeName(text).split(" ").filter(Boolean);

/**
 * Kind: function. The name as the press writes it: legal form ("S.A.", "S.à r.l.", "SICAV"…) and a trailing
 * "Luxembourg" / "(Luxembourg)" removed, case kept. "BNP PARIBAS LEASE GROUP LUXEMBOURG S.A." → "BNP PARIBAS LEASE GROUP".
 */
export function pressName(canonical: string): string {
  let n = canonical.replace(/\s*\((luxembourg|lux)\)\s*/gi, " ");
  const forms = /[\s,]+(s\.?\s?a\.?|s\.?\s?à\.?\s?r\.?\s?l\.?|s\.?a\.?r\.?l\.?|sarl|scsp|scs|sca|sicav|sicaf|sicar|raif|sif|asbl|gmbh|ltd|limited|plc|llp|inc|ag|nv|bv|se|s\.?e\.?c\.?s\.?)\.?$/i;
  for (let i = 0; i < 3; i++) n = n.trim().replace(forms, "");
  // "Banque de Luxembourg": Luxembourg is part of the name when a preposition precedes it.
  const without = n.trim().replace(/[\s,]+luxembourg$/i, "");
  if (!/\b(de|du|des|la|le|of|von|in|and|&)$/i.test(without)) n = without;
  return n.trim() || canonical;
}

/** Kind: function. Builds the first-token index from dictionary rows (plus each company's press name as an alias). Exported for tests. */
export function buildIndex(rows: { id: string; normalized_name: string; canonical_name: string }[]): Map<string, Entry[]> {
  const byFirst = new Map<string, Entry[]>();
  const add = (id: string, normalized: string, canonical: string) => {
    const t = normalized.split(" ").filter(Boolean);
    if (!t.length) return;
    if (t.length === 1 && (t[0].length < 6 || COMMON.has(t[0]))) return;
    const list = byFirst.get(t[0]) ?? [];
    if (!list.some((e) => e.companyId === id && e.tokens.join(" ") === t.join(" "))) list.push({ companyId: id, tokens: t, canonical });
    byFirst.set(t[0], list);
  };
  for (const r of rows) {
    add(r.id, r.normalized_name, r.canonical_name);
    const alias = normalizeName(pressName(r.canonical_name));
    if (alias && alias !== r.normalized_name) add(r.id, alias, r.canonical_name);
  }
  return byFirst;
}

/** Kind: function. Pure matcher: which entries occur in the text, with their confidence. Exported for tests. */
export function findMentions(text: string, byFirst: Map<string, Entry[]>, targetCompanyId: string | null): { companyId: string; matchedText: string; confidence: number }[] {
  const words = tokens(text);
  const lower = text.toLowerCase();
  const found = new Map<string, { companyId: string; matchedText: string; confidence: number }>();
  for (let i = 0; i < words.length; i++) {
    for (const e of byFirst.get(words[i]) ?? []) {
      if (found.has(e.companyId)) continue;
      if (!e.tokens.every((t, k) => words[i + k] === t)) continue;
      let c = 0.55;
      if (lower.includes(e.canonical.toLowerCase())) c += 0.2;
      if (e.tokens.length > 1) c += 0.1;
      if (lower.includes("luxembourg")) c += 0.05;
      if (targetCompanyId === e.companyId) c += 0.25;
      found.set(e.companyId, { companyId: e.companyId, matchedText: e.tokens.join(" "), confidence: Math.min(0.99, Math.round(c * 100) / 100) });
    }
  }
  return [...found.values()];
}

/** Kind: async function. The dictionary of followed companies, rebuilt every 10 minutes. */
async function dictionary(tx: EngineTx) {
  if (dict && Date.now() - dict.at < 600_000) return dict.byFirst;
  const rows = (
    await tx.execute<{ id: string; normalized_name: string; canonical_name: string }>(sql`
      select id, normalized_name, canonical_name from core.companies
      where status <> 'struck_off' and length(normalized_name) >= 3
        and (tier >= 1 or is_service_provider or website_provider_id is not null or company_kind in ('bank', 'asset_manager', 'financial_institution'))`)
  ).rows;
  dict = { at: Date.now(), byFirst: buildIndex(rows) };
  return dict.byFirst;
}

/**
 * Kind: async function. Writes core.news_mentions for one article.
 * @param targetCompanyId  the company the article was searched for (per-company news search), if any.
 * @returns how many mentions were recorded.
 */
export async function detectMentions(tx: EngineTx, articleId: number, text: string, targetCompanyId: string | null): Promise<number> {
  const byFirst = await dictionary(tx);
  // The searched-for company is always looked for, even when it is not in the dictionary yet.
  if (targetCompanyId && ![...byFirst.values()].some((l) => l.some((e) => e.companyId === targetCompanyId))) {
    const r = (await tx.execute<{ id: string; normalized_name: string; canonical_name: string }>(sql`select id, normalized_name, canonical_name from core.companies where id = ${targetCompanyId}`)).rows[0];
    if (r) {
      const t = r.normalized_name.split(" ").filter(Boolean);
      if (t.length) byFirst.set(t[0], [...(byFirst.get(t[0]) ?? []), { companyId: r.id, tokens: t, canonical: r.canonical_name }]);
    }
  }
  const hits = findMentions(text, byFirst, targetCompanyId);
  for (const h of hits) {
    const decision = h.confidence >= AUTO_THRESHOLD ? ("auto" as const) : ("pending" as const);
    const [row] = await tx.insert(newsMentions).values({ articleId, companyId: h.companyId, matchedText: h.matchedText, confidence: h.confidence, decision }).onConflictDoNothing().returning({ id: newsMentions.id });
    if (row && decision === "auto") await tx.insert(changes).values({ companyId: h.companyId, source: "news", kind: "news_mention", newValue: { articleId, confidence: h.confidence } });
  }
  return hits.length;
}
