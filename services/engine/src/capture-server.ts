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
 * WHERE IT RUNS: on the computer where you browse LBR.
 * TYPESCRIPT YOU WILL SEE HERE: node:http server, JSON bodies, CORS / Private Network Access headers.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { documents, rcsFilings } from "@fundhub/engine-db/schema";
import { config } from "./config";
import { ingest } from "./core/ingest";
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
    "Access-Control-Allow-Headers": "Content-Type",
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
  for (const it of list.items) {
    const rec: ParsedRecord = {
      source: "lbr_bulk",
      externalId: it.rcs,
      state: "found",
      scope: it.rcs[0],
      facts: { name: it.name, rcsNumber: it.rcs, status: it.struckOff ? "struck_off" : "unknown" },
      identifiers: [{ scheme: "rcs", value: it.rcs }],
      names: [{ name: it.name, kind: "legal", validFrom: null }],
    };
    const raw: RawCapture = { source: "lbr_bulk", externalId: it.rcs, url, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(rec)), ext: "json" };
    const res = await ingest(listAdapter, raw, { blobs });
    stats[res.status] = (stats[res.status] ?? 0) + 1;
  }
  return stats;
}

/** Kind: async function. The next RCS numbers to open (not captured yet, most important first). */
export async function nextNumbers(skip: Set<string>, n = 5): Promise<string[]> {
  const rows = (
    await db.execute<{ rcs: string }>(sql`
      select i.value as rcs
      from entity_identifiers i
      join entities e on e.id = i.entity_id
      where i.scheme = 'rcs'
        and not exists (select 1 from source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found'))
      order by e.tier desc, e.is_service_provider desc, (e.entity_kind = 'asset_manager') desc, i.value
      limit ${n + skip.size}`)
  ).rows;
  return rows.map((r) => r.rcs).filter((r) => !skip.has(r)).slice(0, n);
}

/**
 * Kind: async function. Stores one capture (file + ingest).
 * @returns what the snippet shows: status, name, filings count, or why it was not recognised.
 */
export async function storeCapture(body: CaptureBody, dir: string, blobs = makeBlobStore(config().storage)) {
  const list = /consult-search-list/i.test(body.url) ? parseRcsSearchList(body.text) : null;
  const rcs = list ? null : rcsOf(body);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${list ? "search" : (rcs ?? "unknown")}-${stamp}.json`);
  await writeFile(file, JSON.stringify({ ...body, rcs, capturedAt: new Date().toISOString() }));
  if (list) {
    const stats = await storeSearchList(list, body.url, blobs);
    return { ok: true, kind: "list", companies: list.items.length, total: list.total, stats, file };
  }
  if (!rcs) return { ok: false, error: "No RCS number found on this page — open the company page (or pass it in the snippet).", file };
  const raw: RawCapture = { source: "rcs", externalId: rcs, url: body.url, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify({ url: body.url, text: body.text, html: body.html ?? "" })), ext: "json" };
  try {
    const res = await ingest(personRcs, raw, { blobs });
    const parsed = parseRcs(raw);
    return { ok: true, rcs, status: res.status, name: parsed.facts.name ?? null, filings: parsed.rcsFilings?.length ?? 0, changes: res.changes, file };
  } catch (err) {
    if (err instanceof RcsPageError) return { ok: false, rcs, error: "Page saved, but the parser does not recognise this layout yet (it will be re-imported once the parser is updated).", file };
    throw err;
  }
}

/** Kind: type alias. A filing document sent by the extension: base64 bytes + where it came from. */
type DocumentBody = { url: string; contentType?: string; data: string; filingNumber?: string | null; rcs?: string | null };

/**
 * Kind: async function. Stores a filing PDF you opened on LBR: object storage (docs/<sha256>.pdf, stored once),
 * a `documents` row, and the link from its filing (rcs_filings.document_sha256) when the filing number is known
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
  await db.insert(documents).values({ sha256: hash, blobKey: key, mime, bytes: bytes.length }).onConflictDoNothing();
  const filingNumber = body.filingNumber ?? body.url.match(/Ld{9}/)?.[0] ?? null;
  let linked = false;
  if (filingNumber) {
    const r = await db.update(rcsFilings).set({ documentSha256: hash }).where(eq(rcsFilings.filingNumber, filingNumber)).returning({ n: rcsFilings.filingNumber });
    linked = r.length > 0;
  }
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
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${CAPTURE_PORT}`);
      if (req.method === "GET" && url.pathname === "/next") return reply(200, { ok: true, next: await nextNumbers(skip) });
      if (req.method === "POST" && url.pathname === "/capture") {
        const body = await readJson<CaptureBody>(req);
        if (!body?.text || !body.url?.startsWith(ALLOWED_ORIGIN)) return reply(400, { ok: false, error: "Not an LBR page" });
        const out = await storeCapture(body, dir, blobs);
        console.log("kind" in out && out.kind === "list" ? `✓ search list — ${out.companies} companies ${JSON.stringify(out.stats)}` : out.ok ? `✓ ${out.rcs} ${out.status} — ${out.name} (${out.filings} filings)` : `✘ ${out.rcs ?? "?"} ${out.error}`);
        return reply(200, { ...out, next: await nextNumbers(skip) });
      }
      if (req.method === "POST" && url.pathname === "/document") {
        const body = await readJson<DocumentBody>(req);
        if (!body?.data || !body.url?.startsWith(ALLOWED_ORIGIN)) return reply(400, { ok: false, error: "Not an LBR document" });
        const out = await storeDocument(body, blobs);
        console.log(out.ok ? `📄 ${out.filingNumber ?? "?"} saved (${out.bytes} bytes${out.linked ? ", linked to filing" : ""})` : `✘ document: ${out.error}`);
        return reply(200, out);
      }
      if (req.method === "POST" && url.pathname === "/skip") {
        const { rcs } = await readJson<{ rcs: string }>(req);
        const n = normalizeRcs(rcs);
        if (n) skip.add(n);
        return reply(200, { ok: true, next: await nextNumbers(skip) });
      }
      return reply(404, { ok: false, error: "not found" });
    } catch (err) {
      console.error("capture error:", err);
      return send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) }, req.headers.origin);
    }
  });
  server.listen(CAPTURE_PORT, "127.0.0.1", () => {
    console.log(`📥 FundHub capture server on http://127.0.0.1:${CAPTURE_PORT} — accepting LBR pages and documents (snippet / FundHub extension) only.`);
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
    const list = /consult-search-list/i.test(body.url) ? parseRcsSearchList(body.text) : null;
    if (list) {
      const st = await storeSearchList(list, body.url, blobs);
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
