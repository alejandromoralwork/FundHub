/**
 * FILE: packages/engine-db/src/jobs-catalog.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: The list of Scraping Engine jobs as DATA: name, worker group, what it does, its parameters and
 *   its default schedule. The engine (services/engine/src/jobs/index.ts) attaches a handler to each entry; the
 *   admin console uses the same list to build the "Jobs" page (forms, schedules) without importing the engine
 *   itself (which needs a browser). One list → the two can never disagree.
 * WHERE IT RUNS: anywhere (plain data).
 * TYPESCRIPT YOU WILL SEE HERE: `as const satisfies`, discriminated param kinds.
 */

/** Kind: type alias. One parameter of a job, for the console's form. */
export type JobParam = {
  name: string;
  kind: "string" | "number" | "boolean" | "list";
  label: string;
  placeholder?: string;
  required?: boolean;
};

/** Kind: type alias. One job as data. */
export type JobInfo = {
  group: "cssf" | "gleif" | "rcs" | "web" | "news" | "maintenance";
  title: string;
  description: string;
  params: JobParam[];
  /** Default cron (Europe/Luxembourg) and data; omitted = on demand only. */
  schedule?: { cron: string; data?: Record<string, unknown> };
};

/** Kind: constant. Every job. */
export const JOB_CATALOG = {
  cssf_census: {
    group: "cssf",
    title: "CSSF census",
    description: "Lists every CSSF entity type (exact totals), queues detail fetches for new/due entities, marks withdrawn ones gone.",
    params: [
      { name: "types", kind: "list", label: "Entity types", placeholder: "SPP,SUP (empty = all)" },
      { name: "all", kind: "boolean", label: "Re-fetch every entity" },
      { name: "limit", kind: "number", label: "Limit per type (testing)" },
    ],
    schedule: { cron: "0 2 * * 0" },
  },
  cssf_fetch: { group: "cssf", title: "CSSF entity", description: "Fetches one CSSF entity by its internal id.", params: [{ name: "id", kind: "string", label: "CSSF entity id", placeholder: "7013419", required: true }] },
  cssf_refresh: { group: "maintenance", title: "CSSF refresh due", description: "Queues CSSF entities whose refresh date passed.", params: [{ name: "limit", kind: "number", label: "Limit" }], schedule: { cron: "0 3 * * *" } },
  gleif_sync: {
    group: "gleif",
    title: "GLEIF sync",
    description: "Luxembourg LEI records (with RCS numbers). Delta since last sync; 'full' reloads all ~73k.",
    params: [
      { name: "full", kind: "boolean", label: "Full load" },
      { name: "since", kind: "string", label: "Since (ISO date)", placeholder: "2026-10-01" },
      { name: "limit", kind: "number", label: "Limit (testing)" },
    ],
    schedule: { cron: "0 4 * * *" },
  },
  gleif_fetch: { group: "gleif", title: "GLEIF record", description: "Fetches one LEI record.", params: [{ name: "lei", kind: "string", label: "LEI", required: true }] },
  rcs_fetch: { group: "rcs", title: "RCS company", description: "Opens one company page in the logged-in LBR browser (paced, capped).", params: [{ name: "rcs", kind: "string", label: "RCS number", placeholder: "B145917", required: true }] },
  rcs_frontier: {
    group: "rcs",
    title: "RCS new registrations",
    description: "Probes numbers above the highest known one until N consecutive misses.",
    params: [
      { name: "prefix", kind: "string", label: "Prefix", placeholder: "B" },
      { name: "from", kind: "number", label: "Start from number" },
    ],
    schedule: { cron: "15 8 * * *", data: { prefix: "B" } },
  },
  rcs_sweep: {
    group: "rcs",
    title: "RCS backfill sweep",
    description: "Walks 1…max_known in batches, skipping known numbers; chains itself.",
    params: [
      { name: "prefix", kind: "string", label: "Prefix", placeholder: "B" },
      { name: "batch", kind: "number", label: "Batch size", placeholder: "200" },
    ],
    schedule: { cron: "0 10 * * *", data: { prefix: "B" } },
  },
  rcs_seed_frontier: { group: "maintenance", title: "RCS seed frontier", description: "Sets each prefix's max known number from every source and writes the 'rcs:known' census.", params: [], schedule: { cron: "0 6 * * *" } },
  rcs_import_file: {
    group: "maintenance",
    title: "Import LBR extract",
    description: "Imports an official LBR extract (CSV) as the 'lbr_bulk' source. The file path is on the worker's machine.",
    params: [
      { name: "file", kind: "string", label: "File path on worker", required: true },
      { name: "map", kind: "string", label: "Column map", placeholder: "rcs=Numéro RCS,name=Dénomination" },
      { name: "limit", kind: "number", label: "Limit rows" },
    ],
  },
  rcs_refresh: { group: "maintenance", title: "RCS refresh queue", description: "Queues known-but-unfetched numbers (highest tier first), then due records, within the daily cap.", params: [{ name: "limit", kind: "number", label: "Limit" }], schedule: { cron: "30 7 * * *" } },
  reclassify: { group: "maintenance", title: "Reclassify", description: "Re-applies classification rules to every company and links clients to companies.", params: [], schedule: { cron: "0 5 * * 0" } },
  census_snapshot: { group: "maintenance", title: "Census snapshot", description: "Writes today's registry census.", params: [], schedule: { cron: "30 23 * * *" } },
  // ---- FundHub accounts, company websites (group "web")
  fundhub_sync: {
    group: "web",
    title: "FundHub accounts sync",
    description: "Reads every FundHub listing and approved unlisted account claim (self-declared data) into the pipeline, and links companies to their listing.",
    params: [
      { name: "since", kind: "string", label: "Changed since (ISO date)", placeholder: "2026-11-01" },
      { name: "limit", kind: "number", label: "Limit (testing)" },
    ],
    schedule: { cron: "5 * * * *" },
  },
  website_crawl: {
    group: "web",
    title: "Company website crawl",
    description: "Crawls a company website and extracts facts with AI (legal notice verifies the RCS number). Without a company: queues the followed companies that are due.",
    params: [
      { name: "companyId", kind: "string", label: "Company id (empty = queue due companies)" },
      { name: "limit", kind: "number", label: "How many to queue", placeholder: "25" },
    ],
    schedule: { cron: "0 1 * * *" },
  },
  // ---- News (group "news")
  news_poll: { group: "news", title: "News feeds", description: "Reads the newspaper / press-release feeds and matches articles to the companies they mention.", params: [{ name: "feedId", kind: "number", label: "One feed id (empty = all)" }], schedule: { cron: "*/30 * * * *" } },
  news_search: {
    group: "news",
    title: "Company news search",
    description: "Searches the news for one company; without a company, queues the next batch of followed companies (tier 2, FundHub listings).",
    params: [
      { name: "companyId", kind: "string", label: "Company id (empty = next batch)" },
      { name: "limit", kind: "number", label: "Batch size", placeholder: "40" },
    ],
    schedule: { cron: "0 9 * * *" },
  },
  // ---- Pipeline (group "maintenance")
  staging_release: { group: "maintenance", title: "Release approved record", description: "Runs clean → match → core for a version approved at the staging gate (queued by the console).", params: [{ name: "parsedId", kind: "number", label: "Parsed record id", required: true }] },
  quality_run: { group: "maintenance", title: "Data quality", description: "Measures every data-quality check (coverage, cross-checking, match rate, conflicts, backlog, freshness…).", params: [], schedule: { cron: "45 23 * * *" } },
  publish_proposals: {
    group: "maintenance",
    title: "Publish proposals",
    description: "Compares golden records with their FundHub listings and writes change proposals for staff review (Publish review).",
    params: [
      { name: "limit", kind: "number", label: "Limit companies" },
      { name: "dryRun", kind: "boolean", label: "Dry run (count only)" },
    ],
    schedule: { cron: "0 7 * * *" },
  },
  reprocess: {
    group: "maintenance",
    title: "Reprocess a source",
    description: "Re-runs the pipeline for one source without re-fetching: from 'parse' (after a parser fix) or 'consolidate' (after a precedence / rules change).",
    params: [
      { name: "source", kind: "string", label: "Source code", placeholder: "cssf", required: true },
      { name: "from", kind: "string", label: "From stage", placeholder: "parse | consolidate", required: true },
      { name: "limit", kind: "number", label: "Limit records" },
    ],
  },
  retention_purge: { group: "maintenance", title: "Retention purge", description: "Deletes people data older than each source's retention limit (GDPR minimization).", params: [], schedule: { cron: "15 3 * * *" } },
} as const satisfies Record<string, JobInfo>;

export type JobName = keyof typeof JOB_CATALOG;
/** Kind: function. Type guard: is this a known job name? */
export const isJobName = (name: string): name is JobName => Object.prototype.hasOwnProperty.call(JOB_CATALOG, name);

/** Kind: constant. Key in `engine_settings` holding the list of job names whose schedule is switched off. */
export const DISABLED_SCHEDULES_KEY = "disabled_schedules";
