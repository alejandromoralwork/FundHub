/**
 * FundHub data module.
 *
 *   npm run scrape -- run --source ai_web [--provider SLUG ...] [--limit N] [--dry-run]
 *   npm run scrape -- run --source rcs
 *   npm run scrape -- jobs        # process jobs queued from the admin platform ("Run scrape")
 */
import { parseArgs } from "node:util";
import { pool } from "@fundhub/db/client";
import { settings } from "./config";
import { makeSource, runSource, SOURCES } from "./runner";
import * as store from "./store";

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const s = settings();

  if (cmd === "run") {
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
    if (!values.source || !SOURCES.includes(values.source as never)) throw new Error(`--source must be one of ${SOURCES.join(", ")}`);
    const providers = await store.loadProviders({ slugs: values.provider, limit: values.limit ? Number(values.limit) : undefined });
    const missing = (values.provider ?? []).filter((slug) => !providers.some((p) => p.slug === slug));
    if (missing.length) throw new Error(`Unknown or unpublished provider(s): ${missing.join(", ")}`);
    const { runId, stats } = await runSource(makeSource(values.source, s), providers, { trigger: values.trigger!, dryRun: values["dry-run"] });
    console.log(`${values.source}: run ${runId ?? "(dry run)"} ${JSON.stringify(stats)}`);
    return stats.failed && stats.failed === stats.providers ? 1 : 0;
  }

  if (cmd === "jobs") {
    const jobs = await store.claimJobs(20);
    if (!jobs.length) {
      console.log("No queued jobs.");
      return 0;
    }
    let code = 0;
    // One run per source; a job without a provider means "all providers".
    for (const source of new Set(jobs.map((j) => j.source))) {
      const items = jobs.filter((j) => j.source === source);
      const everyone = items.some((j) => j.providerId === null);
      const providers = await store.loadProviders(everyone ? {} : { ids: items.map((j) => j.providerId!) });
      try {
        const { runId, stats } = await runSource(makeSource(source, s), providers, { trigger: "admin" });
        for (const j of items) await store.finishJob(j.id, "done", runId);
        console.log(`${source}: run ${runId} ${JSON.stringify(stats)}`);
      } catch (err) {
        code = 1;
        for (const j of items) await store.finishJob(j.id, "failed", null, String(err).slice(0, 500));
      }
    }
    return code;
  }

  console.error("Usage: scrape run --source <ai_web|rcs> [--provider slug] [--limit n] [--dry-run] | scrape jobs");
  return 2;
}

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
