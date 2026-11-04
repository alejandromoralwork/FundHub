/**
 * FILE: services/engine/src/sources/rcs/browser.ts
 * PART: scraping engine (services/engine) — source "rcs"
 * WHAT IT DOES: Drives a real Chromium browser (Playwright) with a PERSISTENT PROFILE folder, so the LuxTrust
 *   login you complete once by hand (`engine rcs:login`) is reused by the worker until it expires.
 *   It opens an RCS company page, switches to "List of filings", and returns the page text + HTML.
 *   It NEVER tries to get past a captcha or bot check: it detects them and throws `RcsSessionError`, the
 *   worker then pauses the RCS queue and records the state in `session_health` so a person can log in again.
 * WHERE IT RUNS: the RCS worker only (your PC, or a VM with a noVNC sidecar for the login screen).
 * FRAMEWORK NOTES: Playwright's `launchPersistentContext(dir)` = a browser that keeps cookies/storage in
 *   `dir` between runs. Selectors / URLs are configurable via env (RCS_*) because LBR's markup may change.
 * TYPESCRIPT YOU WILL SEE HERE: classes, private fields, `instanceof`, optional chaining.
 */

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { EngineConfig } from "../../config";
import { sleep } from "../../http";
import { log } from "../../log";

/** Kind: class. The session is unusable (logged out, captcha, access denied) — needs a person. */
export class RcsSessionError extends Error {
  constructor(
    public state: "logged_out" | "blocked",
    message: string,
  ) {
    super(message);
  }
}

/** Kind: constant. Page text that means a bot check or a block. */
const BLOCKED_RE = /captcha|are you a robot|unusual traffic|access denied|too many requests/i;
/** Kind: constant. URL / text that means we are on a login page. */
const LOGGED_OUT_URL_RE = new RegExp(process.env.RCS_LOGGED_OUT_URL_RE ?? "luxtrust|/login|/auth", "i");

/** Kind: type alias. What one page capture returns. */
export type RcsPageCapture = { url: string; text: string; html: string };

/** Kind: class. One browser session, reused across many lookups. */
export class RcsBrowser {
  #ctx: BrowserContext | null = null;
  #page: Page | null = null;

  constructor(private cfg: EngineConfig["rcs"]) {}

  /**
   * Kind: method. Opens (or reuses) the persistent browser.
   * @param headless  override cfg.headless (login and capture always run headed).
   */
  async open(headless = this.cfg.headless): Promise<Page> {
    if (this.#page) return this.#page;
    const dir = resolve(this.cfg.profileDir);
    await mkdir(dir, { recursive: true });
    this.#ctx = await chromium.launchPersistentContext(dir, {
      headless,
      locale: "en-GB",
      timezoneId: "Europe/Luxembourg",
      viewport: { width: 1366, height: 900 },
    });
    this.#page = this.#ctx.pages()[0] ?? (await this.#ctx.newPage());
    return this.#page;
  }

  /** Kind: method. Closes the browser (the profile stays on disk). */
  async close() {
    await this.#ctx?.close();
    this.#ctx = null;
    this.#page = null;
  }

  /**
   * Kind: method. Throws RcsSessionError if the current page is a login page or a bot check.
   * @param page  type `Page`.
   */
  async assertUsable(page: Page) {
    if (LOGGED_OUT_URL_RE.test(page.url())) throw new RcsSessionError("logged_out", `Redirected to login: ${page.url()}`);
    const text = await page.innerText("body").catch(() => "");
    if (BLOCKED_RE.test(text)) throw new RcsSessionError("blocked", "Bot check / block page detected");
  }

  /** Kind: method. A human-like pause: base delay + random jitter. */
  async pace() {
    await sleep(this.cfg.delayMs + Math.floor(Math.random() * this.cfg.jitterMs));
  }

  /**
   * Kind: method. Opens the company page for an RCS number and returns its text with the filings list.
   * Navigation: RCS_ENTITY_URL_TEMPLATE if set (direct link), else the search form on RCS_SEARCH_URL.
   * @param rcs  type `string` — e.g. "B145917".
   * @returns `Promise<RcsPageCapture>`.
   */
  async capture(rcs: string): Promise<RcsPageCapture> {
    const page = await this.open();
    await this.pace();
    if (this.cfg.entityUrlTemplate) {
      await page.goto(this.cfg.entityUrlTemplate.replace("{number}", encodeURIComponent(rcs)), { waitUntil: "domcontentloaded" });
    } else {
      await page.goto(this.cfg.searchUrl, { waitUntil: "domcontentloaded" });
      await this.assertUsable(page);
      const input = page.locator(process.env.RCS_SEARCH_INPUT ?? 'input[type="search"], input[name*="rcs" i], input[id*="search" i]').first();
      await input.fill(rcs);
      await input.press("Enter");
      await page.waitForLoadState("domcontentloaded");
      await this.assertUsable(page);
      // Results list → the row whose text is exactly the number.
      const hit = page.getByText(rcs, { exact: true }).first();
      if (await hit.isVisible().catch(() => false)) {
        await this.pace();
        await hit.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }
    await this.assertUsable(page);
    // Show the filings tab if it is a tab.
    const filingsTab = page.getByText(/^List of filings$/i).first();
    if (await filingsTab.isVisible().catch(() => false)) {
      await filingsTab.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    const text = await page.innerText("body");
    const html = await page.content();
    log.debug("rcs captured", { rcs, url: page.url(), chars: text.length });
    return { url: page.url(), text, html };
  }

  /**
   * Kind: method. Downloads a filing document while logged in (used for tier ≥ 1 entities).
   * @param url  the document link as shown on the filings list.
   * @returns `Promise<Buffer>` — the PDF bytes.
   */
  async download(url: string): Promise<{ body: Buffer; contentType: string }> {
    const page = await this.open();
    await this.pace();
    const res = await page.context().request.get(url);
    if (!res.ok()) throw new Error(`RCS document HTTP ${res.status()} for ${url}`);
    const contentType = res.headers()["content-type"] ?? "application/pdf";
    if (contentType.includes("text/html")) throw new RcsSessionError("logged_out", "Got an HTML page instead of a document");
    return { body: Buffer.from(await res.body()), contentType };
  }
}
