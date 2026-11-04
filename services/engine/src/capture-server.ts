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
import { sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { config } from "./config";
import { ingest } from "./core/ingest";
import { normalizeRcs } from "./core/normalize";
import type { RawCapture, SourceAdapter } from "./core/types";
import { makeBlobStore } from "./storage";
import { parseRcs, parseRcsText, RCS_PARSER_VERSION, RcsPageError } from "./sources/rcs/parse";

/** Kind: constant. The only website allowed to send captures. */
const ALLOWED_ORIGIN = "https://www.lbr.lu";
/** Kind: constant. Default port (the snippet uses the same). */
export const CAPTURE_PORT = Number(process.env.CAPTURE_PORT ?? 4477);

/** Kind: constant. The RCS adapter for pages sent by a person (nothing to fetch: the page comes in). */
const personRcs: SourceAdapter = { source: "rcs", parserVersion: RCS_PARSER_VERSION, fetch: async () => null, parse: parseRcs };

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
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    // Chrome's Private Network Access: a public site (lbr.lu) may call localhost only if localhost agrees.
    "Access-Control-Allow-Private-Network": "true",
  });
  res.end(JSON.stringify(body));
}

/** Kind: function. The RCS number of a capture: given, else from the page text, else from the URL. */
function rcsOf(body: CaptureBody): string | null {
  const given = normalizeRcs(body.rcs);
  if (given) return given;
  try {
    const p = parseRcsText(body.text, "B0");
    if (p.facts.rcsNumber) return p.facts.rcsNumber as string;
  } catch {
    /* not a recognised page — try the URL */
  }
  const fromUrl = body.url.match(/[?&](?:search|rcs|number)=([A-Za-z]\s?\d{1,7})/i)?.[1];
  return normalizeRcs(fromUrl) ?? normalizeRcs(body.text.match(/\b([A-Z]\d{3,7})\b/)?.[1]);
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
  const rcs = rcsOf(body);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${rcs ?? "unknown"}-${stamp}.json`);
  await writeFile(file, JSON.stringify({ ...body, rcs, capturedAt: new Date().toISOString() }));
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

/** Kind: async function. Runs the server until Ctrl+C. */
export async function startCaptureServer() {
  const cfg = config();
  const dir = resolve(cfg.rcs.profileDir, "..", "captures");
  const blobs = makeBlobStore(cfg.storage);
  const skip = new Set<string>();
  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && origin !== ALLOWED_ORIGIN) return send(res, 403, { ok: false, error: "origin not allowed" });
      if (req.method === "OPTIONS") return send(res, 204, {});
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${CAPTURE_PORT}`);
      if (req.method === "GET" && url.pathname === "/next") return send(res, 200, { ok: true, next: await nextNumbers(skip) });
      if (req.method === "POST" && url.pathname === "/capture") {
        const body = await readJson<CaptureBody>(req);
        if (!body?.text || !body.url?.startsWith(ALLOWED_ORIGIN)) return send(res, 400, { ok: false, error: "Not an LBR page" });
        const out = await storeCapture(body, dir, blobs);
        console.log(out.ok ? `✓ ${out.rcs} ${out.status} — ${out.name} (${out.filings} filings)` : `✘ ${out.rcs ?? "?"} ${out.error}`);
        return send(res, 200, { ...out, next: await nextNumbers(skip) });
      }
      if (req.method === "POST" && url.pathname === "/skip") {
        const { rcs } = await readJson<{ rcs: string }>(req);
        const n = normalizeRcs(rcs);
        if (n) skip.add(n);
        return send(res, 200, { ok: true, next: await nextNumbers(skip) });
      }
      return send(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      console.error("capture error:", err);
      return send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(CAPTURE_PORT, "127.0.0.1", () => {
    console.log(`📥 FundHub capture server on http://127.0.0.1:${CAPTURE_PORT} — accepting pages from ${ALLOWED_ORIGIN} only.`);
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
