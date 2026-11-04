/**
 * FILE: services/engine/src/rcs-session.ts
 * PART: scraping engine (services/engine) — RCS collection with a person at the screen
 * WHAT IT DOES: `engine rcs:session` — one visible browser, one LuxTrust login, then RCS company pages one after
 *   another, each saved to the database (ingest) as soon as it is captured.
 *   - LBR's anti-robot check: when it appears, the session WAITS for the person to complete it in the window
 *     (default up to 10 min per check). The engine never solves or skips it; if nobody clears it in time, the
 *     session stops cleanly and can be resumed later.
 *   - Logged out: it waits for the person to log in again in the same window, then retries that company.
 *   - Interrupt any time with Ctrl+C (or create .engine-data/stop-rcs, or close the browser window): it finishes
 *     the current company and stops.
 *   - Resume: the next run skips every RCS number already captured (source_records), so it continues where
 *     the previous run stopped. Work order: numbers known from GLEIF / CSSF / imports, highest tier first,
 *     service providers and asset managers first.
 *   - Pages the parser cannot read are logged with a screenshot (.engine-data/rcs-debug/session-…/errors) and
 *     skipped, so one odd page never stops the run.
 * WHERE IT RUNS: on the machine where the person is (laptop / VM with a screen).
 * TYPESCRIPT YOU WILL SEE HERE: a SIGINT handler with a flag, `instanceof` error routing.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { rcsNumberSpace } from "@fundhub/engine-db/schema";
import { config } from "./config";
import { ingest } from "./core/ingest";
import { normalizeRcs, splitRcs } from "./core/normalize";
import { bumpCounter, finishRun, getCursor, setSessionHealth, startRun, today } from "./core/ops";
import { makeBlobStore } from "./storage";
import { RcsAdapter } from "./sources/rcs/adapter";
import { RcsBrowser, RcsSessionError } from "./sources/rcs/browser";
import { RcsPageError } from "./sources/rcs/parse";

/** Kind: constant. Text that means "logged in" on LBR (the header shows "My account"). */
const LOGGED_IN = /my account|mon compte|mäi kont|log ?out|d[ée]connexion/i;

/** Kind: type alias. Options of a session. */
export type SessionOptions = {
  /** Explicit RCS numbers; otherwise the work list from the database. */
  numbers?: string[];
  /** Stop after this many companies. */
  limit?: number;
  /** Daily cap (default RCS_DAILY_CAP). */
  cap?: number;
  /** Minutes to wait for the person to clear an anti-robot check (default 10). */
  checkWaitMin?: number;
  /** A file whose existence means "I am logged in" (when login detection misses). */
  waitFile?: string;
  /** Screenshot every step (large); errors are always captured. */
  debug?: boolean;
};

/**
 * Kind: async function. Waits until the browser shows a logged-in LBR page (or the wait file exists).
 * @throws after 30 minutes.
 */
async function waitForLogin(browser: RcsBrowser, waitFile?: string) {
  const page = await browser.open(false);
  if (!/lbr\.lu/.test(page.url())) await page.goto("https://www.lbr.lu/mjrcs-web-front/", { waitUntil: "domcontentloaded" });
  console.log("🔑 Log in with LuxTrust in the browser window (waiting up to 30 min)…");
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    if (waitFile && existsSync(waitFile)) break;
    const cur = browser.currentPage() ?? page;
    const text = await cur.innerText("body").catch(() => "");
    if (!/luxtrust|\/login\//i.test(cur.url()) && LOGGED_IN.test(text)) break;
    if (Date.now() > deadline) throw new Error("No login within 30 minutes");
    await new Promise((r) => setTimeout(r, 2_000));
  }
  await setSessionHealth("rcs", "ok", "logged in (rcs:session)");
  console.log("✔ Logged in.");
}

/**
 * Kind: async function. The work list: RCS numbers known from any source but never captured from the RCS,
 * most important first.
 */
async function workList(limit: number): Promise<string[]> {
  const rows = (
    await db.execute<{ rcs: string }>(sql`
      select i.value as rcs
      from entity_identifiers i
      join entities e on e.id = i.entity_id
      where i.scheme = 'rcs'
        and not exists (select 1 from source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found'))
      order by e.tier desc, e.is_service_provider desc, (e.entity_kind = 'asset_manager') desc, i.value
      limit ${limit}`)
  ).rows;
  return rows.map((r) => r.rcs);
}

/**
 * Kind: async function. Runs a session.
 * @returns `Promise<number>` — exit code (0 = finished or stopped cleanly).
 */
export async function runRcsSession(opts: SessionOptions): Promise<number> {
  const cfg = config();
  const blobs = makeBlobStore(cfg.storage);
  const browser = new RcsBrowser({ ...cfg.rcs, headless: false });
  browser.checkWaitMs = (opts.checkWaitMin ?? 10) * 60_000;
  const sessionDir = resolve(cfg.rcs.profileDir, "..", "rcs-debug", `session-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const errorsDir = resolve(sessionDir, "errors");
  if (opts.debug) browser.debugDir = sessionDir;
  const adapter = new RcsAdapter(browser);
  const cap = opts.cap ?? cfg.rcs.dailyCap;

  let stopping = false;
  const onSigint = () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\n⏹  Stopping after the current company… (Ctrl+C again to quit now)");
  };
  process.on("SIGINT", onSigint);

  const numbers = opts.numbers?.length ? opts.numbers.map((n) => normalizeRcs(n)).filter((n): n is string => !!n) : await workList(opts.limit ?? 100_000);
  const todo = opts.limit ? numbers.slice(0, opts.limit) : numbers;
  console.log(`📋 ${todo.length} RCS numbers to capture (already captured ones are skipped; resume any time).`);
  const runId = await startRun("rcs", "rcs_session", "person", { count: todo.length });
  const stats = { done: 0, new: 0, changed: 0, unchanged: 0, not_found: 0, unreadable: 0 };
  const unreadable: string[] = [];
  let exit = 0;

  try {
    await waitForLogin(browser, opts.waitFile);
    const stopFile = resolve(cfg.rcs.profileDir, "..", "stop-rcs");
    if (existsSync(stopFile)) await import("node:fs/promises").then((f) => f.rm(stopFile));
    for (let i = 0; i < todo.length && !stopping; i++) {
      const rcs = todo[i];
      // Stop request from outside (when Ctrl+C is not available): create .engine-data/stop-rcs.
      if (existsSync(stopFile)) {
        console.log("⏹  Stop file found — stopping.");
        stopping = true;
        break;
      }
      const used = (await getCursor<number>("rcs", `daily:${today()}`)) ?? 0;
      if (used >= cap) {
        console.log(`⏸  Daily cap reached (${cap}). Run again tomorrow, or pass --cap.`);
        break;
      }
      let attempt = 0;
      for (;;) {
        try {
          const raw = await adapter.fetch(rcs);
          await bumpCounter("rcs", `daily:${today()}`);
          const res = await ingest(adapter, raw, { blobs });
          stats[res.status as keyof typeof stats] = (stats[res.status as keyof typeof stats] ?? 0) + 1;
          if (res.status !== "not_found") {
            const [prefix, n] = splitRcs(rcs);
            await db.update(rcsNumberSpace).set({ maxKnown: sql`greatest(${rcsNumberSpace.maxKnown}, ${n})`, updatedAt: new Date() }).where(eq(rcsNumberSpace.prefix, prefix));
          }
          console.log(`[${i + 1}/${todo.length}] ${rcs} ✓ ${res.status}${res.changes ? ` (${res.changes} changes)` : ""}`);
          break;
        } catch (err) {
          if (err instanceof RcsSessionError && err.state === "logged_out" && attempt === 0) {
            attempt++;
            console.log(`🔒 Logged out while on ${rcs}.`);
            await waitForLogin(browser, undefined);
            continue;
          }
          if (err instanceof RcsSessionError) throw err;
          // The window was closed by the person: stop cleanly instead of failing every remaining number.
          if (err instanceof Error && /has been closed|Target closed|browser has disconnected/i.test(err.message)) {
            console.log("⏹  Browser window closed — stopping. Run again to continue.");
            stopping = true;
            break;
          }
          // Unreadable page (layout not recognised yet) or a one-off error: keep evidence, move on.
          stats.unreadable++;
          unreadable.push(rcs);
          const page = browser.currentPage();
          if (page) {
            await mkdir(errorsDir, { recursive: true });
            const dir = browser.debugDir;
            browser.debugDir = errorsDir;
            await browser.snap(page, rcs);
            browser.debugDir = dir;
            await writeFile(resolve(errorsDir, `${rcs}.txt`), await page.innerText("body").catch(() => ""));
          }
          console.log(`[${i + 1}/${todo.length}] ${rcs} ✘ ${err instanceof RcsPageError ? "page not recognised" : err instanceof Error ? err.message : err} (saved in ${errorsDir})`);
          break;
        }
      }
      stats.done++;
    }
    await finishRun(runId, stopping ? "paused" : "succeeded", stats);
  } catch (err) {
    exit = 1;
    if (err instanceof RcsSessionError) {
      await setSessionHealth("rcs", err.state, err.message);
      console.log(`⏸  Session paused: ${err.message}. Run the same command again to continue where it stopped.`);
    } else console.error(`✘ ${err instanceof Error ? err.message : err}`);
    await finishRun(runId, "paused", stats, String(err));
  } finally {
    process.off("SIGINT", onSigint);
    await browser.close();
  }
  console.log(`\nSession: ${JSON.stringify(stats)}`);
  if (unreadable.length) console.log(`Not recognised (see ${errorsDir}): ${unreadable.join(", ")}`);
  return exit;
}
