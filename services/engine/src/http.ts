/**
 * FILE: services/engine/src/http.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: A polite HTTP client for public APIs (CSSF, GLEIF). It keeps a minimum delay between two
 *   requests to the same host (plus random jitter), retries on 429 / 5xx / network errors with exponential
 *   backoff, honours `Retry-After`, and identifies itself with our User-Agent.
 * WHERE IT RUNS: inside engine workers. The delay is per process: run ONE worker per source queue to keep
 *   the global rate equal to the configured one.
 * TYPESCRIPT YOU WILL SEE HERE: `Map`, `async` functions, `Promise<void>`, a class with private fields.
 */

import { log } from "./log";

/** Kind: function. Waits `ms` milliseconds. */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Kind: type alias. The bytes and metadata of one HTTP response. */
export type HttpResult = { url: string; status: number; contentType: string | null; body: Buffer };

/** Kind: class. Per-host polite fetching. One instance per process is enough. */
export class PoliteHttp {
  /** host → earliest time (ms since epoch) the next request may start. */
  #nextSlot = new Map<string, number>();

  constructor(
    private userAgent: string,
    private retries = 4,
  ) {}

  /**
   * Kind: method. Waits for the host's slot, then reserves the next one.
   * @param host     type `string`.
   * @param delayMs  type `number` — minimum gap between requests to this host.
   */
  async #throttle(host: string, delayMs: number) {
    const now = Date.now();
    const slot = Math.max(now, this.#nextSlot.get(host) ?? 0);
    this.#nextSlot.set(host, slot + delayMs + Math.floor(Math.random() * delayMs * 0.3));
    if (slot > now) await sleep(slot - now);
  }

  /**
   * Kind: method. GET a URL politely.
   * @param url      type `string`.
   * @param opts     `delayMs` per host; `accept` header; `okStatuses` that are not errors (e.g. 404 = "not found").
   * @returns `Promise<HttpResult>`.
   * @throws  after the last retry, or at once for 4xx statuses not listed in okStatuses (except 429).
   */
  async get(url: string, opts: { delayMs: number; accept?: string; okStatuses?: number[] }): Promise<HttpResult> {
    const host = new URL(url).host;
    let attempt = 0;
    for (;;) {
      await this.#throttle(host, opts.delayMs);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": this.userAgent, Accept: opts.accept ?? "application/json" },
          signal: AbortSignal.timeout(60_000),
        });
        const ok = res.ok || (opts.okStatuses ?? []).includes(res.status);
        if (ok) return { url, status: res.status, contentType: res.headers.get("content-type"), body: Buffer.from(await res.arrayBuffer()) };
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= this.retries) throw new Error(`HTTP ${res.status} for ${url}`);
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 2000;
        log.warn("http retry", { url, status: res.status, waitMs: wait });
        await sleep(wait);
      } catch (err) {
        // Network errors / timeouts are retried like 5xx; our own "HTTP xxx" errors are rethrown above.
        if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
        // Network outages get more patience than HTTP errors: up to ~8 minutes in total.
        if (attempt >= this.retries + 3) throw err;
        log.warn("http network retry", { url, error: String(err) });
        await sleep(Math.min(2 ** attempt * 2000, 120_000));
      }
      attempt++;
    }
  }

  /**
   * Kind: method. GET and parse JSON.
   * @returns `Promise<{ json: T; raw: HttpResult }>` — the parsed value and the raw bytes (for storage).
   */
  async getJson<T>(url: string, opts: { delayMs: number; okStatuses?: number[] }): Promise<{ json: T | null; raw: HttpResult }> {
    const raw = await this.get(url, { ...opts, accept: "application/json" });
    const text = raw.body.toString("utf8");
    return { json: raw.status >= 400 || !text ? null : (JSON.parse(text) as T), raw };
  }
}
