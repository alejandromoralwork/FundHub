/**
 * FILE: services/engine/src/sources/news/parse.ts
 * PART: scraping engine (services/engine) — source "news" (pure)
 * WHAT IT DOES:
 *   - parseFeed(): reads an RSS 2.0 or Atom feed (XML) into items: link, title, date, author, summary.
 *   - parseArticle(): one item (stored in raw as JSON) → a ParsedRecord whose `article` the release stage
 *     writes to clean.articles, then matches against company names (pipeline/mentions.ts).
 *   Only the title, a short snippet and the link are kept: FundHub links to the publisher, it does not
 *   republish articles.
 * WHERE IT RUNS: anywhere — no I/O (tested on fixtures).
 */

import * as cheerio from "cheerio";
import type { ParsedRecord, RawCapture } from "../../core/types";

export const NEWS_PARSER_VERSION = 1;

/** Kind: type alias. One feed item. */
export type FeedItem = { link: string; title: string; publishedAt: string | null; author: string | null; summary: string | null; publisher: string | null };
/** Kind: type alias. What is stored in raw for one article. */
export type NewsBundle = { item: FeedItem; feed: { id: number | null; name: string; language: string | null }; targetCompanyId: string | null };

const text = (html: string | undefined | null) =>
  (html ? cheerio.load(`<div>${html}</div>`).text() : "")
    .replace(/\s+/g, " ")
    .trim();

/** Kind: function. RSS 2.0 / Atom → items (newest first as the feed lists them). */
export function parseFeed(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: FeedItem[] = [];
  $("item").each((_, el) => {
    const e = $(el);
    const link = e.children("link").first().text().trim() || e.children("guid").first().text().trim();
    if (!link) return;
    const date = e.children("pubDate").first().text().trim() || e.children("dc\\:date").first().text().trim();
    items.push({
      link,
      title: text(e.children("title").first().text()),
      publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
      author: text(e.children("dc\\:creator").first().text() || e.children("author").first().text()) || null,
      summary: text(e.children("description").first().text()).slice(0, 600) || null,
      publisher: text(e.children("source").first().text()) || null,
    });
  });
  $("entry").each((_, el) => {
    const e = $(el);
    const link = e.children("link[rel='alternate']").attr("href") ?? e.children("link").first().attr("href") ?? "";
    if (!link) return;
    const date = e.children("published").first().text().trim() || e.children("updated").first().text().trim();
    items.push({
      link,
      title: text(e.children("title").first().text()),
      publishedAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null,
      author: text(e.find("author > name").first().text()) || null,
      summary: text(e.children("summary").first().text() || e.children("content").first().text()).slice(0, 600) || null,
      publisher: null,
    });
  });
  return items.filter((i) => i.title);
}

/** Kind: function. One stored article → ParsedRecord (external id = the article link). */
export function parseArticle(raw: RawCapture): ParsedRecord {
  const b = JSON.parse(raw.body.toString("utf8")) as NewsBundle;
  const snippet = b.item.summary ? b.item.summary.slice(0, 300) : null;
  return {
    source: "news",
    externalId: b.item.link,
    state: "found",
    scope: b.feed.id ? `feed:${b.feed.id}` : "search",
    targetCompanyId: b.targetCompanyId,
    facts: {},
    identifiers: [],
    names: [],
    article: {
      url: b.item.link,
      title: b.item.title,
      publishedAt: b.item.publishedAt,
      author: b.item.author ?? b.item.publisher,
      language: b.feed.language,
      snippet,
      feedId: b.feed.id,
      textBlobKey: null,
      matchText: `${b.item.title}\n${b.item.summary ?? ""}`,
    },
  };
}
