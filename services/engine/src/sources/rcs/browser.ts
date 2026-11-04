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

import { mkdir, writeFile } from "node:fs/promises";
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

/**
 * Kind: constant. Page text that means LBR is limiting us. LBR redirects to `AccessLimitation.html` when a
 * quota is exceeded (seen in the portal's code), so that URL is checked too.
 */
const BLOCKED_RE = /access limitation|limitation d'acc[eè]s|are you a robot|unusual traffic|access denied|too many requests/i;
const BLOCKED_URL_RE = /AccessLimitation/i;
/** Kind: constant. LBR's anti-robot widget (Friendly Captcha). When it is shown, a person must act. */
const CAPTCHA_SELECTOR = ".frc-captcha, .frc-widget-placeholder, [data-sitekey]";
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

  /** Kind: method. The most recently opened tab (LuxTrust may open its own), or null if closed. */
  currentPage(): Page | null {
    const pages = this.#ctx?.pages() ?? [];
    return pages[pages.length - 1] ?? null;
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
  async assertUsable(page: Page, opts: { allowCaptcha?: boolean } = {}) {
    const url = page.url();
    if (BLOCKED_URL_RE.test(url)) throw new RcsSessionError("blocked", `LBR access limitation page: ${url}`);
    if (LOGGED_OUT_URL_RE.test(url)) throw new RcsSessionError("logged_out", `Redirected to login: ${url}`);
    const text = await page.innerText("body").catch(() => "");
    if (BLOCKED_RE.test(text)) throw new RcsSessionError("blocked", "LBR access limitation / block page detected");
    if (!opts.allowCaptcha && (await page.locator(CAPTCHA_SELECTOR).first().isVisible().catch(() => false))) {
      throw new RcsSessionError("blocked", "LBR shows an anti-robot check — solve it in the browser (`engine rcs:login`), the engine never does");
    }
  }

  /** Kind: method. A human-like pause: base delay + random jitter. */
  async pace() {
    await sleep(this.cfg.delayMs + Math.floor(Math.random() * this.cfg.jitterMs));
  }

  /**
   * Kind: method. LBR shows an anti-robot dialog ("Captcha Resolution": "Verifying…", sometimes "An error
   * occurred while validating the captcha") before search results. The engine never solves it: it waits while
   * the dialog is on screen so the PERSON at the browser can complete it, then continues once it is gone.
   * If nobody clears it within `checkWaitMs`, RCS work pauses ("blocked").
   * @param page   the page.
   * @param label  for the debug trail.
   */
  async settle(page: Page, label: string) {
    const deadline = Date.now() + this.checkWaitMs;
    let told = false;
    let clearSince = 0;
    for (;;) {
      const text = await page.innerText("body").catch(() => "");
      const dialog = /captcha resolution|r[ée]solution (du )?captcha|verifying|v[ée]rification en cours|error occurred while validating the captcha|click to start verification|i am human/i.test(text);
      // Only "cleared" when the dialog has stayed away for 3 s (it re-renders between attempts).
      if (!dialog) {
        clearSince ||= Date.now();
        if (Date.now() - clearSince >= 3_000) break;
        await sleep(500);
        continue;
      }
      clearSince = 0;
      if (!told) {
        console.log(`⏸  LBR anti-robot check on screen (${label}) — please complete it in the browser window. Waiting up to ${Math.round(this.checkWaitMs / 60_000)} min…`);
        await this.snap(page, `${label}-check`);
        told = true;
      }
      if (Date.now() > deadline) {
        await this.snap(page, `${label}-check-not-cleared`);
        throw new RcsSessionError("blocked", `LBR anti-robot check not cleared within ${Math.round(this.checkWaitMs / 60_000)} min`);
      }
      await sleep(1_000);
    }
    if (told) console.log("▶  check cleared, continuing");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  /** Kind: field. How long to wait for LBR's anti-robot check (a person at the screen may complete it). */
  checkWaitMs = Number(process.env.RCS_CHECK_WAIT_MS ?? 600_000);

  /** Kind: field. When set (rcs:test, or RCS_DEBUG_DIR), every step leaves a screenshot + page summary here. */
  debugDir: string | null = process.env.RCS_DEBUG_DIR ?? null;
  #step = 0;

  /**
   * Kind: method. Debug trail: `<n>-<label>.png` and `<n>-<label>.json` (URL, title, visible buttons / links,
   * the first part of the text) — to see exactly what LBR showed at each step without watching the screen.
   */
  async snap(page: Page, label: string) {
    if (!this.debugDir) return;
    await mkdir(this.debugDir, { recursive: true });
    const base = resolve(this.debugDir, `${String(++this.#step).padStart(2, "0")}-${label}`);
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    // Passed as a string, not a function: the TypeScript runner adds helper calls to compiled functions that do
    // not exist inside the page.
    const info = await page
      .evaluate<Record<string, unknown>>(`(() => {
        const vis = (el) => !!el.offsetParent;
        const clean = (t) => (t || "").trim().replace(/\s+/g, " ");
        const texts = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis).map((e) => clean(e.textContent)).filter(Boolean).slice(0, 60);
        return {
          title: document.title,
          buttons: texts("button, [role=button]"),
          links: Array.from(document.querySelectorAll("a")).filter(vis).map((a) => clean(a.textContent) + " → " + a.getAttribute("href")).slice(0, 80),
          inputs: Array.from(document.querySelectorAll("input, select, textarea")).filter(vis).map((i) => i.tagName.toLowerCase() + " name=" + i.getAttribute("name") + " id=" + i.id + " type=" + i.getAttribute("type") + " placeholder=" + i.getAttribute("placeholder")),
          text: document.body.innerText.slice(0, 4000),
        };
      })()`)
      .catch((err) => ({ error: String(err) }));
    await writeFile(`${base}.json`, JSON.stringify({ url: page.url(), ...info }, null, 2));
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
      await page.goto(this.cfg.entityUrlTemplate.replace("{number}", encodeURIComponent(rcs)), { waitUntil: "networkidle" });
    } else if (this.cfg.searchUrl.endsWith("=")) {
      // The portal's own search page: …/consult-search-list?search=B145917 (what a person gets by typing it).
      // "domcontentloaded", not "networkidle": the anti-robot widget keeps the network busy.
      await page.goto(this.cfg.searchUrl + encodeURIComponent(rcs), { waitUntil: "domcontentloaded", timeout: 60_000 });
      await this.assertUsable(page, { allowCaptcha: true });
      // Give the dialog a moment to appear, then wait for the person to clear it.
      await sleep(2_000);
      await this.settle(page, "search");
      // Results arrive after the check: wait (up to 30 s) for the number to appear in the list.
      await page.getByText(rcs, { exact: true }).first().waitFor({ timeout: 30_000 }).catch(() => {});
      await this.snap(page, "results");
      await this.assertUsable(page, { allowCaptcha: true });
      // Result list: select the row with exactly this number, then the portal's "Next" button.
      const hit = page.getByText(rcs, { exact: true }).first();
      if (await hit.isVisible().catch(() => false)) {
        await this.pace();
        await hit.click();
        const next = page.getByRole("button", { name: /^(next|suivant|weider|weiter)$/i }).first();
        await this.snap(page, "selected");
        if (await next.isEnabled().catch(() => false)) await next.click();
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await sleep(2_000);
        await this.settle(page, "company");
      }
      await this.snap(page, "company");
    } else {
      await page.goto(this.cfg.searchUrl, { waitUntil: "domcontentloaded" });
      await this.assertUsable(page);
      const input = page.locator(process.env.RCS_SEARCH_INPUT ?? 'input[type="search"], input[name*="rcs" i], input[id*="search" i]').first();
      await input.fill(rcs);
      await input.press("Enter");
      await page.waitForLoadState("networkidle").catch(() => {});
      await this.assertUsable(page);
      const hit = page.getByText(rcs, { exact: true }).first();
      if (await hit.isVisible().catch(() => false)) {
        await this.pace();
        await hit.click();
        await page.waitForLoadState("networkidle").catch(() => {});
      }
    }
    await this.assertUsable(page, { allowCaptcha: true });
    // Show the filings tab if it is a tab.
    const filingsTab = page.getByText(/^List of filings$/i).first();
    if (await filingsTab.isVisible().catch(() => false)) {
      await filingsTab.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await this.snap(page, "filings");
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
