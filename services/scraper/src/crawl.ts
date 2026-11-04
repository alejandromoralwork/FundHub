/**
 * Polite, bounded crawl of a provider's own website: the homepage plus the most
 * informative same-site pages (about, services, team, licences, contact…).
 * Respects robots.txt and returns clean visible text for extraction.
 *
 * FILE: services/scraper/src/crawl.ts
 * PART: scraper (services/scraper)
 * WHAT IT DOES: Downloads a handful of pages from a provider's website and turns each into plain readable
 *   text for the AI extractor. It reads the homepage, scores its links by how likely they describe the
 *   company (an "about" link scores high, a "clients" link low), then visits the best ones. It obeys the
 *   site's robots.txt rules, waits between requests, and stops at a page limit and a character limit.
 * WHERE IT RUNS: on Node.js (GitHub Actions or a laptop), making web requests to provider websites.
 * FRAMEWORK NOTES: "cheerio" (npm) reads HTML and lets us pick elements with CSS selectors, jQuery-style
 *   (`$("title")`). "robots-parser" (npm) reads a site's robots.txt, the file where websites say which pages
 *   crawlers may visit. `fetch` is the built-in function for downloading a URL.
 * TYPESCRIPT YOU WILL SEE HERE: namespace and default imports, tuple types (`[string, number][]` = a list of
 *   pairs), regular expressions, `try/catch`, `Map<K, V>`, `.reduce`, `.sort` with a compare function,
 *   `ReturnType<typeof f>`, `typeof fetch`, destructuring with defaults, `while` loops, `Promise` + `setTimeout`.
 */

// `import * as cheerio` loads all of cheerio's exports under the name `cheerio`.
import * as cheerio from "cheerio";
// Default import: the library's main function, named robotsParser here.
import robotsParser from "robots-parser";

/**
 * Kind: type alias (exported). One crawled page: its final URL, its <title>, and its visible text.
 */
export type Page = { url: string; title: string; text: string };

/**
 * Kind: constant. Link text / URL hints, most informative first.
 * Type `[string, number][]` = a list of [keyword, weight] pairs. A link scores the sum of the weights of the
 * keywords found in its URL or text. Short stems like "licen", "regulat", "authori" match several word forms
 * (licence/license/licensed, regulation/regulated, authorised/authority).
 */
const PRIORITY: [string, number][] = [
  ["about", 10], ["who-we-are", 10], ["company", 8], ["services", 10], ["solutions", 8], ["expertise", 7],
  ["fund", 6], ["administration", 7], ["depositary", 7], ["compliance", 6], ["tax", 5], ["team", 6],
  ["people", 6], ["leadership", 5], ["licen", 7], ["regulat", 6], ["authori", 6], ["technology", 6],
  ["contact", 4], ["locations", 4], ["offices", 4], ["clients", 3],
];
/**
 * Kind: constant (regular expression — a text pattern). URLs to skip: files such as PDFs, images, office
 * documents and media (`\.(pdf|jpe?g|…)$` = ends with one of these extensions; `jpe?g` = jpg or jpeg), and
 * login/admin/cart/search pages. The `i` flag at the end = ignore upper/lower case.
 */
const SKIP = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3)$|\/(login|signin|wp-admin|cart|search)\b/i;
/** Kind: constant. CSS selector of page parts that are not useful content (code, menus, headers, footers…). */
const NOISE = "script, style, noscript, svg, iframe, form, header, footer, nav";

/**
 * Kind: constant holding an arrow function (private).
 * The website's host name without a leading "www.", e.g. "https://www.abc.lu/x" -> "abc.lu".
 * @param u  type `string` — a URL.
 * @returns  `string`: the bare host, or "" if `u` is not a valid URL (`new URL` throws, `catch` handles it).
 */
const bareHost = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Kind: function (exported; also used by the tests).
 * Turns a page's HTML into its title and clean visible text.
 * @param html  type `string` — the page source.
 * @returns     `{ title: string; text: string }`.
 */
export function pageText(html: string): { title: string; text: string } {
  // Parse the HTML. By convention the result is called `$`, used like `$("css selector")`.
  const $ = cheerio.load(html);
  // Text of the first <title> element, with surrounding spaces trimmed.
  const title = $("title").first().text().trim();
  // Delete the noisy elements from the parsed page.
  $(NOISE).remove();
  // Block elements become line breaks so words don't run together.
  $("p, div, li, h1, h2, h3, h4, h5, h6, br, tr, section, article").after("\n");
  // Take all body text and tidy the whitespace with regular expressions (`/…/g` = replace every match):
  // runs of spaces/tabs -> one space; a newline plus following spaces -> one newline; 3+ newlines -> 2.
  const text = $("body").text().replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

/**
 * Kind: function (exported; also used by the tests).
 * Same-site links ordered by how likely they describe the company.
 * @param baseUrl  type `string` — the page's own URL (used to resolve relative links and check the site).
 * @param html     type `string` — the page source.
 * @param limit    type `number` — how many links to return at most.
 * @returns        `string[]`: absolute URLs, best first.
 */
export function rankLinks(baseUrl: string, html: string, limit: number): string[] {
  const $ = cheerio.load(html);
  // url -> best score seen. `new Map<string, number>()`: the generic <…> fixes key and value types.
  const scores = new Map<string, number>();
  // For every <a> element with an href. `(_, el)`: the first argument (position) is unused, hence `_`.
  $("a[href]").each((_, el) => {
    // `let url: string;` declares a variable now and assigns it inside the `try`.
    let url: string;
    try {
      // Resolve the link against the page URL (so "/about" becomes "https://site/about").
      const u = new URL($(el).attr("href")!, baseUrl);
      // Drop "#section" parts and any trailing slash, so the same page is not counted twice.
      u.hash = "";
      url = u.toString().replace(/\/$/, "");
    } catch {
      // Not a valid link: skip it (`return` inside `.each` moves on to the next element).
      return;
    }
    // Skip non-web links (mailto:, tel:…), links to other sites, and unwanted files/pages.
    if (!/^https?:/.test(url) || bareHost(url) !== bareHost(baseUrl) || SKIP.test(url)) return;
    // The text to search for keywords: the URL plus the visible link text, lower case.
    const hay = `${url.toLowerCase()} ${$(el).text().toLowerCase()}`;
    // `.reduce` walks the PRIORITY list carrying a running total `s` (starting at 0): add the weight `w`
    // whenever the keyword `kw` appears. `[kw, w]` unpacks each pair.
    const score = PRIORITY.reduce((s, [kw, w]) => (hay.includes(kw) ? s + w : s), 0);
    // Keep the highest score if the same URL appears in several links.
    if (score) scores.set(url, Math.max(scores.get(url) ?? 0, score));
  });
  const base = baseUrl.replace(/\/$/, "");
  // `[...scores.keys()]` = the URLs as an array. Then: remove the page itself, sort, and cut to `limit`.
  // The compare function returns a negative/positive number to order two items: higher score first
  // (`scores.get(b)! - scores.get(a)!`); on a tie (0, which `||` treats as false) the shorter URL first.
  return [...scores.keys()]
    .filter((u) => u !== base)
    .sort((a, b) => scores.get(b)! - scores.get(a)! || a.length - b.length)
    .slice(0, limit);
}

/**
 * Kind: constant holding an arrow function (private).
 * Waits `ms` milliseconds. `new Promise((ok) => setTimeout(ok, ms))` makes a Promise that is fulfilled
 * when the timer fires, so `await sleep(500)` pauses for half a second.
 */
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Kind: async function (exported).
 * Crawls a website starting at `startUrl`.
 * @param startUrl  type `string` — usually the homepage.
 * @param opts      `userAgent` (our crawler's name, required); optional `maxPages` (default 8), `maxChars`
 *                  (default 60,000 characters in total), `delayMs` (pause between requests, default 500 ms),
 *                  `fetchImpl` (a replacement for `fetch`, used by tests; `typeof fetch` = same type as fetch).
 * @returns         `Promise<Page[]>`: the pages read, homepage first.
 */
export async function crawl(
  startUrl: string,
  opts: { userAgent: string; maxPages?: number; maxChars?: number; delayMs?: number; fetchImpl?: typeof fetch },
): Promise<Page[]> {
  // Unpack the options, with default values after `=` for any that were not given.
  const { userAgent, maxPages = 8, maxChars = 60_000, delayMs = 500, fetchImpl = fetch } = opts;
  // Helper: download a URL identifying ourselves, following redirects, giving up after 20 seconds.
  const get = (url: string) =>
    fetchImpl(url, { headers: { "User-Agent": userAgent }, redirect: "follow", signal: AbortSignal.timeout(20_000) });

  // "https://www.abc.lu" part of the start URL, to find robots.txt.
  const origin = new URL(startUrl).origin;
  // The parsed robots.txt, or null if there is none. `ReturnType<typeof robotsParser>` = "whatever type
  // robotsParser returns" (the `| null` adds "or nothing").
  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const res = await get(`${origin}/robots.txt`);
    // `res.ok` = the server answered with success (status 200–299).
    if (res.ok) robots = robotsParser(`${origin}/robots.txt`, await res.text());
  } catch {
    // Unreachable robots.txt: allow, as most crawlers do.
  }
  // May we visit this URL? Yes if there are no rules, or the rules do not explicitly forbid it.
  const allowed = (url: string) => !robots || robots.isAllowed(url, userAgent) !== false;

  // Results, the to-visit queue (starting with the homepage), URLs already visited, and characters so far.
  const pages: Page[] = [];
  const queue = [startUrl];
  const seen = new Set<string>();
  let total = 0;
  // Keep going while there is something to visit and neither limit has been reached.
  while (queue.length && pages.length < maxPages && total < maxChars) {
    // `.shift()` removes and returns the first item of the queue; `!` = surely there is one.
    const url = queue.shift()!;
    // Skip repeats and forbidden pages (`continue` = go round the loop again).
    if (seen.has(url) || !allowed(url)) continue;
    seen.add(url);
    // `let res: Response` — declared here, assigned in the try. A network error skips this page.
    let res: Response;
    try {
      res = await get(url);
    } catch {
      continue;
    }
    // Only successful HTML pages are read (not PDFs, images, error pages…).
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) continue;
    const html = await res.text();
    const { title, text } = pageText(html);
    // Cut the text so the total never exceeds maxChars.
    const clipped = text.slice(0, maxChars - total);
    if (clipped) {
      // `res.url` is the final address after any redirects (fall back to the requested one).
      pages.push({ url: res.url || url, title, text: clipped });
      total += clipped.length;
    }
    // Discover links from the homepage only: keeps the crawl small and predictable.
    // `queue.push(...list)` adds every item of the list (spread). We queue twice the page limit, since
    // some candidates will fail or be skipped.
    if (pages.length === 1) queue.push(...rankLinks(res.url || url, html, maxPages * 2));
    // Be polite: pause between requests.
    if (delayMs) await sleep(delayMs);
  }
  return pages;
}
