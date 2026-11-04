/**
 * FundHub data module.
 *
 *   npm run scrape -- run --source ai_web [--provider SLUG ...] [--limit N] [--dry-run]
 *   npm run scrape -- run --source rcs
 *   npm run scrape -- jobs        # process jobs queued from the admin platform ("Run scrape")
 *
 * FILE: services/scraper/src/cli.ts
 * PART: scraper (services/scraper)
 * WHAT IT DOES: The command-line entry point of the scraper ("CLI" = command-line interface). It reads the
 *   command typed in the terminal and either (a) "run": runs one data source over some or all published
 *   providers, or (b) "jobs": picks up scrape requests queued from the Console's "Run scrape" button and runs
 *   them. Findings go to staging tables for staff review; nothing changes public profiles directly.
 * WHERE IT RUNS: on Node.js. GitHub Actions (.github/workflows/scrape.yml) runs it on a schedule — AI web
 *   extraction every Monday, the job queue daily — and on demand; it can also be run on a laptop.
 * FRAMEWORK NOTES: `npm run scrape -- …` runs `tsx src/cli.ts …` (tsx runs TypeScript directly without a
 *   separate build step); the words after `--` arrive in `process.argv`. The program's "exit code" tells
 *   GitHub Actions whether it worked: 0 = success, anything else = failure.
 * TYPESCRIPT YOU WILL SEE HERE: namespace imports (`import * as store`), rest destructuring (`[cmd, ...rest]`),
 *   `async`/`await`, `Promise<number>`, ternaries, `?? []`, `.filter/.some/.map`, `Set`, `for…of` loops,
 *   `let`, `try/catch`, non-null `!`, `as never`, template strings, Promise `.then/.catch`.
 */

// `import { a } from "b"` loads named exports. "node:util" is built into Node.js; `parseArgs` turns
// command-line words like `--source rcs --dry-run` into an object.
import { parseArgs } from "node:util";
// `@fundhub/…` = our shared packages. `pool` = the database connections (closed at the end).
import { pool } from "@fundhub/db/client";
// `./x` = a file next to this one. Settings loader.
import { settings } from "./config";
// makeSource = build a source by name; runSource = run it over providers; SOURCES = the allowed names.
import { makeSource, runSource, SOURCES } from "./runner";
// `import * as store` loads every export of store.ts under one name, used as `store.loadProviders(...)`.
import * as store from "./store";

/**
 * Kind: async function — the program's main work.
 * @returns `Promise<number>`: the exit code, arriving later — 0 = success, 1 = failure, 2 = wrong usage.
 */
async function main(): Promise<number> {
  // `process.argv.slice(2)` = the words typed after the script name. `[cmd, ...rest]` takes the first word
  // as `cmd` and gathers all remaining words into the array `rest` ("rest" destructuring).
  const [cmd, ...rest] = process.argv.slice(2);
  const s = settings();

  // ---- "run": run one source now.
  if (cmd === "run") {
    // Describe the accepted options; `parseArgs` returns `{ values }` with what was typed.
    // `multiple: true` allows `--provider a --provider b` (gives a list). `"dry-run"` needs quotes because
    // of the dash. `default: "manual"` is used when --trigger is not given.
    const { values } = parseArgs({
      args: rest,
      options: {
        source: { type: "string" },
        provider: { type: "string", multiple: true },
        limit: { type: "string" },
        "dry-run": { type: "boolean" },
        trigger: { type: "string", default: "manual" },
      },
    });
    // The source is required and must be a known one. `as never` lets `.includes` accept a plain string.
    if (!values.source || !SOURCES.includes(values.source as never)) throw new Error(`--source must be one of ${SOURCES.join(", ")}`);
    // Load the chosen providers (all published ones when no --provider is given), optionally capped by --limit.
    const providers = await store.loadProviders({ slugs: values.provider, limit: values.limit ? Number(values.limit) : undefined });
    // Any slug that was asked for but not found? `values.provider ?? []` = the list, or an empty list.
    // `.filter(...)` keeps the slugs for which `.some(...)` (any provider with that slug) is false.
    const missing = (values.provider ?? []).filter((slug) => !providers.some((p) => p.slug === slug));
    if (missing.length) throw new Error(`Unknown or unpublished provider(s): ${missing.join(", ")}`);
    // Run it. The result is unpacked into `runId` (null on a dry run) and `stats` (counts).
    // `values.trigger!`: `!` = "definitely set" (it has a default).
    const { runId, stats } = await runSource(makeSource(values.source, s), providers, { trigger: values.trigger!, dryRun: values["dry-run"] });
    console.log(`${values.source}: run ${runId ?? "(dry run)"} ${JSON.stringify(stats)}`);
    // Exit code 1 only if every provider failed (something is badly wrong); otherwise 0.
    return stats.failed && stats.failed === stats.providers ? 1 : 0;
  }

  // ---- "jobs": process requests queued from the Console.
  if (cmd === "jobs") {
    // Take up to 20 queued jobs (marking them as being worked on).
    const jobs = await store.claimJobs(20);
    if (!jobs.length) {
      console.log("No queued jobs.");
      return 0;
    }
    // `let` = a variable that may be changed later (unlike `const`). Becomes 1 if any source fails.
    let code = 0;
    // One run per source; a job without a provider means "all providers".
    // `new Set(jobs.map((j) => j.source))` = the distinct source names; `for (const x of list)` loops over them.
    for (const source of new Set(jobs.map((j) => j.source))) {
      // The jobs for this source.
      const items = jobs.filter((j) => j.source === source);
      // Did any of them ask for all providers (providerId null)?
      const everyone = items.some((j) => j.providerId === null);
      // `{}` = no filter (all providers); otherwise just the requested ids (`!` = not null here).
      const providers = await store.loadProviders(everyone ? {} : { ids: items.map((j) => j.providerId!) });
      try {
        const { runId, stats } = await runSource(makeSource(source, s), providers, { trigger: "admin" });
        // Mark each job done, linked to the run.
        for (const j of items) await store.finishJob(j.id, "done", runId);
        console.log(`${source}: run ${runId} ${JSON.stringify(stats)}`);
      } catch (err) {
        // The whole run failed: mark its jobs failed with the error text (first 500 characters).
        code = 1;
        for (const j of items) await store.finishJob(j.id, "failed", null, String(err).slice(0, 500));
      }
    }
    return code;
  }

  // Unknown command: show how to use it. Exit code 2 = "wrong usage".
  console.error("Usage: scrape run --source <ai_web|rcs> [--provider slug] [--limit n] [--dry-run] | scrape jobs");
  return 2;
}

// Start main(). `.then(async (code) => …)` runs when it finishes normally: close the database connections,
// then exit with the returned code. `.catch(...)` runs if it threw an error: print the message, try to
// close the connections (ignoring any error from that — `.catch(() => {})` = "do nothing on failure"),
// and exit with 1.
main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
