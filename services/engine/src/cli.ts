/**
 * FundHub Scraping Engine — command line.
 *
 *   engine run <job> [--flag value …]      run a job now, in this process (follow-ups run inline too)
 *   engine enqueue <job> [--flag value …]  put a job on the queue for the workers
 *   engine worker --groups cssf,gleif,maintenance   serve queued jobs (one RCS worker: --groups rcs)
 *   engine scheduler                       register cron schedules and keep the clock running
 *   engine rcs:login [--wait]              open the RCS browser; log in with LuxTrust; press Enter (or --wait: auto-detect)
 *   engine capture-server                  receive LBR pages you open in Chrome (snippets/lbr-save-to-fundhub.js)
 *   engine rcs:import-captures [--dir d]   re-import saved captures (after a parser update)
 *   engine rcs:session [B… …] [--limit n] [--cap n] [--check-wait min]   collect RCS pages with you at the screen
 *   engine rcs:capture [B123456] [--out d] open the browser, save a company page as a parser fixture
 *   engine parse <cssf|gleif|rcs> <file>   parse a saved file and print the result (debugging)
 *   engine status                          census, queues, session health, recent runs
 *   engine entity <rcs|lei|name>           show a golden entity with its sources
 *
 * Examples:
 *   engine run cssf_census --types SPP,SUP --limit 20
 *   engine run gleif_sync --limit 500
 *   engine run rcs_fetch --rcs B145917
 *   engine run rcs_frontier --prefix B --from 290000
 *
 * FILE: services/engine/src/cli.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Entry point of every engine process: parses the command, then runs a job, a worker, the
 *   scheduler, or a helper command. The same file serves the Docker image (`engine worker …`) and a laptop.
 * WHERE IT RUNS: Node.js (`npm run engine -- …` from the repo root, or the container entrypoint).
 * TYPESCRIPT YOU WILL SEE HERE: `switch`, `readline/promises`, dynamic flag parsing, `Promise<number>`.
 */

import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db, pool } from "@fundhub/engine-db/client";
import { censusSnapshots, crawlRuns, entities, entityIdentifiers, entityRelations, sessionHealth, sourceRecords } from "@fundhub/engine-db/schema";
import { makeContext, type JobContext } from "./jobs/context";
import { GROUPS, inlineEnqueue, isJob, JOBS, type Group, type JobDef } from "./jobs/index";
import { setSessionHealth } from "./core/ops";
import { normalizeLei, normalizeRcs } from "./core/normalize";
import { bossEnqueue, startBoss, startScheduler, startWorker } from "./queue";
import { parseCssf } from "./sources/cssf/parse";
import { parseGleif } from "./sources/gleif/parse";
import { parseRcsText } from "./sources/rcs/parse";
import { RcsBrowser } from "./sources/rcs/browser";
import { config } from "./config";
import { runRcsSession } from "./rcs-session";
import { importCaptures, startCaptureServer } from "./capture-server";

/** Kind: constant. Flags whose value is a comma-separated list. */
const LIST_FLAGS = new Set(["types", "groups"]);

/**
 * Kind: function. Turns `--types SPP,SUP --limit 20 --all` into { types: ["SPP","SUP"], limit: 20, all: true }.
 * @param args  type `string[]`.
 */
export function parseFlags(args: string[]): { positional: string[]; flags: Record<string, unknown> } {
  const positional: string[] = [];
  const flags: Record<string, unknown> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    i++;
    flags[key] = LIST_FLAGS.has(key) ? next.split(",").filter(Boolean) : /^\d+$/.test(next) ? Number(next) : next;
  }
  return { positional, flags };
}

/** Kind: async function. Waits for Enter in the terminal. */
async function waitForEnter(prompt: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(prompt);
  rl.close();
}

/** Kind: async function. `engine status`. */
async function status() {
  const latest = await db.select().from(censusSnapshots).where(sql`${censusSnapshots.takenOn} = (select max(taken_on) from census_snapshots)`).orderBy(censusSnapshots.source, censusSnapshots.scope);
  console.log("\nCensus (latest day):");
  console.table(latest.map((c) => ({ day: c.takenOn, source: c.source, scope: c.scope, expected: c.expectedTotal, seen: c.seen, new: c.added, gone: c.gone })));
  const sessions = await db.select().from(sessionHealth);
  console.log("Sessions:", sessions.length ? sessions.map((s) => `${s.source}=${s.state}${s.message ? ` (${s.message})` : ""}`).join(", ") : "none");
  const runs = await db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(10);
  console.log("\nRecent runs:");
  console.table(runs.map((r) => ({ id: r.id, job: r.job, status: r.status, started: r.startedAt.toISOString().slice(0, 16), stats: JSON.stringify(r.stats) })));
  try {
    const q = await pool.query<{ name: string; state: string; n: number }>("select name, state, count(*)::int as n from pgboss.job group by 1, 2 order by 1, 2");
    console.log("Queue:");
    console.table(q.rows);
  } catch {
    console.log("Queue: not initialised yet (start a worker or run `engine enqueue`).");
  }
}

/** Kind: async function. `engine entity <query>`. */
async function showEntity(q: string) {
  const rcs = normalizeRcs(q);
  const lei = normalizeLei(q);
  const byId = rcs || lei ? await db.select({ id: entityIdentifiers.entityId }).from(entityIdentifiers).where(eq(entityIdentifiers.value, (rcs ?? lei)!)) : [];
  const rows = byId.length
    ? await db.select().from(entities).where(eq(entities.id, byId[0].id))
    : await db.select().from(entities).where(or(ilike(entities.canonicalName, `%${q}%`))).limit(5);
  for (const e of rows) {
    console.log(JSON.stringify(e, null, 2));
    const ids = await db.select({ scheme: entityIdentifiers.scheme, value: entityIdentifiers.value, source: entityIdentifiers.source }).from(entityIdentifiers).where(eq(entityIdentifiers.entityId, e.id));
    const recs = await db.select({ source: sourceRecords.source, id: sourceRecords.externalId, state: sourceRecords.state, scope: sourceRecords.scope, lastChanged: sourceRecords.lastChangedAt }).from(sourceRecords).where(eq(sourceRecords.entityId, e.id));
    const rels = await db
      .select({ kind: entityRelations.kind, client: entityRelations.objectName, linked: entityRelations.objectEntityId, source: entityRelations.source })
      .from(entityRelations)
      .where(and(eq(entityRelations.subjectEntityId, e.id), isNull(entityRelations.validTo)));
    console.table(ids);
    console.table(recs);
    if (rels.length) {
      console.log("Clients / relations:");
      console.table(rels);
    }
  }
  if (!rows.length) console.log("No entity found.");
}

/** Kind: async function. The program. @returns exit code. */
async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case "run": {
      const job = positional[0];
      if (!job || !isJob(job)) throw new Error(`Usage: engine run <job>. Jobs: ${Object.keys(JOBS).join(", ")}`);
      let ctx: JobContext;
      ctx = makeContext(inlineEnqueue(() => ctx), "manual");
      try {
        const result = await (JOBS[job] as JobDef).handler(flags, ctx);
        console.log(JSON.stringify(result, null, 2));
      } finally {
        await ctx.close();
      }
      return 0;
    }
    case "enqueue": {
      const job = positional[0];
      if (!job || !isJob(job)) throw new Error(`Usage: engine enqueue <job>. Jobs: ${Object.keys(JOBS).join(", ")}`);
      const boss = await startBoss();
      await bossEnqueue(boss)(job, flags);
      await boss.stop({ graceful: false });
      console.log(`Queued ${job} ${JSON.stringify(flags)}`);
      return 0;
    }
    case "worker": {
      const groups = ((flags.groups as string[] | undefined) ?? (process.env.ENGINE_GROUPS?.split(",") || ["cssf", "gleif", "maintenance"])) as Group[];
      await startWorker(groups.filter((g) => GROUPS.includes(g)));
      return -1; // keep running
    }
    case "scheduler":
      await startScheduler();
      return -1;
    case "rcs:login": {
      const cfg = config();
      const browser = new RcsBrowser(cfg.rcs);
      const page = await browser.open(false);
      await page.goto("https://www.lbr.lu/mjrcs-web-front/");
      if (flags.wait) {
        // --wait: no terminal needed. Watch the page until it shows a logged-in state (a log-out link), for up
        // to 15 minutes, then save. Useful when the command is started for you (VM, background task).
        console.log("\nLog in with LuxTrust in the browser window that just opened. It closes by itself once you are logged in.");
        const LOGGED_IN = /log ?out|sign ?out|se d[ée]connecter|d[ée]connexion|ofmellen|abmelden/i;
        const deadline = Date.now() + 15 * 60_000;
        let ok = false;
        let lastSnap = 0;
        browser.debugDir = resolve(cfg.rcs.profileDir, "..", "rcs-debug", "login");
        while (Date.now() < deadline && !ok) {
          await new Promise((r) => setTimeout(r, 3_000));
          const p = browser.currentPage() ?? page;
          const text = await p.innerText("body").catch(() => "");
          ok = !/luxtrust/i.test(p.url()) && LOGGED_IN.test(text);
          // A screenshot every 30 s, so a missed detection can be diagnosed from the files.
          if (Date.now() - lastSnap > 30_000) {
            await browser.snap(p, ok ? "logged-in" : "waiting");
            lastSnap = Date.now();
          }
        }
        if (!ok) {
          await browser.close();
          console.log("✘ No login detected within 15 minutes. Run it again, or use `rcs:login` without --wait and press Enter.");
          return 1;
        }
        await setSessionHealth("rcs", "ok", "login detected (rcs:login --wait)");
      } else {
        await waitForEnter("\nLog in with LuxTrust in the browser window, open any company page to check, then press Enter here… ");
        await browser.assertUsable(page);
        await setSessionHealth("rcs", "ok", "login confirmed by operator");
      }
      await browser.close();
      console.log("✔ RCS session saved in", resolve(cfg.rcs.profileDir));
      return 0;
    }
    case "capture-server":
      // Receives LBR pages you open in your own Chrome (snippets/lbr-save-to-fundhub.js). See src/capture-server.ts.
      await startCaptureServer();
      return -1;
    case "rcs:import-captures":
      console.log(JSON.stringify(await importCaptures(flags.dir as string | undefined), null, 2));
      return 0;
    case "rcs:session":
      // RCS collection with a person at the screen: resumable, interruptible (see src/rcs-session.ts).
      return runRcsSession({
        numbers: positional,
        limit: flags.limit as number | undefined,
        cap: flags.cap as number | undefined,
        checkWaitMin: flags.checkWait as number | undefined,
        waitFile: flags.waitFile as string | undefined,
        debug: !!flags.debug,
      });
    case "rcs:test": {
      // One real lookup through the logged-in browser, with a screenshot + page summary at every step, and the
      // parser run on the result. Writes nothing to the database. Usage: engine rcs:test B145917 [--headless]
      const cfg = config();
      const rcs = normalizeRcs(positional[0] ?? "B145917");
      if (!rcs) throw new Error("Usage: engine rcs:test <RCS number>");
      const browser = new RcsBrowser({ ...cfg.rcs, headless: !!flags.headless, delayMs: 1_500, jitterMs: 1_000 });
      browser.debugDir = resolve(cfg.rcs.profileDir, "..", "rcs-debug", `${rcs}-${Date.now()}`);
      if (flags.checkWait) browser.checkWaitMs = Number(flags.checkWait) * 1000;
      console.log(`Debug trail: ${browser.debugDir}`);
      try {
        if (flags.waitFile) {
          // Login in the SAME browser that runs the test (LuxTrust session cookies do not survive a browser
          // restart). Proceeds when the given file exists — created when the operator says "logged in".
          const page = await browser.open(false);
          await page.goto("https://www.lbr.lu/mjrcs-web-front/");
          console.log(`Log in with LuxTrust in the browser window. Continuing when a logged-in page is seen or ${flags.waitFile} exists (20 min)…`);
          const LOGGED_IN = /log ?out|sign ?out|se d[ée]connecter|d[ée]connexion|ofmellen|abmelden/i;
          const deadline = Date.now() + 20 * 60_000;
          let lastSnap = 0;
          for (;;) {
            if (existsSync(String(flags.waitFile))) break;
            const cur = browser.currentPage() ?? page;
            const text = await cur.innerText("body").catch(() => "");
            if (!/luxtrust|\/login\//i.test(cur.url()) && LOGGED_IN.test(text)) break;
            if (Date.now() > deadline) throw new Error("Timed out waiting for login");
            if (Date.now() - lastSnap > 30_000) {
              await browser.snap(browser.currentPage() ?? page, "waiting-login");
              lastSnap = Date.now();
            }
            await new Promise((r) => setTimeout(r, 2_000));
          }
          await browser.snap(browser.currentPage() ?? page, "logged-in");
          console.log("Login confirmed — running the lookup.");
        }
        // Every number given (one login covers them all), each saved as page-<rcs>.txt / .html.
        const numbers = [rcs, ...positional.slice(1).map((n) => normalizeRcs(n)).filter((n): n is string => !!n)];
        for (const n of numbers) {
          const cap = await browser.capture(n);
          await writeFile(join(browser.debugDir, `page-${n}.txt`), cap.text);
          await writeFile(join(browser.debugDir, `page-${n}.html`), cap.html);
          try {
            const parsed = parseRcsText(cap.text, n);
            console.log(JSON.stringify({ rcs: n, url: cap.url, state: parsed.state, facts: parsed.facts, filings: parsed.rcsFilings?.length ?? 0, firstFilings: parsed.rcsFilings?.slice(0, 2) }, null, 2));
          } catch (err) {
            console.log(`${n}: captured (${cap.url}) but the parser does not recognise it yet: ${err instanceof Error ? err.message : err}`);
          }
        }
        return 0;
      } catch (err) {
        const page = browser.currentPage();
        if (page) await browser.snap(page, "error");
        console.error(`✘ ${err instanceof Error ? err.message : err}`);
        return 1;
      } finally {
        await browser.close();
      }
    }
    case "rcs:capture": {
      const cfg = config();
      const browser = new RcsBrowser(cfg.rcs);
      const rcs = positional[0] ? normalizeRcs(positional[0]) : null;
      let text: string;
      let html: string;
      let url: string;
      if (rcs && (flags.auto || cfg.rcs.entityUrlTemplate)) {
        ({ text, html, url } = await browser.capture(rcs));
      } else {
        const page = await browser.open(false);
        await page.goto(cfg.rcs.searchUrl);
        await waitForEnter("\nOpen the company page and its 'List of filings' in the browser, then press Enter here… ");
        text = await page.innerText("body");
        html = await page.content();
        url = page.url();
      }
      const name = rcs ?? `capture-${Date.now()}`;
      const out = resolve((flags.out as string | undefined) ?? "services/engine/test/fixtures");
      await mkdir(out, { recursive: true });
      await writeFile(join(out, `rcs-${name}.txt`), text);
      await writeFile(join(out, `rcs-${name}.html`), html);
      await browser.close();
      console.log(`✔ Saved ${url}\n  ${join(out, `rcs-${name}.txt`)}\n  ${join(out, `rcs-${name}.html`)}`);
      try {
        const p = parseRcsText(text, rcs ?? "B0");
        console.log(`Parsed: ${p.state} · ${p.facts.name} · ${p.rcsFilings?.length ?? 0} filings`);
      } catch (err) {
        console.log(`Parser could not read it yet: ${err instanceof Error ? err.message : err}`);
      }
      return 0;
    }
    case "parse": {
      const [source, file] = positional;
      const body = await readFile(file);
      const raw = { source: source as "cssf", externalId: String(flags.id ?? "unknown"), url: file, httpStatus: 200, contentType: "application/json", body, ext: "json" };
      const parsed = source === "cssf" ? parseCssf(raw) : source === "gleif" ? parseGleif(raw) : parseRcsText(body.toString("utf8"), String(flags.id ?? "B0"));
      console.log(JSON.stringify(parsed, null, 2));
      return 0;
    }
    case "status":
      await status();
      return 0;
    case "entity":
      await showEntity(positional.join(" "));
      return 0;
    default:
      console.error("Usage: engine <run|enqueue|worker|scheduler|rcs:login|rcs:capture|parse|status|entity> … (see src/cli.ts)");
      return 2;
  }
}

main()
  .then(async (code) => {
    if (code === -1) return; // long-running process; exits on SIGTERM
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
