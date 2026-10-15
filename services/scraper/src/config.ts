import "dotenv/config";

export type Settings = {
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxPages: number;
  maxChars: number;
  userAgent: string;
  rcsSource: string;
};

/**
 * Runtime configuration. The database URL is resolved by @fundhub/db
 * (DATABASE_URL; in production the dedicated `fundhub_scraper` role).
 */
export function settings(): Settings {
  return {
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
    effort: (process.env.EXTRACTION_EFFORT as Settings["effort"]) ?? "medium",
    maxPages: Number(process.env.CRAWL_MAX_PAGES ?? 8),
    maxChars: Number(process.env.CRAWL_MAX_CHARS ?? 60_000),
    userAgent: process.env.CRAWL_USER_AGENT ?? "FundHubBot/0.1 (+https://fundhub.lu/methodology; data@fundhub.lu)",
    rcsSource: process.env.RCS_SOURCE ?? "mock",
  };
}
