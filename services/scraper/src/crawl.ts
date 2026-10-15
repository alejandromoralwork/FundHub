/**
 * Polite, bounded crawl of a provider's own website: the homepage plus the most
 * informative same-site pages (about, services, team, licences, contact…).
 * Respects robots.txt and returns clean visible text for extraction.
 */
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

export type Page = { url: string; title: string; text: string };

/** Link text / URL hints, most informative first. */
const PRIORITY: [string, number][] = [
  ["about", 10], ["who-we-are", 10], ["company", 8], ["services", 10], ["solutions", 8], ["expertise", 7],
  ["fund", 6], ["administration", 7], ["depositary", 7], ["compliance", 6], ["tax", 5], ["team", 6],
  ["people", 6], ["leadership", 5], ["licen", 7], ["regulat", 6], ["authori", 6], ["technology", 6],
  ["contact", 4], ["locations", 4], ["offices", 4], ["clients", 3],
];
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3)$|\/(login|signin|wp-admin|cart|search)\b/i;
const NOISE = "script, style, noscript, svg, iframe, form, header, footer, nav";

const bareHost = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export function pageText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  $(NOISE).remove();
  // Block elements become line breaks so words don't run together.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article").after("\n");
  const text = $("body").text().replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

/** Same-site links ordered by how likely they describe the company. */
export function rankLinks(baseUrl: string, html: string, limit: number): string[] {
  const $ = cheerio.load(html);
  const scores = new Map<string, number>();
  $("a[href]").each((_, el) => {
    let url: string;
    try {
      const u = new URL($(el).attr("href")!, baseUrl);
      u.hash = "";
      url = u.toString().replace(/\/$/, "");
    } catch {
      return;
    }
    if (!/^https?:/.test(url) || bareHost(url) !== bareHost(baseUrl) || SKIP.test(url)) return;
    const hay = `${url.toLowerCase()} ${$(el).text().toLowerCase()}`;
    const score = PRIORITY.reduce((s, [kw, w]) => (hay.includes(kw) ? s + w : s), 0);
    if (score) scores.set(url, Math.max(scores.get(url) ?? 0, score));
  });
  const base = baseUrl.replace(/\/$/, "");
  return [...scores.keys()]
    .filter((u) => u !== base)
    .sort((a, b) => scores.get(b)! - scores.get(a)! || a.length - b.length)
    .slice(0, limit);
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export async function crawl(
  startUrl: string,
  opts: { userAgent: string; maxPages?: number; maxChars?: number; delayMs?: number; fetchImpl?: typeof fetch },
): Promise<Page[]> {
  const { userAgent, maxPages = 8, maxChars = 60_000, delayMs = 500, fetchImpl = fetch } = opts;
  const get = (url: string) =>
    fetchImpl(url, { headers: { "User-Agent": userAgent }, redirect: "follow", signal: AbortSignal.timeout(20_000) });

  const origin = new URL(startUrl).origin;
  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const res = await get(`${origin}/robots.txt`);
    if (res.ok) robots = robotsParser(`${origin}/robots.txt`, await res.text());
  } catch {
    // Unreachable robots.txt: allow, as most crawlers do.
  }
  const allowed = (url: string) => !robots || robots.isAllowed(url, userAgent) !== false;

  const pages: Page[] = [];
  const queue = [startUrl];
  const seen = new Set<string>();
  let total = 0;
  while (queue.length && pages.length < maxPages && total < maxChars) {
    const url = queue.shift()!;
    if (seen.has(url) || !allowed(url)) continue;
    seen.add(url);
    let res: Response;
    try {
      res = await get(url);
    } catch {
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) continue;
    const html = await res.text();
    const { title, text } = pageText(html);
    const clipped = text.slice(0, maxChars - total);
    if (clipped) {
      pages.push({ url: res.url || url, title, text: clipped });
      total += clipped.length;
    }
    // Discover links from the homepage only: keeps the crawl small and predictable.
    if (pages.length === 1) queue.push(...rankLinks(res.url || url, html, maxPages * 2));
    if (delayMs) await sleep(delayMs);
  }
  return pages;
}
