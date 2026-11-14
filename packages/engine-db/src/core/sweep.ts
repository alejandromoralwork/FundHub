/**
 * FILE: packages/engine-db/src/core/sweep.ts
 * PART: shared package (packages/engine-db) — LBR search sweep, used by the capture receiver, the CLI and tests
 * WHAT IT DOES: The LBR SEARCH SWEEP: words that a PERSON searches one by one on lbr.lu with the FundHub LBR
 *   Capture extension, so that companies GLEIF / CSSF never told us about show up on results pages and get into
 *   the registry.
 *   What LBR's search does (seen on real pages, Nov 2026): an RCS number finds only that exact company; text is
 *   matched as WHOLE WORDS, accents ignored ("ar" finds "AR CAPITAL" and every "S.àr.l."), and a list shows at most
 *   199 results. Prefixes such as "aa", "ab"… therefore find nothing useful: the sweep searches REAL words.
 *   - Phase 1, common words: words in at least COMMON_MIN known names ("fund", "lux", "holding"…), most common
 *     first — each fills its page with 199 companies.
 *   - Phase 2, letters: every two-letter (aa…zz), then three-letter (aaa…zzz) word — the many short acronym names
 *     ("AA+ IMMO", "ABC S.A.") that no known name would suggest; their lists are usually complete (< 199).
 *   - Phase 3, relatives: the rarer words of known names ("arendt" → Arendt Digital Services next to Arendt
 *     Investor Services), most shared first.
 *   - Grow: each results page adds the words of the names that were new to the engine ("snowball"); a word's
 *     phase follows its count, so a word that becomes common moves up.
 *   A word whose list is full is marked "capped": LBR has more companies with it than it shows; they are reached
 *   through their other words.
 *   Nothing here contacts LBR: the person searches, the extension sends the page, this module books it.
 * WHERE IT RUNS: on Node.js — engine (capture-server, CLI).
 * TYPESCRIPT YOU WILL SEE HERE: Unicode regexes (\p{L}), `sql` templates, `insert … on conflict`.
 */

import { sql } from "drizzle-orm";
import { db, type EngineTx } from "../client";
import { lbrSearchWords } from "../schema";

/** Kind: constant. LBR never lists more than this many results for one search. */
export const SWEEP_CAP = 199;
/** Kind: constant. A word that looks like an RCS number ("b2", "e123") would open that one company: never a term. */
const RCS_LIKE = /^[a-z]\d{1,7}$/;

/** Kind: function. A search text as LBR compares it: lower case, accents removed, single spaces. */
export function foldTerm(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kind: function. The searchable words of a company name: folded, split on anything that is not a letter or a
 * digit ("S.àr.l." → s, ar, l), without RCS-number look-alikes, each once.
 */
export function nameWords(name: string): string[] {
  const words = foldTerm(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && w.length <= 40 && !RCS_LIKE.test(w));
  return [...new Set(words)];
}

/** Kind: constant. A word in at least this many known names is "common" (phase 1). */
export const COMMON_MIN = 20;
/** Kind: function. Search order of a word: 1 = common, 2 = two or three letters (a–z), 3 = other name words. */
export const wordPhase = (w: string, seen: number) => (seen >= COMMON_MIN ? 1 : /^[a-z]{2,3}$/.test(w) ? 2 : 3);
/** Kind: SQL fragment. The same rule in SQL, for a count expression. */
const phaseSql = (seen: ReturnType<typeof sql>) => sql`case when ${seen} >= ${COMMON_MIN} then 1 when ${lbrSearchWords.term} ~ '^[a-z]{2,3}$' then 2 else 3 end`;

/** Kind: function. Every two- and three-letter word, aa…zz then aaa…zzz (18,252 words). */
export function letterWords(): string[] {
  const a = "abcdefghijklmnopqrstuvwxyz";
  const out: string[] = [];
  for (const x of a) for (const y of a) out.push(x + y);
  for (const x of a) for (const y of a) for (const z of a) out.push(x + y + z);
  return out;
}

/** Kind: function. Counts, for each word, how many of the names contain it. */
export function countWords(names: Iterable<string>): Map<string, number> {
  const seen = new Map<string, number>();
  for (const n of names) for (const w of nameWords(n)) seen.set(w, (seen.get(w) ?? 0) + 1);
  return seen;
}

/** Kind: async function. Adds words (or raises their count). @returns how many were not in the sweep before. */
async function addWords(counts: Map<string, number>, origin: "letters" | "seed" | "results", tx: EngineTx, mode: "set" | "add") {
  const rows = [...counts].map(([term, seen]) => ({ term, seen, origin, phase: wordPhase(term, seen) }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const before = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from lbr_search_words where term in ${chunk.map((r) => r.term)}`)).rows[0].n;
    await tx
      .insert(lbrSearchWords)
      .values(chunk)
      .onConflictDoUpdate({
        target: lbrSearchWords.term,
        set: (() => {
          const seen = mode === "add" ? sql`${lbrSearchWords.seen} + excluded.seen` : sql`greatest(${lbrSearchWords.seen}, excluded.seen)`;
          return { seen, phase: phaseSql(seen) };
        })(),
      });
    added += chunk.length - before;
  }
  return added;
}

/**
 * Kind: async function. Plans the sweep: every two- and three-letter word, then every word of the company names
 * the engine knows (legal, former and trade names). Safe to repeat: words already there keep their status; their
 * count is raised if needed.
 * @returns names read, distinct words, words added.
 */
export async function planSweep(tx: EngineTx = db) {
  const names = (
    await tx.execute<{ name: string }>(sql`
      select canonical_name as name from entities where canonical_name is not null
      union
      select name from entity_names`)
  ).rows.map((r) => r.name);
  const counts = countWords(names);
  const letters = new Map(letterWords().map((w) => [w, counts.get(w) ?? 0]));
  const lettersAdded = await addWords(letters, "letters", tx, "set");
  for (const w of letters.keys()) counts.delete(w);
  const added = await addWords(counts, "seed", tx, "set");
  return { names: names.length, letters: letters.size, words: counts.size, added: added + lettersAdded };
}

/** Kind: type alias. One word as the extension shows it. */
export type SweepItem = { term: string; seen: number; origin: string; phase: number };

/** Kind: async function. The next pending words: common words, then aa…zz / aaa…zzz, then the rarer name words. */
export async function nextSweepItems(n = 5, tx: EngineTx = db): Promise<SweepItem[]> {
  return (
    await tx.execute<SweepItem>(sql`
      select term, seen, origin, phase from lbr_search_words where status = 'pending'
      order by phase, case when phase = 2 then length(term) end, case when phase = 2 then term end, seen desc, term
      limit ${n}`)
  ).rows;
}

/** Kind: type alias. What one search did (shown in the panel). */
export type SweepOutcome = { term: string; total: number | null; rows: number; newNumbers: number; capped: boolean; addedWords: number; planned: boolean };

/**
 * Kind: async function. Books one search-results page: the searched word is done (it is added if it was not
 * planned — any search you run counts), and the words of the names that were new to the engine join the queue.
 * @param term     the searched text (URL ?search=).
 * @param total    LBR's "N search result(s)".
 * @param items    the companies on the page.
 * @param newRcs   RCS numbers the engine did not know before this page.
 */
export async function recordSearch(term: string, total: number | null, items: { rcs: string; name: string }[], newRcs: Set<string>, tx: EngineTx = db): Promise<SweepOutcome | null> {
  const t = foldTerm(term);
  if (!t || RCS_LIKE.test(t)) return null;
  const planned = (await tx.execute(sql`select 1 from lbr_search_words where term = ${t}`)).rows.length > 0;
  const capped = (total ?? items.length) >= SWEEP_CAP;
  const newNumbers = items.filter((i) => newRcs.has(i.rcs)).length;
  await tx
    .insert(lbrSearchWords)
    .values({ term: t, status: "done", origin: "results", phase: wordPhase(t, 0), total, rows: items.length, newNumbers, capped, searchedAt: new Date() })
    .onConflictDoUpdate({
      target: lbrSearchWords.term,
      set: { status: "done", total, rows: items.length, newNumbers: sql`coalesce(${lbrSearchWords.newNumbers}, 0) + ${newNumbers}`, capped, searchedAt: new Date() },
    });
  const fresh = countWords(items.filter((i) => newRcs.has(i.rcs)).map((i) => i.name));
  fresh.delete(t);
  const addedWords = fresh.size ? await addWords(fresh, "results", tx, "add") : 0;
  return { term: t, total, rows: items.length, newNumbers, capped, addedWords, planned };
}

/** Kind: async function. Skips a word (Reset skipped brings it back). */
export async function skipSweepTerm(term: string, tx: EngineTx = db) {
  const r = await tx.execute(sql`update lbr_search_words set status = 'skipped' where term = ${foldTerm(term)} and status = 'pending'`);
  return (r.rowCount ?? 0) > 0;
}

/** Kind: async function. Puts skipped words back in the queue. */
export async function resetSkippedSweep(tx: EngineTx = db) {
  const r = await tx.execute(sql`update lbr_search_words set status = 'pending' where status = 'skipped'`);
  return r.rowCount ?? 0;
}

/**
 * Kind: async function. The highest RCS number known per prefix: the higher of the number-space frontier and
 * the highest number LBR itself listed (source lbr_bulk) — the frontier goes stale as the sweep finds newer
 * companies (C was 63, LBR lists C189). Numbers from other sources count from the SECOND highest: a lone one
 * can be a typo (GLEIF has a "B563447" while LBR's highest B is ~B313821), two agreeing ones are real.
 */
export async function knownMaxima(tx: EngineTx = db): Promise<Record<string, number>> {
  const rows = (
    await tx.execute<{ prefix: string; max: number }>(sql`
      with nums as (
        select left(value, 1) as prefix, regexp_replace(value, '[^0-9]', '', 'g')::int as n, bool_or(source = 'lbr_bulk') as lbr
        from entity_identifiers where scheme = 'rcs' and value ~ '^[A-Z][0-9]{1,7}$' group by 1, 2
      ),
      ranked as (select *, row_number() over (partition by prefix order by n desc) as rk from nums),
      ids as (
        select prefix, max(n) filter (where lbr) as lbr, max(n) filter (where rk = 2) as second, max(n) as top
        from ranked group by 1
      )
      select coalesce(s.prefix, ids.prefix) as prefix,
             coalesce(greatest(nullif(s.max_known, 0), ids.lbr, ids.second), ids.top)::int as max
      from ids full join rcs_number_space s on s.prefix = ids.prefix`)
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.prefix, r.max]));
}

/** Kind: async function. Progress of the sweep, and the registry's coverage per RCS prefix. */
export async function sweepStats(tx: EngineTx = db) {
  const [w] = (
    await tx.execute<{ total: number; pending: number; done: number; skipped: number; capped: number; found: number; today: number; found_today: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'done')::int as done,
             count(*) filter (where status = 'skipped')::int as skipped,
             count(*) filter (where capped)::int as capped,
             coalesce(sum(new_numbers), 0)::int as found,
             count(*) filter (where searched_at >= current_date)::int as today,
             coalesce(sum(new_numbers) filter (where searched_at >= current_date), 0)::int as found_today
      from lbr_search_words`)
  ).rows;
  const phases = (
    await tx.execute<{ phase: number; total: number; done: number; found: number }>(sql`
      select phase, count(*)::int as total, count(*) filter (where status = 'done')::int as done, coalesce(sum(new_numbers), 0)::int as found
      from lbr_search_words group by phase order by phase`)
  ).rows;
  const known = (
    await tx.execute<{ prefix: string; known: number }>(sql`
      select left(value, 1) as prefix, count(distinct value)::int as known from entity_identifiers
      where scheme = 'rcs' and value !~ '^A' group by 1 order by 2 desc`)
  ).rows;
  const max = await knownMaxima(tx);
  return {
    planned: w.total > 0,
    words: w,
    phases,
    coverage: known.map((k) => ({ prefix: k.prefix, known: k.known, max: max[k.prefix] ?? null })),
  };
}
