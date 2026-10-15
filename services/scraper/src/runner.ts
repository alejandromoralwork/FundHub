import type { IngestSource } from "@fundhub/db/schema";
import type { Settings } from "./config";
import { AiWebSource } from "./sources/ai-web";
import { RcsSource } from "./sources/rcs";
import * as store from "./store";
import type { ProviderRef, Source } from "./types";

export const SOURCES: IngestSource[] = ["ai_web", "rcs"];

export function makeSource(name: string, s: Settings): Source {
  if (name === "ai_web") return new AiWebSource(s);
  if (name === "rcs") return new RcsSource(s);
  throw new Error(`Unknown source "${name}". Use one of: ${SOURCES.join(", ")}`);
}

export type RunStats = { providers: number; records: number; unchanged: number; empty: number; failed: number };
type Log = (msg: string) => void;

/** Runs one source over providers. One provider failing never stops the run. */
export async function runSource(
  source: Source,
  providers: ProviderRef[],
  opts: { trigger: string; dryRun?: boolean; log?: Log; saveImpl?: typeof store } = { trigger: "manual" },
): Promise<{ runId: number | null; stats: RunStats }> {
  const log = opts.log ?? console.log;
  const st = opts.saveImpl ?? store;
  const stats: RunStats = { providers: providers.length, records: 0, unchanged: 0, empty: 0, failed: 0 };
  const runId = opts.dryRun ? null : await st.startRun(source.name, opts.trigger);
  let fatal: Error | undefined;
  try {
    for (const p of providers) {
      try {
        const ext = await source.fetch(p);
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
        if (opts.dryRun) log(`· ${source.name} ${p.slug}: ${JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.value])))}`);
        else await st.saveRecord(runId!, source.name, { ...ext, fields });
        stats.records++;
        log(`✔ ${source.name} ${p.slug}: ${Object.keys(fields).length} changed fields`);
      } catch (err) {
        stats.failed++;
        log(`✘ ${source.name} ${p.slug}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    fatal = err instanceof Error ? err : new Error(String(err));
    throw fatal;
  } finally {
    if (runId !== null) {
      const allFailed = stats.failed > 0 && stats.failed === stats.providers;
      await st.finishRun(runId, fatal || allFailed ? "failed" : "succeeded", stats, fatal?.message);
    }
  }
  return { runId, stats };
}
