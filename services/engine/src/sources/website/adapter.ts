/**
 * FILE: services/engine/src/sources/website/adapter.ts
 * PART: scraping engine (services/engine) — source "website"
 * WHAT IT DOES: Crawls ONE company's own website (polite, robots.txt, bounded: crawl.ts), asks Claude for the
 *   facts it states (extract.ts) and returns everything as one raw JSON bundle; parse.ts turns the bundle into
 *   a ParsedRecord. Unlike the register adapters it is fetched FOR a known company (the one whose website
 *   it is), so `fetchFor()` takes that company instead of an external id.
 * WHERE IT RUNS: engine workers (group "web", job `website_crawl`).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { EngineConfig } from "../../config";
import type { ParsedRecord, RawCapture } from "../../core/types";
import { canonicalUrl } from "../../pipeline/clean";
import { crawl } from "./crawl";
import { extractFacts, ExtractionError, type MessagesClient } from "./extract";
import { parseWebsite, siteKey, WEBSITE_PARSER_VERSION, type WebsiteBundle } from "./parse";

export class WebsiteAdapter {
  readonly source = "website" as const;
  readonly parserVersion = WEBSITE_PARSER_VERSION;
  private client: MessagesClient | null;

  constructor(
    private cfg: EngineConfig,
    client?: MessagesClient,
    private crawlImpl: typeof crawl = crawl,
  ) {
    this.client = client ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic() : null);
  }

  /**
   * Kind: async method. Crawl + extract for one company.
   * @returns the raw bundle, or null when the site has no readable page.
   */
  async fetchFor(company: { id: string; name: string; rcsNumber: string | null; website: string }): Promise<RawCapture | null> {
    const start = canonicalUrl(company.website);
    if (!start) throw new ExtractionError(`Not a usable website: ${company.website}`);
    if (!this.client) throw new ExtractionError("ANTHROPIC_API_KEY is not set: the website source needs it for extraction");
    const pages = await this.crawlImpl(start, { userAgent: this.cfg.userAgent, maxPages: this.cfg.website.maxPages, maxChars: this.cfg.website.maxChars, delayMs: this.cfg.website.delayMs });
    if (!pages.length) return null;
    const out = await extractFacts(this.client, this.cfg.anthropic, { name: company.name, website: start }, pages);
    const bundle: WebsiteBundle = { company: { ...company, website: start }, fetchedAt: new Date().toISOString(), pages, fields: out.fields, model: out.model, usage: out.usage };
    return { source: "website", externalId: siteKey(pages[0].url), url: pages[0].url, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(bundle)), ext: "json" };
  }

  parse(raw: RawCapture): ParsedRecord {
    return parseWebsite(raw);
  }

  /** Websites are fetched per company (fetchFor); there is no lookup by external id alone. */
  async fetch(): Promise<RawCapture | null> {
    throw new Error("WebsiteAdapter: use fetchFor(company)");
  }
}
