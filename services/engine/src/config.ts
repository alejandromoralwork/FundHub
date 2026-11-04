/**
 * FILE: services/engine/src/config.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Reads every engine setting from environment variables, with defaults that work on a laptop:
 *   storage driver and bucket, politeness delays per source, RCS browser settings, Claude model.
 *   The same image therefore runs locally, in Docker, on an Azure VM or any cloud — only the env changes.
 * WHERE IT RUNS: on Node.js, in every engine process (CLI, worker, scheduler).
 * TYPESCRIPT YOU WILL SEE HERE: type aliases, `as` casts, helper arrow functions, `??`.
 */

import "dotenv/config";

/** Kind: helper. A number from env, or the default. */
const num = (name: string, def: number) => (process.env[name] ? Number(process.env[name]) : def);
/** Kind: helper. A boolean from env ("1"/"true"), or the default. */
const bool = (name: string, def: boolean) => (process.env[name] ? ["1", "true", "yes"].includes(process.env[name]!.toLowerCase()) : def);

/** Kind: type alias. All engine settings. */
export type EngineConfig = {
  userAgent: string;
  storage:
    | { driver: "fs"; root: string }
    | { driver: "s3"; endpoint?: string; region: string; bucket: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle: boolean };
  cssf: { apiBase: string; delayMs: number; refreshDays: number };
  gleif: { apiBase: string; delayMs: number; pageSize: number };
  rcs: {
    profileDir: string;
    headless: boolean;
    delayMs: number;
    jitterMs: number;
    dailyCap: number;
    /** Hours (local time of the worker) when RCS requests may run, e.g. "8-19". */
    activeHours: [number, number];
    /** LBR search page. Ending in "=" means the RCS number is appended (the portal's own search URL). */
    searchUrl: string;
    /** Optional direct entity URL with {number} placeholder, if LBR exposes one. */
    entityUrlTemplate?: string;
    frontierMisses: number;
  };
  anthropic: { model: string };
  scheduleTz: string;
};

/**
 * Kind: function. Builds the config from the environment.
 * @returns `EngineConfig`.
 */
export function config(): EngineConfig {
  const driver = (process.env.STORAGE_DRIVER ?? "fs") as "fs" | "s3";
  const hours = (process.env.RCS_ACTIVE_HOURS ?? "7-20").split("-").map(Number) as [number, number];
  return {
    userAgent: process.env.ENGINE_USER_AGENT ?? "FundHubBot/0.2 (+https://fundhub.lu/methodology; data@fundhub.lu)",
    storage:
      driver === "s3"
        ? {
            driver,
            endpoint: process.env.S3_ENDPOINT || undefined,
            region: process.env.S3_REGION ?? "auto",
            bucket: process.env.S3_BUCKET ?? "fundhub-engine",
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: bool("S3_FORCE_PATH_STYLE", true),
          }
        : { driver, root: process.env.STORAGE_ROOT ?? ".engine-data/blobs" },
    cssf: {
      apiBase: process.env.CSSF_API_BASE ?? "https://edesk.apps.cssf.lu/search-entities-api",
      delayMs: num("CSSF_DELAY_MS", 1_000),
      refreshDays: num("CSSF_REFRESH_DAYS", 7),
    },
    gleif: {
      apiBase: process.env.GLEIF_API_BASE ?? "https://api.gleif.org/api/v1",
      delayMs: num("GLEIF_DELAY_MS", 500),
      pageSize: num("GLEIF_PAGE_SIZE", 200),
    },
    rcs: {
      profileDir: process.env.RCS_PROFILE_DIR ?? ".engine-data/rcs-profile",
      headless: bool("RCS_HEADLESS", false),
      delayMs: num("RCS_DELAY_MS", 4_000),
      jitterMs: num("RCS_JITTER_MS", 3_000),
      dailyCap: num("RCS_DAILY_CAP", 1_500),
      activeHours: hours,
      searchUrl: process.env.RCS_SEARCH_URL ?? "https://www.lbr.lu/mjrcs-web-front/consult-search-list?search=",
      entityUrlTemplate: process.env.RCS_ENTITY_URL_TEMPLATE || undefined,
      frontierMisses: num("RCS_FRONTIER_MISSES", 30),
    },
    anthropic: { model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5" },
    scheduleTz: process.env.ENGINE_TZ ?? "Europe/Luxembourg",
  };
}
