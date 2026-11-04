/**
 * FILE: services/engine/src/sources/rcs/adapter.ts
 * PART: scraping engine (services/engine) — source "rcs"
 * WHAT IT DOES: The RCS (Luxembourg Business Registers, lbr.lu) source adapter. `fetch("B145917")` opens the
 *   company page in the logged-in browser and returns `{ url, text, html }` as one raw capture (JSON), which
 *   `parse` turns into facts + filings. Pacing, active hours and the daily cap are enforced by the job
 *   (jobs/rcs.ts), not here, so this class stays a thin wrapper.
 * WHERE IT RUNS: the RCS worker.
 * TYPESCRIPT YOU WILL SEE HERE: `implements`, `Buffer.from(JSON.stringify(...))`.
 */

import type { RawCapture, SourceAdapter } from "../../core/types";
import type { RcsBrowser } from "./browser";
import { parseRcs, RCS_PARSER_VERSION } from "./parse";

/** Kind: class. The RCS source adapter. */
export class RcsAdapter implements SourceAdapter {
  source = "rcs" as const;
  parserVersion = RCS_PARSER_VERSION;

  constructor(private browser: RcsBrowser) {}

  /** Kind: method. Captures one company page (never null: "not found" pages are parsed as such). */
  async fetch(rcs: string): Promise<RawCapture> {
    const page = await this.browser.capture(rcs);
    return {
      source: "rcs",
      externalId: rcs,
      url: page.url,
      httpStatus: 200,
      contentType: "application/json",
      body: Buffer.from(JSON.stringify(page)),
      ext: "json",
    };
  }

  parse = parseRcs;
}
