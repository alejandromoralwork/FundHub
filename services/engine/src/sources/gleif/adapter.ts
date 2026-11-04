/**
 * FILE: services/engine/src/sources/gleif/adapter.ts
 * PART: scraping engine (services/engine) — source "gleif"
 * WHAT IT DOES: Reads Luxembourg LEI records from the free GLEIF API (api.gleif.org, no key needed).
 *   - full census: every record with legal address in LU, via cursor pagination (page-number paging is
 *     capped at 10 000 results; `page[cursor]=*` then `links.next` walks the whole set, ~73k records);
 *   - delta: the same filter plus `registration.lastUpdateDate > since`.
 *   Each listed record is complete, so no second request per entity is needed.
 * WHERE IT RUNS: engine workers (queue "gleif") and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: async generators, `URLSearchParams`.
 */

import type { EngineConfig } from "../../config";
import type { PoliteHttp } from "../../http";
import type { RawCapture, SourceAdapter } from "../../core/types";
import { GLEIF_PARSER_VERSION, parseGleif, type GleifRecord } from "./parse";

type GleifPage = { meta: { pagination?: { total: number } }; data: GleifRecord[]; links: { next?: string } };

/** Kind: class. The GLEIF source adapter. */
export class GleifAdapter implements SourceAdapter {
  source = "gleif" as const;
  parserVersion = GLEIF_PARSER_VERSION;

  constructor(
    private cfg: EngineConfig["gleif"],
    private http: PoliteHttp,
  ) {}

  /** Kind: method. One LEI record. */
  async fetch(lei: string): Promise<RawCapture | null> {
    const url = `${this.cfg.apiBase}/lei-records/${encodeURIComponent(lei)}`;
    const res = await this.http.get(url, { delayMs: this.cfg.delayMs, okStatuses: [404], accept: "application/vnd.api+json" });
    return { source: "gleif", externalId: lei, url, httpStatus: res.status, contentType: "application/json", body: res.body, ext: "json" };
  }

  parse = parseGleif;

  /**
   * Kind: async generator method. Lists LU records page by page.
   * @param since  ISO date — only records updated after it (delta); omit for the full census.
   * Yields `{ total, items }`, where each item is a RawCapture of one record (stored like a single fetch).
   */
  async *list(since?: string): AsyncGenerator<{ total: number | null; items: RawCapture[] }> {
    const q = new URLSearchParams({ "filter[entity.legalAddress.country]": "LU", "page[size]": String(this.cfg.pageSize), "page[cursor]": "*" });
    if (since) q.set("filter[registration.lastUpdateDate]", `>${since}`);
    let url: string | undefined = `${this.cfg.apiBase}/lei-records?${q}`;
    while (url) {
      const { json }: { json: GleifPage | null } = await this.http.getJson<GleifPage>(url, { delayMs: this.cfg.delayMs });
      if (!json) return;
      yield {
        total: json.meta.pagination?.total ?? null,
        items: json.data.map((r) => ({
          source: "gleif",
          externalId: r.attributes.lei,
          url: `${this.cfg.apiBase}/lei-records/${r.attributes.lei}`,
          httpStatus: 200,
          contentType: "application/json",
          body: Buffer.from(JSON.stringify({ data: r })),
          ext: "json",
        })),
      };
      url = json.data.length ? json.links.next : undefined;
    }
  }
}
