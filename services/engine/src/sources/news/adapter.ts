/**
 * FILE: services/engine/src/sources/news/adapter.ts
 * PART: scraping engine (services/engine) — source "news"
 * WHAT IT DOES: Two ways in:
 *   - fetchFeed(): one newspaper / press-release feed from ops.news_feeds (conditional GET with ETag /
 *     Last-Modified, so an unchanged feed costs one tiny request);
 *   - searchCompany(): a per-company news search (Google News RSS, query `"<name>" Luxembourg`) for the
 *     companies worth following (tier 2), which also reaches publishers without a feed (Paperjam, Delano…).
 *   Every item becomes one raw capture (JSON bundle), parsed by parse.ts parseArticle().
 * WHERE IT RUNS: engine workers (group "news", jobs `news_poll`, `news_search`).
 */

import type { RawCapture } from "../../core/types";
import type { PoliteHttp } from "../../http";
import { parseArticle, parseFeed, NEWS_PARSER_VERSION, type FeedItem, type NewsBundle } from "./parse";

const SEARCH = (q: string, lang: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang}&gl=LU&ceid=LU:${lang}`;

export class NewsAdapter {
  readonly source = "news" as const;
  readonly parserVersion = NEWS_PARSER_VERSION;

  constructor(
    private http: PoliteHttp,
    private userAgent: string,
    private delayMs = 1500,
  ) {}

  /** Kind: async method. Reads one feed. `null` items = not modified since last time. */
  async fetchFeed(feed: { url: string; etag: string | null; lastModified: string | null }): Promise<{ items: FeedItem[] | null; etag: string | null; lastModified: string | null }> {
    const headers: Record<string, string> = { "User-Agent": this.userAgent, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" };
    if (feed.etag) headers["If-None-Match"] = feed.etag;
    if (feed.lastModified) headers["If-Modified-Since"] = feed.lastModified;
    const res = await fetch(feed.url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (res.status === 304) return { items: null, etag: feed.etag, lastModified: feed.lastModified };
    if (!res.ok) throw new Error(`Feed ${feed.url} answered ${res.status}`);
    return { items: parseFeed(await res.text()), etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  }

  /** Kind: async method. News search for one company name. */
  async searchCompany(name: string, lang: string): Promise<FeedItem[]> {
    const res = await this.http.get(SEARCH(`"${name}" Luxembourg`, lang), { delayMs: this.delayMs, accept: "application/rss+xml" });
    if (res.status !== 200) throw new Error(`News search answered ${res.status}`);
    return parseFeed(res.body.toString("utf8"));
  }

  /** Kind: method. One item as a raw capture. */
  toRaw(item: FeedItem, feed: NewsBundle["feed"], targetCompanyId: string | null): RawCapture {
    const bundle: NewsBundle = { item, feed, targetCompanyId };
    return { source: "news", externalId: item.link, url: item.link, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(bundle)), ext: "json" };
  }

  parse = parseArticle;
  async fetch(): Promise<RawCapture | null> {
    throw new Error("NewsAdapter: use fetchFeed / searchCompany");
  }
}
