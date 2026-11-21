/**
 * FILE: services/engine/src/capture-server.ts
 * PART: scraping engine (services/engine) — person-browsed RCS capture
 * WHAT IT DOES: `engine capture-server` — a small HTTP server on YOUR machine (127.0.0.1:4477) that receives the
 *   LBR company page you are looking at, sent by the Chrome snippet (snippets/lbr-save-to-fundhub.js), and stores
 *   it through the normal ingest pipeline (source "rcs": history, change events, matching, golden record).
 *   You browse LBR normally in your own Chrome — search, LBR's check, company page — and run the snippet; the
 *   engine never browses LBR itself. It also tells the snippet which RCS number to open next (work list:
 *   known from GLEIF / CSSF, not captured yet, service providers first), so a session resumes where it stopped.
 *   Every capture is also kept as a file (.engine-data/captures/), so pages the parser does not recognise yet
 *   are not lost: fix the parser, then `engine rcs:import-captures`.
 *   Security: listens on 127.0.0.1 only and accepts requests only from https://www.lbr.lu (CORS + Origin check).
 *   Remote use (engine on a VM, Chrome on your PC): a reverse proxy (Caddy, HTTPS) forwards /engine/* to it, and
 *   every request must carry `Authorization: Bearer <CAPTURE_TOKEN>`. A proxied request (X-Forwarded-For) is
 *   refused when no CAPTURE_TOKEN is set, so the database is never writable from the internet without the token.
 * WHERE IT RUNS: on the computer where you browse LBR, or on the VM behind the proxy.
 * TYPESCRIPT YOU WILL SEE HERE: node:http server, JSON bodies, CORS / Private Network Access headers.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { documents, filings, type RoundScope } from "@fundhub/engine-db/schema";
import { withActor } from "@fundhub/engine-db/core/entity";
import { nextSweepItems, planSweep, recordSearch, resetSkippedSweep, skipSweepTerm, sweepStats } from "@fundhub/engine-db/core/sweep";
import { activeRound, closeRound, listRounds, nextItems, recordDocument, recordVisit, resetSkipped, roundStats, skipItem, startRound } from "@fundhub/engine-db/core/rounds";
import { config } from "./config";
import { ingest } from "./pipeline/ingest";
import { normalizeRcs } from "./core/normalize";
import type { ParsedRecord, RawCapture, SourceAdapter } from "./core/types";
import { blobKey, makeBlobStore, sha256 } from "./storage";
import { parseLbrBulk, LBR_BULK_PARSER_VERSION } from "./sources/lbr-bulk/parse";
import { parseRcs, parseRcsSearchList, parseRcsText, rcsFromUrl, RCS_PARSER_VERSION, RcsPageError, type RcsListItem } from "./sources/rcs/parse";

/** Kind: constant. The only website allowed to send captures. */
const ALLOWED_ORIGIN = "https://www.lbr.lu";
/** Kind: function. Origins allowed to send: LBR pages (snippet) and the FundHub browser extension. */
const allowedOrigin = (o: string | undefined) => !o || o === ALLOWED_ORIGIN || o.startsWith("chrome-extension://");
/** Kind: constant. Default port (the snippet uses the same). */
export const CAPTURE_PORT = Number(process.env.CAPTURE_PORT ?? 4477);
/** Kind: constant. Interface to listen on. Keep 127.0.0.1 behind a reverse proxy. */
const CAPTURE_HOST = process.env.CAPTURE_HOST ?? "127.0.0.1";
/** Kind: constant. Shared secret the extension sends as a Bearer token (required for remote use). */
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN?.trim() || "";

/**
 * Kind: function. Whether the request may proceed. With CAPTURE_TOKEN set, every request needs the token.
 * Without it, only direct local requests pass (a request that came through a proxy is refused).
 */
function authorized(req: IncomingMessage): boolean {
  if (!CAPTURE_TOKEN) return !req.headers["x-forwarded-for"] && CAPTURE_HOST === "127.0.0.1";
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(CAPTURE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Kind: constant. The RCS adapter for pages sent by a person (nothing to fetch: the page comes in). */
const personRcs: SourceAdapter = { source: "rcs", parserVersion: RCS_PARSER_VERSION, fetch: async () => null, parse: parseRcs };

/** Kind: constant. Adapter for search-list rows (stored as "lbr_bulk": partial register data). */
const listAdapter: SourceAdapter = { source: "lbr_bulk", parserVersion: LBR_BULK_PARSER_VERSION, fetch: async () => null, parse: parseLbrBulk };

/** Kind: type alias. What the snippet sends. */
type CaptureBody = { url: string; text: string; html?: string; rcs?: string };

/** Kind: function. Reads a JSON request body (max 20 MB). */
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 20_000_000) throw new Error("Body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

/** Kind: function. Sends JSON with the CORS headers for LBR. */
function send(res: ServerResponse, status: number, body: unknown, origin?: string) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin && allowedOrigin(origin) ? origin : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Chrome's Private Network Access: a public site (lbr.lu) may call localhost only if localhost agrees.
    "Access-Control-Allow-Private-Network": "true",
  });
  res.end(JSON.stringify(body));
}

/** Kind: function. The RCS number of a capture: given, else from the page text, else from the URL. */
function rcsOf(body: CaptureBody): string | null {
  // The company page URL is the reliable source: …/consult-company/B100554?tab=deposit.
  const fromUrl = rcsFromUrl(body.url);
  if (fromUrl) return fromUrl;
  const given = normalizeRcs(body.rcs);
  if (given) return given;
  try {
    const p = parseRcsText(body.text, "?");
    if (p.state === "found" && p.facts.rcsNumber) return p.facts.rcsNumber as string;
  } catch {
    /* not a recognised company page */
  }
  return null;
}

/**
 * Kind: async function. Stores the rows of an LBR search-results page: one "lbr_bulk" record per company
 * (RCS number, name, struck-off flag). Sole traders (A…) are already dropped by the parser (personal data).
 */
async function storeSearchList(list: { total: number | null; items: RcsListItem[] }, url: string, blobs: ReturnType<typeof makeBlobStore>) {
  const stats: Record<string, number> = {};
  // A few at a time: each ingest is its own transaction with advisory locks on the record and its identifiers,
  // so parallel ingests are safe (the worker does the same). One by one, a page of 199 new companies took ~60 s.
  const queue = [...list.items];
  const one = async (it: RcsListItem) => {
    const rec: ParsedRecord = {
      source: "lbr_bulk",
      externalId: it.rcs,
      state: "found",
      scope: it.rcs[0],
      facts: { name: it.name, rcsNumber: it.rcs, status: it.status ?? "unknown" },
      identifiers: [{ scheme: "rcs", value: it.rcs }],
      names: [{ name: it.name, kind: "legal", validFrom: null }],
    };
    const raw: RawCapture = { source: "lbr_bulk", externalId: it.rcs, url, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(rec)), ext: "json" };
    const res = await ingest(listAdapter, raw, { blobs });
    stats[res.status] = (stats[res.status] ?? 0) + 1;
  };
  await Promise.all(
    Array.from({ length: Math.min(LIST_INGEST_CONCURRENCY, queue.length) }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) await one(it);
    }),
  );
  return stats;
}

/** Kind: constant. How many companies of a results page are stored at the same time. */
const LIST_INGEST_CONCURRENCY = 6;
/** Kind: constant. RCS numbers handed to the background store but not stored yet (they count as known). */
const pendingNumbers = new Set<string>();
/** Kind: variable. The background store: results pages are stored one after another, in arrival order. */
let backgroundStore: Promise<unknown> = Promise.resolve();

/**
 * Kind: async function. Books a search-results page against the LBR search sweep — which numbers are new to the
 * engine, the searched word done, the words of the new names added — and stores its companies.
 * @param background  true (receiver): answer at once and store the companies in the background, so the panel's
 *                    "Next search" is up to date immediately; the page file is already on disk, so nothing is
 *                    lost if the receiver stops (`engine rcs:import-captures`). false (re-import): wait.
 */
async function storeListAndSweep(list: { total: number | null; items: RcsListItem[] }, url: string, blobs: ReturnType<typeof makeBlobStore>, background = false) {
  const numbers = [...new Set(list.items.map((i) => i.rcs))];
  const known = numbers.length
    ? new Set((await db.execute<{ value: string }>(sql`select value from core.company_identifiers where scheme = 'rcs' and value in ${numbers}`)).rows.map((r) => r.value))
    : new Set<string>();
  const newRcs = new Set(numbers.filter((n) => !known.has(n) && !pendingNumbers.has(n)));
  const newNumbers = newRcs.size;
  let term: string | null = null;
  try {
    term = new URL(url).searchParams.get("search");
  } catch {
    /* not a URL */
  }
  const sweep = term ? await recordSearch(term, list.total, list.items, newRcs) : null;
  if (!background) return { stats: await storeSearchList(list, url, blobs), newNumbers, sweep };
  for (const n of numbers) pendingNumbers.add(n);
  backgroundStore = backgroundStore
    .then(async () => {
      const t = Date.now();
      const stats = await storeSearchList(list, url, blobs);
      console.log(`   ↳ stored ${list.items.length} companies of "${term}" in ${((Date.now() - t) / 1000).toFixed(1)} s ${JSON.stringify(stats)}`);
    })
    .catch((err) => console.error(`   ✘ storing the companies of "${term}" failed (re-run engine rcs:import-captures):`, err))
    .finally(() => {
      for (const n of numbers) pendingNumbers.delete(n);
    });
  return { stats: { queued: list.items.length }, newNumbers, sweep };
}

/** Kind: async function. The next RCS numbers to open (not captured yet, most important first). */
export async function nextNumbers(skip: Set<string>, n = 5): Promise<string[]> {
  const rows = (
    await db.execute<{ rcs: string }>(sql`
      select i.value as rcs
      from core.company_identifiers i
      join core.companies e on e.id = i.company_id
      where i.scheme = 'rcs'
        and not exists (select 1 from staging.source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found'))
      order by e.tier desc, e.is_service_provider desc, (e.company_kind = 'asset_manager') desc, i.value
      limit ${n + skip.size}`)
  ).rows;
  return rows.map((r) => r.rcs).filter((r) => !skip.has(r)).slice(0, n);
}

/** Kind: type alias. One company of the work list, as the extension shows it. */
export type QueueItem = { rcs: string; name: string; kind: string; serviceProvider: boolean; category: string | null; status: string };

/**
 * Kind: async function. The next companies to open, with what we already know about them (from GLEIF / CSSF).
 * @param skip    RCS numbers skipped in this receiver session.
 * @param n       how many.
 * @param filter  optional: "sp" (service providers), "am" (asset managers), or text to match in the name / number.
 */
export async function nextCompanies(skip: Set<string>, n = 10, filter = ""): Promise<QueueItem[]> {
  const f = filter.trim();
  const where =
    f === "sp" ? sql`and e.is_service_provider` : f === "am" ? sql`and e.company_kind = 'asset_manager'` : f ? sql`and (e.canonical_name ilike ${"%" + f + "%"} or i.value ilike ${f + "%"})` : sql``;
  const rows = (
    await db.execute<{ rcs: string; name: string; kind: string; sp: boolean; category: string | null; status: string }>(sql`
      select i.value as rcs, e.canonical_name as name, e.company_kind as kind, e.is_service_provider as sp, e.status,
             (select label from core.activity_categories c where c.id = e.activity_category_id) as category
      from core.company_identifiers i
      join core.companies e on e.id = i.company_id
      where i.scheme = 'rcs'
        and not exists (select 1 from staging.source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found'))
        ${where}
      order by e.tier desc, e.is_service_provider desc, (e.company_kind = 'asset_manager') desc, i.value
      limit ${n + skip.size}`)
  ).rows;
  return rows
    .filter((r) => !skip.has(r.rcs))
    .slice(0, n)
    .map((r) => ({ rcs: r.rcs, name: r.name, kind: r.kind, serviceProvider: r.sp, category: r.category, status: r.status }));
}

/** Kind: async function. Progress numbers for the extension: captured, today, documents, remaining. */
export async function captureStats() {
  const [s] = (
    await db.execute<{ captured: number; today: number; filings: number; docs_saved: number; docs_today: number; remaining: number; remaining_sp: number; known: number }>(sql`
      select
        (select count(*) from staging.source_records where source = 'rcs' and state = 'found')::int as captured,
        (select count(*) from staging.source_records where source = 'rcs' and state = 'found' and last_changed_at >= current_date)::int as today,
        (select count(*) from clean.filings)::int as filings,
        (select count(*) from clean.filings where document_sha256 is not null)::int as docs_saved,
        (select count(*) from raw.documents where downloaded_at >= current_date)::int as docs_today,
        (select count(distinct i.value) from core.company_identifiers i where i.scheme = 'rcs'
           and not exists (select 1 from staging.source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found')))::int as remaining,
        (select count(distinct i.value) from core.company_identifiers i join core.companies e on e.id = i.company_id where i.scheme = 'rcs' and e.is_service_provider
           and not exists (select 1 from staging.source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found')))::int as remaining_sp,
        (select count(distinct value) from core.company_identifiers where scheme = 'rcs')::int as known`)
  ).rows;
  return s;
}

/** Kind: async function. What the engine holds for one company (for the panel on its page). */
export async function companyStatus(rcs: string) {
  const [row] = (
    await db.execute<{ name: string | null; captured_at: string | null; filings: number; with_docs: number; docs_saved: number; sp: boolean | null; kind: string | null; category: string | null; sources: string[] | null }>(sql`
      select e.canonical_name as name,
             s.last_changed_at as captured_at,
             (select count(*) from clean.filings f where f.source_record_id = s.id)::int as filings,
             (select count(*) from clean.filings f where f.source_record_id = s.id and f.has_documents)::int as with_docs,
             (select count(*) from clean.filings f where f.source_record_id = s.id and f.document_sha256 is not null)::int as docs_saved,
             e.is_service_provider as sp, e.company_kind as kind,
             (select label from core.activity_categories c where c.id = e.activity_category_id) as category,
             (select array_agg(distinct x.source) from staging.source_records x where x.company_id = e.id and x.state = 'found') as sources
      from core.company_identifiers i
      join core.companies e on e.id = i.company_id
      left join staging.source_records s on s.source = 'rcs' and s.external_id = ${rcs}
      where i.scheme = 'rcs' and i.value = ${rcs}
      limit 1`)
  ).rows;
  return row ?? null;
}

/**
 * Kind: async function. Stores one capture (file + ingest).
 * @returns what the snippet shows: status, name, filings count, or why it was not recognised.
 */
export async function storeCapture(body: CaptureBody, dir: string, blobs = makeBlobStore(config().storage), opts: { background?: boolean } = {}) {
  // A page translated by the browser (Google Translate marks <html class="translated-ltr">) is not LBR's text:
  // saving it would record fake changes ("Limited liability company" instead of "Société à responsabilité limitée").
  if (/<html[^>]*class="[^"]*translated-(ltr|rtl)/i.test(body.html ?? "")) {
    return { ok: false, rcs: rcsOf(body), error: 'Page translated by the browser — not saved. Choose "Show original" on LBR.' };
  }
  const list = /consult-search-list/i.test(body.url) ? parseRcsSearchList(body.text) : null;
  const rcs = list ? null : rcsOf(body);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${list ? "search" : (rcs ?? "unknown")}-${stamp}.json`);
  await writeFile(file, JSON.stringify({ ...body, rcs, capturedAt: new Date().toISOString() }));
  if (list) {
    const { stats, newNumbers, sweep } = await storeListAndSweep(list, body.url, blobs, opts.background ?? false);
    return { ok: true, kind: "list", companies: list.items.length, total: list.total, stats, newNumbers, sweep, file };
  }
  if (!rcs) return { ok: false, error: "No RCS number found on this page — open the company page (or pass it in the snippet).", file };
  const raw: RawCapture = { source: "rcs", externalId: rcs, url: body.url, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify({ url: body.url, text: body.text, html: body.html ?? "" })), ext: "json" };
  try {
    const before = new Date();
    const res = await ingest(personRcs, raw, { blobs });
    const parsed = parseRcs(raw);
    const filings = parsed.filings?.length ?? 0;
    // Filings first seen in this capture (for an update round: the new filings since the last pass).
    const [{ n: newFilings }] = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int as n from clean.filings f join staging.source_records s on s.id = f.source_record_id
        where s.source = 'rcs' and s.external_id = ${rcs} and f.first_seen_at >= ${before}`)
    ).rows;
    // PDFs opened before the page was saved can be linked now that their filings exist.
    const linkedNow = await linkPendingDocuments(rcs);
    const round = await recordVisit(rcs, { status: res.status, filingsAfter: filings, newFilings });
    return { ok: true, rcs, status: res.status, name: parsed.facts.name ?? null, filings, newFilings, linkedDocuments: linkedNow, changes: res.changes, inRound: !!round, file };
  } catch (err) {
    if (err instanceof RcsPageError) {
      await recordVisit(rcs, { status: "failed", error: "page not recognised" });
      return { ok: false, rcs, error: "Page saved, but the parser does not recognise this layout yet (it will be re-imported once the parser is updated).", file };
    }
    throw err;
  }
}

/**
 * Kind: async function. Links saved documents to their filings when the documents arrived first (the PDF was
 * opened before the company page was saved). Only fills filings that have no document yet.
 * @returns `Promise<number>` — how many filings got their document.
 */
export async function linkPendingDocuments(rcs?: string) {
  const res = await db.execute(sql`
    update clean.filings f set document_sha256 = d.sha256
    from raw.documents d
    where d.filing_number = f.filing_number and f.document_sha256 is null
      ${rcs ? sql`and f.source_record_id in (select id from staging.source_records where source = 'rcs' and external_id = ${rcs})` : sql``}`);
  return res.rowCount ?? 0;
}

/** Kind: type alias. A filing document sent by the extension: base64 bytes + where it came from. */
type DocumentBody = { url: string; contentType?: string; data: string; filingNumber?: string | null; rcs?: string | null };

/**
 * Kind: async function. Stores a filing PDF you opened on LBR: object storage (docs/<sha256>.pdf, stored once),
 * a `documents` row, and the link from its filing (clean.filings.document_sha256) when the filing number is known
 * (from the document URL, or from the filing row you clicked — sent by the extension).
 */
export async function storeDocument(body: DocumentBody, blobs = makeBlobStore(config().storage)) {
  const bytes = Buffer.from(body.data, "base64");
  const mime = (body.contentType ?? "application/pdf").split(";")[0].trim();
  if (!bytes.length) return { ok: false, error: "empty document" };
  if (mime === "text/html") return { ok: false, error: "got a web page, not a document (logged out?)" };
  const hash = sha256(bytes);
  const key = blobKey("docs", hash, mime === "application/pdf" ? "pdf" : "bin");
  await blobs.put(key, bytes, mime);
  const filingNumber = body.filingNumber ?? body.url.match(/L\d{9}/)?.[0] ?? null;
  // Remember the filing even if it is not captured yet: linkPendingDocuments() connects them later.
  await db
    .insert(documents)
    .values({ sha256: hash, blobKey: key, mime, bytes: bytes.length, filingNumber })
    .onConflictDoUpdate({ target: documents.sha256, set: { filingNumber: sql`coalesce(${documents.filingNumber}, ${filingNumber})` } });
  // Link only a filing that has no document yet. A second copy of a document already saved (page refreshed during
  // "Save all documents", or opened twice) is recognised as such: nothing is stored or counted again.
  let linked = false;
  let alreadySaved = false;
  if (filingNumber) {
    const [f] = await db.select({ doc: filings.documentSha256 }).from(filings).where(eq(filings.filingNumber, filingNumber));
    if (f?.doc) {
      alreadySaved = true;
      linked = true;
    } else if (f) {
      await db.update(filings).set({ documentSha256: hash }).where(eq(filings.filingNumber, filingNumber));
      linked = true;
    }
  }
  if (alreadySaved) return { ok: true, sha256: hash, bytes: bytes.length, filingNumber, linked, alreadySaved };
  // Count it in the active round (company from the extension, or from the filing).
  const rcs =
    normalizeRcs(body.rcs) ??
    (filingNumber
      ? ((await db.execute<{ rcs: string }>(sql`select s.external_id as rcs from clean.filings f join staging.source_records s on s.id = f.source_record_id where f.filing_number = ${filingNumber}`)).rows[0]?.rcs ?? null)
      : null);
  if (rcs && linked) await recordDocument(rcs);
  return { ok: true, sha256: hash, bytes: bytes.length, filingNumber, linked };
}

/** Kind: async function. Runs the server until Ctrl+C. */
export async function startCaptureServer() {
  const cfg = config();
  const dir = resolve(cfg.rcs.profileDir, "..", "captures");
  const blobs = makeBlobStore(cfg.storage);
  const skip = new Set<string>();
  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (!allowedOrigin(origin)) return send(res, 403, { ok: false, error: "origin not allowed" });
      const reply = (status: number, body: unknown) => send(res, status, body, origin);
      if (req.method === "OPTIONS") return reply(204, {});
      if (!authorized(req)) return reply(401, { ok: false, error: "unauthorized: set the engine token in the extension popup (Connection)" });
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${CAPTURE_PORT}`);
      // The work list: the active round's pending companies, or (no round) the not-yet-captured companies.
      const queue = async (n: number, filter = "") => ((await activeRound()) ? await nextItems(n) : await nextCompanies(skip, n, filter));
      const roundInfo = async () => {
        const r = await activeRound();
        return r ? { id: r.id, name: r.name, kind: r.kind, scope: r.scope, startedAt: r.startedAt, stats: await roundStats(r.id) } : null;
      };
      if (req.method === "GET" && url.pathname === "/next") return reply(200, { ok: true, next: (await queue(5)).map((q) => q.rcs) });
      // Richer data for the extension popup / panel.
      if (req.method === "GET" && url.pathname === "/queue") {
        const n = Math.min(50, Number(url.searchParams.get("n")) || 10);
        return reply(200, { ok: true, round: await roundInfo(), items: await queue(n, url.searchParams.get("filter") ?? "") });
      }
      // Capture rounds ("loops"): status, register, control.
      if (req.method === "GET" && url.pathname === "/round") return reply(200, { ok: true, round: await roundInfo() });
      if (req.method === "GET" && url.pathname === "/rounds") return reply(200, { ok: true, rounds: await listRounds() });
      if (req.method === "POST" && url.pathname === "/round/start") {
        const b = await readJson<{ kind: "initial" | "update"; filter?: RoundScope["filter"]; text?: string; skipDays?: number; name?: string }>(req);
        if (b.kind !== "initial" && b.kind !== "update") return reply(400, { ok: false, error: "kind must be initial or update" });
        const scope: RoundScope = { filter: b.filter ?? "all", ...(b.text ? { text: b.text } : {}), ...(b.skipDays ? { skipCapturedWithinDays: Number(b.skipDays) } : {}) };
        const out = await db.transaction(async (tx) => {
          await withActor(tx, "extension");
          return startRound({ kind: b.kind, scope, name: b.name, actor: "extension" }, tx);
        });
        console.log(`🔁 round started: ${out.round.name} — ${out.items} companies`);
        return reply(200, { ok: true, round: await roundInfo() });
      }
      if (req.method === "POST" && url.pathname === "/round/close") {
        const r = await db.transaction(async (tx) => {
          await withActor(tx, "extension");
          return closeRound(tx);
        });
        if (r) console.log(`⏹  round closed: ${r.name}`);
        return reply(200, { ok: true, closed: r?.name ?? null });
      }
      if (req.method === "POST" && url.pathname === "/round/reset-skipped") return reply(200, { ok: true, reset: await resetSkipped(), round: await roundInfo() });
      // LBR search sweep: the plan of searches YOU run, one click each (see packages/engine-db/src/core/sweep.ts).
      if (req.method === "GET" && url.pathname === "/sweep") {
        const n = Math.min(50, Number(url.searchParams.get("n")) || 6);
        return reply(200, { ok: true, sweep: await sweepStats(), next: await nextSweepItems(n) });
      }
      if (req.method === "POST" && url.pathname === "/sweep/plan") {
        const planned = await planSweep();
        console.log(`🔎 search sweep planned: ${JSON.stringify(planned)}`);
        return reply(200, { ok: true, planned, sweep: await sweepStats(), next: await nextSweepItems(6) });
      }
      if (req.method === "POST" && url.pathname === "/sweep/skip") {
        const { term } = await readJson<{ term: string }>(req);
        await skipSweepTerm(term);
        return reply(200, { ok: true, sweep: await sweepStats(), next: await nextSweepItems(6) });
      }
      if (req.method === "POST" && url.pathname === "/sweep/reset-skipped") return reply(200, { ok: true, reset: await resetSkippedSweep(), next: await nextSweepItems(6) });
      if (req.method === "GET" && url.pathname === "/stats") return reply(200, { ok: true, stats: await captureStats() });
      if (req.method === "GET" && url.pathname === "/company") {
        const rcs = normalizeRcs(url.searchParams.get("rcs"));
        return reply(200, { ok: !!rcs, company: rcs ? await companyStatus(rcs) : null });
      }
      if (req.method === "POST" && url.pathname === "/capture") {
        const body = await readJson<CaptureBody>(req);
        if (!body?.text || !body.url?.startsWith(ALLOWED_ORIGIN)) return reply(400, { ok: false, error: "Not an LBR page" });
        // Results pages: booked at once, companies stored in the background (the panel's next search is ready).
        const out = await storeCapture(body, dir, blobs, { background: true });
        console.log("kind" in out && out.kind === "list" ? `✓ search list — ${out.companies} companies, ${out.newNumbers} new${out.sweep ? ` · sweep "${out.sweep.term}"${out.sweep.capped ? " (list full)" : ""}, +${out.sweep.addedWords} words` : ""}` : out.ok ? `✓ ${out.rcs} ${out.status} — ${out.name} (${out.filings} filings)` : `✘ ${out.rcs ?? "?"} ${out.error}`);
        return reply(200, { ...out, round: await roundInfo(), nextItems: await queue(3), next: (await queue(5)).map((q) => q.rcs), sweepNext: await nextSweepItems(6) });
      }
      if (req.method === "GET" && url.pathname === "/filings") {
        // Which filings of a company are known and which already have their document (for "save all documents").
        const rcs = normalizeRcs(url.searchParams.get("rcs"));
        if (!rcs) return reply(400, { ok: false, error: "rcs required" });
        const rows = (
          await db.execute<{ filing_number: string; has_documents: boolean; saved: boolean }>(sql`
            select f.filing_number, f.has_documents, f.document_sha256 is not null as saved
            from clean.filings f join staging.source_records s on s.id = f.source_record_id
            where s.source = 'rcs' and s.external_id = ${rcs}`)
        ).rows;
        return reply(200, { ok: true, rcs, filings: rows });
      }
      if (req.method === "POST" && url.pathname === "/document") {
        const body = await readJson<DocumentBody>(req);
        if (!body?.data || !body.url?.startsWith(ALLOWED_ORIGIN)) return reply(400, { ok: false, error: "Not an LBR document" });
        const out = await storeDocument(body, blobs);
        console.log(out.ok ? (out.alreadySaved ? `📄 ${out.filingNumber} already saved — skipped` : `📄 ${out.filingNumber ?? "?"} saved (${out.bytes} bytes${out.linked ? ", linked to filing" : ""})`) : `✘ document: ${out.error}`);
        return reply(200, out);
      }
      if (req.method === "POST" && url.pathname === "/skip") {
        const { rcs } = await readJson<{ rcs: string }>(req);
        const n = normalizeRcs(rcs);
        // In a round the skip is recorded (and "Reset skipped" brings it back); otherwise only for this session.
        if (n && !(await skipItem(n))) skip.add(n);
        return reply(200, { ok: true, round: await roundInfo(), next: (await queue(5)).map((q) => q.rcs) });
      }
      return reply(404, { ok: false, error: "not found" });
    } catch (err) {
      console.error("capture error:", err);
      return send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) }, req.headers.origin);
    }
  });
  server.listen(CAPTURE_PORT, CAPTURE_HOST, () => {
    console.log(`📥 FundHub capture server on http://${CAPTURE_HOST}:${CAPTURE_PORT} — accepting LBR pages and documents (snippet / FundHub extension) only.`);
    console.log(CAPTURE_TOKEN ? "   Token required (CAPTURE_TOKEN set): remote access through the proxy is enabled." : "   No CAPTURE_TOKEN: local requests only (proxied requests are refused).");
    console.log(`   Captures are also saved in ${dir}`);
    console.log("   Browse LBR in your Chrome, open a company page, run the snippet. Ctrl+C to stop.");
  });
}

/**
 * Kind: async function. Re-ingests saved capture files (after a parser fix). Already-stored identical pages
 * come back "unchanged", so it is safe to run on the whole folder.
 */
export async function importCaptures(dir?: string) {
  const folder = dir ?? resolve(config().rcs.profileDir, "..", "captures");
  const blobs = makeBlobStore(config().storage);
  const stats: Record<string, number> = {};
  for (const f of (await readdir(folder)).filter((x) => x.endsWith(".json")).sort()) {
    const body = JSON.parse(await readFile(join(folder, f), "utf8")) as CaptureBody;
    // Pages translated by the browser are not LBR's text: never import them.
    if (/<html[^>]*class="[^"]*translated-(ltr|rtl)/i.test(body.html ?? "")) {
      stats.translated_skipped = (stats.translated_skipped ?? 0) + 1;
      continue;
    }
    const list = /consult-search-list/i.test(body.url) ? parseRcsSearchList(body.text) : null;
    if (list) {
      const { stats: st } = await storeListAndSweep(list, body.url, blobs);
      stats.list_rows = (stats.list_rows ?? 0) + list.items.length;
      for (const [k, v] of Object.entries(st)) stats[`list_${k}`] = (stats[`list_${k}`] ?? 0) + v;
      continue;
    }
    const rcs = rcsOf(body);
    if (!rcs) {
      stats.no_rcs = (stats.no_rcs ?? 0) + 1;
      continue;
    }
    const raw: RawCapture = { source: "rcs", externalId: rcs, url: body.url, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify({ url: body.url, text: body.text, html: body.html ?? "" })), ext: "json" };
    try {
      const res = await ingest(personRcs, raw, { blobs });
      stats[res.status] = (stats[res.status] ?? 0) + 1;
    } catch (err) {
      const k = err instanceof RcsPageError ? "unrecognised" : "failed";
      stats[k] = (stats[k] ?? 0) + 1;
    }
  }
  return stats;
}
