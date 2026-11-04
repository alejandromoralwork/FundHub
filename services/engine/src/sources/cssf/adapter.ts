/**
 * FILE: services/engine/src/sources/cssf/adapter.ts
 * PART: scraping engine (services/engine) — source "cssf"
 * WHAT IT DOES: Talks to the public JSON API behind CSSF eDesk "Search entities"
 *   (https://edesk.apps.cssf.lu/search-entities). No login, no browser needed:
 *     GET {base}/api/v1/entite?page=P&size=N&st=advanced&entType=SPP   → a page + totalElements (census)
 *     GET {base}/api/v1/entite/{entiteId}                                → one entity with all details
 *   The listing requires an entity type, so the census walks every type in CENSUS_TYPES.
 * WHERE IT RUNS: engine workers (queue "cssf") and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `class … implements`, async generators (`async *` + `yield`).
 */

import type { EngineConfig } from "../../config";
import type { PoliteHttp } from "../../http";
import type { RawCapture, SourceAdapter } from "../../core/types";
import { CSSF_PARSER_VERSION, parseCssf, type CssfApiEntity } from "./parse";

/**
 * Kind: constant. Entity types the census walks. Order = importance for FundHub, so a partial run already
 * covers the service providers. (CI, IFM and VAP return 0 on the API today; kept so new entries are noticed.)
 */
export const CENSUS_TYPES = [
  "SPP", "SUP", "C15", "C16", "AIFM_AUT", "AIFM_REG", "AIFM_REG_LU_OTHER_EU_MEMBER_STATE", "B", "IF", "CI",
  "IFM", "PI", "EMI", "AIP", "SPE", "CASP", "VAP", "EMONEY_TOKEN", "REFERENCE_TOKEN", "IHC", "CFI", "AGT",
  "CRF", "DCT", "MR", "MTF", "OTF", "ICI", "LM", "PF", "TIT", "SIC", "FIS", "OPC",
];

/** Kind: type alias. One listing page as the API returns it. */
type CssfPage = { content: CssfApiEntity[]; totalElements: number; totalPages: number; last: boolean };

/** Kind: class. The CSSF source adapter. */
export class CssfAdapter implements SourceAdapter {
  source = "cssf" as const;
  parserVersion = CSSF_PARSER_VERSION;

  constructor(
    private cfg: EngineConfig["cssf"],
    private http: PoliteHttp,
  ) {}

  /** Kind: method. Fetch one entity's full record by its CSSF internal id. */
  async fetch(externalId: string): Promise<RawCapture | null> {
    const url = `${this.cfg.apiBase}/api/v1/entite/${encodeURIComponent(externalId)}`;
    const res = await this.http.get(url, { delayMs: this.cfg.delayMs, okStatuses: [404] });
    return { source: "cssf", externalId, url, httpStatus: res.status, contentType: res.contentType ?? "application/json", body: res.body, ext: "json" };
  }

  parse = parseCssf;

  /**
   * Kind: async generator method. Walks the listing of one entity type page by page.
   * Yields `{ total, items }` per page, where items are the (detail-less) listing rows.
   * @param type      CSSF entity type code, e.g. "SPP".
   * @param pageSize  rows per page (the site itself asks for up to 50 000 on export; 500 is kinder).
   */
  async *listType(type: string, pageSize = 500): AsyncGenerator<{ total: number; items: CssfApiEntity[] }> {
    for (let page = 0; ; page++) {
      const url = `${this.cfg.apiBase}/api/v1/entite?page=${page}&size=${pageSize}&st=advanced&entType=${encodeURIComponent(type)}`;
      const { json } = await this.http.getJson<CssfPage>(url, { delayMs: this.cfg.delayMs });
      if (!json) return;
      yield { total: json.totalElements, items: json.content };
      if (json.last || json.content.length === 0) return;
    }
  }
}
