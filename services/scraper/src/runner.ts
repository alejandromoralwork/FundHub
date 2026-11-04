/**
 * FILE: services/scraper/src/runner.ts
 * PART: scraper (services/scraper)
 * WHAT IT DOES: Runs one data source over a list of providers. For each provider it fetches what the source
 *   finds, keeps only the facts that differ from the live profile, and saves those as a record for staff to
 *   review. It counts what happened (saved, unchanged, empty, failed) and logs the run in the database.
 *   One provider failing never stops the run.
 * WHERE IT RUNS: on Node.js (GitHub Actions or a laptop), called from cli.ts.
 * FRAMEWORK NOTES: the `saveImpl` and `log` options let tests swap in fake storage and logging, so the
 *   runner can be tested without a database ("dependency injection").
 * TYPESCRIPT YOU WILL SEE HERE: `import type`, `class` instances with `new`, type aliases, function types
 *   (`(msg: string) => void`), `typeof store` (the type of a whole module), default parameter values,
 *   `try/catch/finally`, `continue`, `++`, non-null `!`, spread `{ ...ext, fields }`, `number | null`.
 */

// `import type` = types only, no run-time code. `@fundhub/…` = our shared packages.
import type { IngestSource } from "@fundhub/db/schema";
// `./x` = a file next to this one.
import type { Settings } from "./config";
// The two data-source classes.
import { AiWebSource } from "./sources/ai-web";
import { RcsSource } from "./sources/rcs";
// All database functions of store.ts under one name.
import * as store from "./store";
import type { ProviderRef, Source } from "./types";

/** Kind: constant (exported). The list of valid source names; `: IngestSource[]` = list of those names. */
export const SOURCES: IngestSource[] = ["ai_web", "rcs"];

/**
 * Kind: function (exported).
 * Builds the data source called `name`.
 * @param name  type `string` — "ai_web" or "rcs".
 * @param s     type `Settings` — the scraper settings, handed to the source.
 * @returns     `Source`: a new source object (`new ClassName(...)` creates an instance of a class).
 * @throws      an Error for any other name.
 */
export function makeSource(name: string, s: Settings): Source {
  if (name === "ai_web") return new AiWebSource(s);
  if (name === "rcs") return new RcsSource(s);
  throw new Error(`Unknown source "${name}". Use one of: ${SOURCES.join(", ")}`);
}

/**
 * Kind: type alias (exported). The counts kept during a run:
 * providers = how many were processed; records = saved for review; unchanged = nothing new;
 * empty = the source found nothing; failed = an error occurred.
 */
export type RunStats = { providers: number; records: number; unchanged: number; empty: number; failed: number };
/** Kind: type alias. A logging function: takes a message, returns nothing (`void`). */
type Log = (msg: string) => void;

/**
 * Kind: async function (exported).
 * Runs one source over providers. One provider failing never stops the run.
 * @param source     type `Source` — the data source to use.
 * @param providers  type `ProviderRef[]` — the providers to process.
 * @param opts       options object: `trigger` ("manual", "admin", "schedule"…); `dryRun?` = only print, save
 *                   nothing; `log?` = where to write messages; `saveImpl?` = a replacement for the store module
 *                   (for tests). `typeof store` = "the same shape as the store module". `= { trigger: "manual" }`
 *                   is the default when no options are passed.
 * @returns          `Promise<{ runId, stats }>`: the database id of the run (null on a dry run) and the counts.
 */
export async function runSource(
  source: Source,
  providers: ProviderRef[],
  opts: { trigger: string; dryRun?: boolean; log?: Log; saveImpl?: typeof store } = { trigger: "manual" },
): Promise<{ runId: number | null; stats: RunStats }> {
  // Use the supplied logger/store, or the real ones (`??` = fallback when missing).
  const log = opts.log ?? console.log;
  const st = opts.saveImpl ?? store;
  // Start every count at 0.
  const stats: RunStats = { providers: providers.length, records: 0, unchanged: 0, empty: 0, failed: 0 };
  // Record the start of the run in the database, unless this is a dry run.
  const runId = opts.dryRun ? null : await st.startRun(source.name, opts.trigger);
  // An unexpected error that ends the whole run (`Error | undefined` = an error, or nothing yet).
  let fatal: Error | undefined;
  // try/catch/finally: `finally` always runs at the end — whether the loop finished or an error escaped —
  // so the run is always closed off in the database.
  try {
    // Process providers one at a time.
    for (const p of providers) {
      // Inner try/catch: an error for one provider is counted and logged, then the loop moves on.
      try {
        const ext = await source.fetch(p);
        // Nothing found (null, or no fields): count as empty. `continue` jumps to the next provider.
        if (!ext || !Object.keys(ext.fields).length) {
          stats.empty++;
          log(`· ${source.name} ${p.slug}: nothing extracted`);
          continue;
        }
        // Only differences reach the review queue.
        const fields = await st.changedFields(ext);
        if (!Object.keys(fields).length) {
          stats.unchanged++;
          log(`= ${source.name} ${p.slug}: matches the live profile`);
          continue;
        }
        // Dry run: print the changed values as JSON (field -> value only). Otherwise save the record for review.
        // `{ ...ext, fields }` = a copy of the extraction with `fields` replaced by just the changed ones.
        // `runId!` = definitely a number here (not a dry run).
        if (opts.dryRun) log(`· ${source.name} ${p.slug}: ${JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value])))}`);
        else await st.saveRecord(runId!, source.name, { ...ext, fields });
        // `++` adds 1.
        stats.records++;
        log(`✔ ${source.name} ${p.slug}: ${Object.keys(fields).length} changed fields`);
      } catch (err) {
        stats.failed++;
        log(`✘ ${source.name} ${p.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    // Something outside the per-provider handling failed: remember it and re-throw it to the caller.
    fatal = err instanceof Error ? err : new Error(String(err));
    throw fatal;
  } finally {
    // Close the run in the database (not for dry runs). It counts as failed if a fatal error happened or
    // every single provider failed.
    if (runId !== null) {
      const allFailed = stats.failed > 0 && stats.failed === stats.providers;
      await st.finishRun(runId, fatal || allFailed ? "failed" : "succeeded", stats, fatal?.message);
    }
  }
  return { runId, stats };
}
