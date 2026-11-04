/**
 * FILE: services/scraper/src/config.ts
 * PART: scraper (services/scraper)
 * WHAT IT DOES: Reads the scraper's settings from environment variables (server settings, or a local .env
 *   file) and fills in sensible defaults: which Claude model to use and how hard it should think, how many
 *   pages and characters to read per website, how the crawler identifies itself, and where RCS data comes from.
 * WHERE IT RUNS: on Node.js — in GitHub Actions (scheduled runs) or on a developer's computer.
 * FRAMEWORK NOTES: "environment variables" are named text values given to a program when it starts
 *   (e.g. ANTHROPIC_MODEL=…). In Node.js they are read with `process.env.NAME`, which is undefined if unset.
 * TYPESCRIPT YOU WILL SEE HERE: side-effect import, type aliases with a union of string literals,
 *   indexed access types (`Settings["effort"]`), `??`, `as`, numeric separators (`60_000` = 60000).
 */

// Loads variables from a local .env file into `process.env` (if the file exists). Imported only for that effect.
import "dotenv/config";

/**
 * Kind: type alias (exported) — the shape of the settings object.
 * - model: the Claude model id.
 * - effort: one of five exact words (a "union of literal types"); how much reasoning Claude should spend.
 * - maxPages / maxChars: crawl limits per provider website.
 * - userAgent: the name our crawler sends to websites, with a contact address.
 * - rcsSource: "mock" (built-in sample data) or where to get RCS register data.
 */
export type Settings = {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxPages: number;
  maxChars: number;
  userAgent: string;
  rcsSource: string;
};

/**
 * Kind: function (exported).
 * Runtime configuration. The database URL is resolved by @fundhub/db
 * (DATABASE_URL; in production the dedicated `fundhub_scraper` role).
 * @returns `Settings`: a fresh settings object, built from environment variables with defaults.
 */
export function settings(): Settings {
  return {
    // `a ?? b` = use a, unless it is missing (undefined/null), then b.
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    // `as Settings["effort"]` tells TypeScript to treat the text as one of the five allowed words.
    // (`Settings["effort"]` means "the type of the effort field".) Note: it is not checked at run time.
    effort: (process.env.EXTRACTION_EFFORT as Settings["effort"]) ?? "medium",
    // `Number(...)` turns text such as "8" into the number 8.
    maxPages: Number(process.env.CRAWL_MAX_PAGES ?? 8),
    maxChars: Number(process.env.CRAWL_MAX_CHARS ?? 60_000),
    userAgent: process.env.CRAWL_USER_AGENT ?? "FundHubBot/0.1 (+https://fundhub.lu/methodology; data@fundhub.lu)",
    rcsSource: process.env.RCS_SOURCE ?? "mock",
  };
}
