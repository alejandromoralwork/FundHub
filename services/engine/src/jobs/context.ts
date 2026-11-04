/**
 * FILE: services/engine/src/jobs/context.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: The context handed to every job handler: settings, the polite HTTP client, object storage,
 *   the adapters, and `enqueue` — which either puts a follow-up job on the queue (worker mode) or runs it
 *   immediately (CLI "inline" mode, handy on a laptop without a worker). The RCS browser is created lazily,
 *   only when an RCS job actually runs, so CSSF/GLEIF workers never start Chromium.
 * WHERE IT RUNS: engine workers and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: type aliases with function members, lazy getters, closures.
 */

import { config, type EngineConfig } from "../config";
import { PoliteHttp } from "../http";
import { makeBlobStore, type BlobStore } from "../storage";
import { CssfAdapter } from "../sources/cssf/adapter";
import { GleifAdapter } from "../sources/gleif/adapter";
import { RcsAdapter } from "../sources/rcs/adapter";
import { RcsBrowser } from "../sources/rcs/browser";

/** Kind: type alias. Options for a queued follow-up job. */
export type EnqueueOptions = { singletonKey?: string; startAfter?: Date | number; priority?: number };

/** Kind: type alias. Everything a job handler may use. */
export type JobContext = {
  cfg: EngineConfig;
  http: PoliteHttp;
  blobs: BlobStore;
  trigger: string;
  cssf: CssfAdapter;
  gleif: GleifAdapter;
  /** Created on first use (starts a browser). */
  rcs(): { adapter: RcsAdapter; browser: RcsBrowser };
  enqueue(job: string, data: Record<string, unknown>, opts?: EnqueueOptions): Promise<void>;
  /** Releases resources (closes the browser). */
  close(): Promise<void>;
};

/**
 * Kind: function. Builds a job context.
 * @param enqueue  how follow-up jobs are dispatched (queue send, or direct call).
 * @param trigger  "schedule" | "manual" | "admin" — stored on runs.
 */
export function makeContext(enqueue: JobContext["enqueue"], trigger: string): JobContext {
  const cfg = config();
  const http = new PoliteHttp(cfg.userAgent);
  let rcs: { adapter: RcsAdapter; browser: RcsBrowser } | null = null;
  return {
    cfg,
    http,
    blobs: makeBlobStore(cfg.storage),
    trigger,
    cssf: new CssfAdapter(cfg.cssf, http),
    gleif: new GleifAdapter(cfg.gleif, http),
    rcs() {
      if (!rcs) {
        const browser = new RcsBrowser(cfg.rcs);
        rcs = { adapter: new RcsAdapter(browser), browser };
      }
      return rcs;
    },
    enqueue,
    async close() {
      await rcs?.browser.close();
    },
  };
}
