import "server-only";
/**
 * FILE: packages/db/src/queries.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: The main read-only database queries the public website uses: searching and filtering
 *   providers, attaching each provider's FundHub Score, category rankings, single provider pages, similar
 *   providers, counts and fee benchmarks, market statistics (Data Intelligence), award leaders, and the
 *   News & Learn articles. Only providers with status "published" are ever returned.
 * WHERE IT RUNS: on the server only. `import "server-only"` (first line) makes the Next.js build fail if
 *   code meant for the browser imports this file, so database access never leaks to the browser.
 * FRAMEWORK NOTES: Drizzle ORM builds SQL from chained calls:
 *   `db.select({...}).from(t).where(cond).groupBy(col).orderBy(desc(col)).limit(n)` becomes
 *   SELECT … FROM t WHERE … GROUP BY … ORDER BY … DESC LIMIT n. Where Drizzle has no helper we write raw
 *   SQL with the `sql`…`` tag; every `${value}` inside becomes a safe numbered placeholder ($1, $2…), and
 *   `${column}` becomes the quoted column name. Several provider fields (services, licences, techStack…)
 *   are stored as JSON arrays in "jsonb" columns (Postgres's binary JSON type), which need special operators.
 * TYPESCRIPT YOU WILL SEE HERE: `type` imports, return types like `SQL | undefined` and
 *   `Promise<Map<number, ProviderScore>>`, intersection types `A & { score: … }`, generics `sql<number>`,
 *   non-null assertion `!`, arrow functions returning arrow functions, ternaries, `||`/`??`, spread
 *   `{ ...p }` / `[...arr]` / `and(...conditions)`, array destructuring swaps `[a, b] = [b, a]`,
 *   `Promise.all`, `Awaited<ReturnType<typeof f>>`, `Set`, `Map`, `Record<string, number>`.
 */

// `import { a } from "b"`: bring named items from another module. drizzle-orm is an npm library;
// `@fundhub/core/…` are our own shared package (packages/core); "./…" are files in this folder.
// Drizzle helpers. Conditions: and/or, eq (=), gte (>=), lte (<=), ilike (case-insensitive text match),
// inArray (IN (…)). Sorting: asc/desc. count() = COUNT(*). sql = raw SQL. `type Column`/`type SQL` are
// only types: "a table column" and "a piece of SQL".
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type Column, type SQL } from "drizzle-orm";
// The shared database object.
import { db } from "./client";
// Table definitions, and `Provider` = the type of one row read from the providers table.
import { posts, providers, rfiRequests, type Provider } from "./schema";
// Headcount bands for the "scale" filter, and the type describing all search filters.
import { SCALE_BANDS, type ProviderFilters } from "@fundhub/core/filters";
// The FundHub Score calculation (pure maths, no database) and its result type.
import { computeScores, type ProviderScore } from "@fundhub/core/score";
// The official ordered list of category slugs and the type "one of those slugs".
import { CATEGORY_SLUGS, type CategorySlug } from "@fundhub/core/taxonomy";

/**
 * Kind: constant (a reusable SQL condition): "status = 'published'". Added to almost every query below so
 * staged or hidden providers never reach the public site.
 */
const published = eq(providers.status, "published");

/** A Postgres text[] literal from bound parameters (drizzle expands a bare JS array into a record). */
/**
 * Kind: function.
 * Builds the SQL `array[$1, $2, …]::text[]`: a Postgres array of texts. `::text[]` is Postgres's "cast"
 * syntax ("treat this as type text[]"). Each value becomes its own safe placeholder: `values.map(v => sql`${v}`)`
 * makes one SQL piece per value and `sql.join(pieces, sql`, `)` glues them with commas.
 * @param values  type `string[]` — the texts to put in the array.
 * @returns `SQL`: a piece of SQL to embed in a bigger query.
 */
function textArray(values: string[]): SQL {
  return sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

/** True when the JSON array column contains any of the given values. */
/**
 * Kind: function.
 * Uses Postgres's jsonb operator `?|`, which means "does this JSON array contain ANY of these texts?".
 * E.g. services ?| array['Depositary Services','AML/CFT & KYC'].
 * @param column  type `Column` — a jsonb array column such as providers.services.
 * @param values  type `string[]` — the values to look for.
 * @returns `SQL`: a true/false condition for a WHERE clause.
 */
function jsonArrayHasAny(column: Column, values: string[]): SQL {
  return sql`${column} ?| ${textArray(values)}`;
}

/** Primary category, or listed as a secondary category. */
/**
 * Kind: function.
 * @param slug  type `CategorySlug` — e.g. "fund-administration".
 * @returns `SQL`: "category = slug OR secondary_categories contains slug".
 * `or(...)` is typed as possibly undefined (it returns nothing if given nothing); the `!` at the end is a
 * non-null assertion: "trust me, it is not undefined here", which is true because we pass two conditions.
 */
function inCategory(slug: CategorySlug): SQL {
  return or(eq(providers.category, slug), jsonArrayHasAny(providers.secondaryCategories, [slug]))!;
}

/**
 * Kind: function.
 * Turns the search filters chosen on the website into one SQL WHERE condition (all parts joined by AND).
 * @param f  type `ProviderFilters` — the filters from the URL: free text `q`, category, lists of services,
 *           asset classes, licences, provider types, tech stack, regulations, a headcount band, price
 *           bounds `min`/`max`, and a minimum number of mandates (`density`). Missing ones are skipped.
 * @returns `SQL | undefined`: the combined condition (the `|` means "either type").
 */
function buildWhere(f: ProviderFilters): SQL | undefined {
  // The list of conditions; always starts with "published". The type allows undefined items because
  // Drizzle's and()/or() may return undefined; and() simply ignores those.
  const conditions: (SQL | undefined)[] = [published];

  // Free-text search.
  if (f.q) {
    // ILIKE patterns treat % ("any text") and _ ("any one character") as wildcards, and \ as escape.
    // The regular expression /[\\%_]/g finds every \, % or _ typed by the user, and the arrow function puts a
    // backslash before each, so they are searched literally. Then wrap in % … % = "contains the term".
    const term = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    // Match if ANY of these columns contains the term (case-insensitive). `::text` turns JSON arrays into
    // their text form so they can be searched as text too.
    conditions.push(
      or(
        ilike(sql`${providers.name}::text`, term),
        ilike(sql`${providers.description}::text`, term),
        ilike(sql`${providers.techStack}::text`, term),
        ilike(sql`${providers.regulatoryScope}::text`, term),
        ilike(sql`${providers.services}::text`, term),
        ilike(sql`${providers.tags}::text`, term),
        ilike(sql`${providers.category}::text`, term),
        ilike(sql`${providers.assetClasses}::text`, term),
        ilike(sql`${providers.licences}::text`, term),
      ),
    );
  }
  // One line per filter: only added when the visitor chose something (`.length` 0 counts as false).
  if (f.category) conditions.push(inCategory(f.category));
  if (f.service.length) conditions.push(jsonArrayHasAny(providers.services, f.service));
  if (f.asset.length) conditions.push(jsonArrayHasAny(providers.assetClasses, f.asset));
  if (f.licence.length) conditions.push(jsonArrayHasAny(providers.licences, f.licence));
  // Company size: headcount between the band's min and max (both inclusive).
  if (f.scale) {
    const band = SCALE_BANDS[f.scale];
    conditions.push(gte(providers.headcount, band.min), lte(providers.headcount, band.max));
  }
  // provider_type IN (…the chosen types…).
  if (f.type.length) conditions.push(inArray(providers.providerType, f.type));
  if (f.stack.length) conditions.push(jsonArrayHasAny(providers.techStack, f.stack));
  if (f.reg.length) conditions.push(jsonArrayHasAny(providers.regulatoryScope, f.reg));

  // Price bounds: keep providers whose range overlaps [min, max].
  // `let { min, max } = f` copies f.min and f.max into variables we may change. If the visitor typed them the
  // wrong way round, `[min, max] = [max, min]` swaps them. Two ranges overlap when the provider's highest
  // price is at least the visitor's min and its lowest price is at most the visitor's max.
  let { min, max } = f;
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) conditions.push(gte(providers.priceMax, min));
  if (max !== undefined) conditions.push(lte(providers.priceMin, max));

  // Minimum number of active client mandates.
  if (f.density) conditions.push(gte(providers.mandates, f.density));

  // `and(...conditions)` spreads the list into separate arguments: cond1 AND cond2 AND …
  return and(...conditions);
}

// ---------------------------------------------------------------- FundHub Score

/**
 * Kind: type alias. A provider row plus its score: `A & B` (intersection) = an object with all of A's
 * fields and also B's.
 */
export type ScoredProvider = Provider & { score: ProviderScore };

/**
 * Kind: module-level variable (a simple cache).
 * Computing scores needs every published provider, so the result is kept in memory for one minute and
 * reused. `at` = when it was computed (milliseconds), `map` = provider id -> score. `| null` = "or nothing yet".
 * Note: each server instance has its own copy; it is not shared between instances.
 */
let scoreCache: { at: number; map: Map<number, ProviderScore> } | null = null;
// Cache lifetime: 60_000 ms = 60 seconds.
const SCORE_TTL_MS = 60_000;

/** FundHub Scores for every published provider (prices are compared within the whole category). */
/**
 * Kind: async function.
 * @returns `Promise<Map<number, ProviderScore>>`: a lookup from provider id to its score.
 */
export async function getScores(): Promise<Map<number, ProviderScore>> {
  // Fresh enough? Date.now() = current time in milliseconds. Return the cached map without a database trip.
  if (scoreCache && Date.now() - scoreCache.at < SCORE_TTL_MS) return scoreCache.map;
  // Read only the columns the score formula needs, for all published providers.
  const rows = await db
    .select({
      id: providers.id,
      category: providers.category,
      priceMin: providers.priceMin,
      priceMax: providers.priceMax,
      rating: providers.rating,
      reviewCount: providers.reviewCount,
      licences: providers.licences,
      certifications: providers.certifications,
      lastVerifiedAt: providers.lastVerifiedAt,
      providerUpdatedAt: providers.providerUpdatedAt,
    })
    .from(providers)
    .where(published);
  // Compute and remember.
  scoreCache = { at: Date.now(), map: computeScores(rows) };
  return scoreCache.map;
}

/**
 * Kind: constant. The score used when a provider has none (e.g. not in the cache yet): zero everywhere,
 * grade "D", and marked provisional. `price: null` = no price score available.
 */
const NO_SCORE: ProviderScore = { fundhub: 0, grade: "D", quality: 0, price: null, peer: 0, credibility: 0, provisional: true };

/**
 * Kind: async function.
 * Attaches a score to each provider row.
 * @param rows  type `Provider[]` — provider rows.
 * @returns `Promise<ScoredProvider[]>`: the same rows, each copied with `{ ...p }` and given a `score`.
 *          `scores.get(p.id) ?? NO_SCORE` = the provider's score, or NO_SCORE if it has none.
 */
export async function withScores(rows: Provider[]): Promise<ScoredProvider[]> {
  const scores = await getScores();
  return rows.map((p) => ({ ...p, score: scores.get(p.id) ?? NO_SCORE }));
}

/**
 * Kind: constant holding a function that returns a function (a "comparator factory").
 * `byScore("quality")` gives a compare function for `.sort()`: it receives two providers a and b and returns
 * a negative number if a should come first, positive if b should. `b - a` sorts highest first.
 * The key type `"fundhub" | "quality" | "price"` allows only those three texts.
 * A missing (null) score counts as -1, so it sorts last. If scores tie (difference 0, which counts as false),
 * `||` falls through to the tie-breaker: more reviews first.
 */
const byScore = (key: "fundhub" | "quality" | "price") => (a: ScoredProvider, b: ScoredProvider) =>
  (b.score[key] ?? -1) - (a.score[key] ?? -1) || b.reviewCount - a.reviewCount;

/**
 * Kind: async function.
 * The provider search used by the directory page.
 * @param f  type `ProviderFilters` — chosen filters plus `sort` ("fee", "headcount", "score", "quality",
 *           "price", or default = by rating).
 * @returns `Promise<ScoredProvider[]>`: at most 200 matching providers, with scores, in the chosen order.
 */
export async function searchProviders(f: ProviderFilters): Promise<ScoredProvider[]> {
  // Database-side ordering (nested ternaries: "if fee … else if headcount … else …"):
  // fee = cheapest first, then best rated; headcount = largest first; otherwise best rated, most reviewed.
  const orderBy =
    f.sort === "fee"
      ? [asc(providers.priceMin), desc(providers.rating)]
      : f.sort === "headcount"
        ? [desc(providers.headcount)]
        : [desc(providers.rating), desc(providers.reviewCount)];

  // SELECT * FROM providers WHERE <filters> ORDER BY … LIMIT 500, then attach scores.
  // `.orderBy(...orderBy)` spreads the array into separate arguments.
  const rows = await withScores(
    await db
      .select()
      .from(providers)
      .where(buildWhere(f))
      .orderBy(...orderBy)
      .limit(500),
  );
  // Score-based sorts cannot be done in SQL (scores are computed in TypeScript), so sort in memory.
  // `.sort()` reorders the array in place. "score" sorts by the overall "fundhub" score.
  if (f.sort === "score" || f.sort === "quality" || f.sort === "price") rows.sort(byScore(f.sort === "score" ? "fundhub" : f.sort));
  // `.slice(0, 200)` = the first 200 items.
  return rows.slice(0, 200);
}

/** Top providers per category by FundHub Score, plus the best-value pick (Price Score among Quality ≥ 60). */
/**
 * Kind: async function.
 * @param perCategory  type `number`, default 5 — how many top providers to keep per category.
 * @returns a Promise of an array, one item per category that has providers:
 *          { category, providers (how many), top (best by score), bestValue (a provider or null) }.
 */
export async function getCategoryRankings(perCategory = 5) {
  // All published providers with scores (one query; grouping is done in memory).
  const rows = await withScores(await db.select().from(providers).where(published));
  // For each category in the official order…
  return CATEGORY_SLUGS.map((category) => {
    const inCat = rows.filter((p) => p.category === category);
    // `[...inCat]` makes a copy first, because .sort() would otherwise reorder inCat itself.
    const top = [...inCat].sort(byScore("fundhub")).slice(0, perCategory);
    // Best value: among providers with a price score and quality of at least 60, the best price score.
    // `[0] ?? null` = the first one, or null if the list is empty.
    const bestValue = inCat.filter((p) => p.score.price !== null && p.score.quality >= 60).sort(byScore("price"))[0] ?? null;
    return { category, providers: inCat.length, top, bestValue };
    // …then drop categories with no providers.
  }).filter((c) => c.providers > 0);
}

/**
 * Kind: async function.
 * Looks up one published provider by its URL slug (for the provider profile page).
 * @param slug  type `string` — e.g. "lumen-fund-services-s-a".
 * @returns `Promise<ScoredProvider | undefined>`: the provider with its score, or undefined if not found.
 */
export async function getProviderBySlug(slug: string): Promise<ScoredProvider | undefined> {
  // `[row]` = the first result, or undefined. The slug column has a unique index, so the lookup is quick.
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.slug, slug), published))
    .limit(1);
  // `row && …` = only if found; then score it (withScores takes a list, so wrap in [row] and take [0]).
  return row && (await withScores([row]))[0];
}

/**
 * Kind: async function.
 * Looks up one published provider by its numeric id (primary key). No score attached.
 * @param id  type `number`.
 * @returns `Promise<Provider | undefined>`.
 */
export async function getProviderById(id: number): Promise<Provider | undefined> {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), published))
    .limit(1);
  return row;
}

/**
 * Kind: async function.
 * Id, slug and name of every published provider, A to Z, for drop-down lists in forms.
 * @returns a Promise of an array of { id, slug, name }.
 */
export async function listProviderOptions() {
  return db
    .select({ id: providers.id, slug: providers.slug, name: providers.name })
    .from(providers)
    .where(published)
    .orderBy(asc(providers.name));
}

/**
 * Kind: async function.
 * "Similar providers" shown on a profile page.
 * @param p      type `Provider` — the provider being viewed.
 * @param limit  type `number`, default 3 — how many to return.
 * @returns `Promise<ScoredProvider[]>`.
 */
export async function getSimilarProviders(p: Provider, limit = 3): Promise<ScoredProvider[]> {
  // Same category first, ranked by how many services overlap, then by score.
  // `overlap` is an SQL expression computed for each candidate row: jsonb_array_elements_text unpacks the
  // candidate's services array into rows (named s(v)); we count those equal to any of p's services.
  // `sql<number>` tells TypeScript the expression produces a number. If p has no services, just use 0.
  const overlap = p.services.length
    ? sql<number>`(select count(*) from jsonb_array_elements_text(${providers.services}) as s(v) where s.v = any(${textArray(p.services)}))`
    : sql<number>`0`;
  // Published, same category, and not p itself (`<>` = "not equal" in SQL). Most overlap first, then rating.
  // `.then(withScores)` = when the rows arrive, pass them to withScores (same as awaiting then calling it).
  return db
    .select()
    .from(providers)
    .where(and(published, inCategory(p.category), sql`${providers.id} <> ${p.id}`))
    .orderBy(desc(overlap), desc(providers.rating))
    .limit(limit)
    .then(withScores);
}

/** Highest FundHub Scores (home page). Not limited to Verified providers, since verification is paid. */
/**
 * Kind: async function.
 * @param limit  type `number`, default 4.
 * @returns `Promise<ScoredProvider[]>`: the top `limit` providers by overall score.
 */
export async function getTopRatedProviders(limit = 4): Promise<ScoredProvider[]> {
  const rows = await withScores(await db.select().from(providers).where(published));
  return rows.sort(byScore("fundhub")).slice(0, limit);
}

/**
 * Kind: async function.
 * Number of published providers per category.
 * SQL: SELECT category, count(*) AS n FROM providers WHERE status='published' GROUP BY category.
 * GROUP BY makes one result row per distinct category, and count() counts the rows in each group.
 * @returns `Promise<Record<string, number>>`: an object like { "fund-administration": 12, … }, built from
 *          [key, value] pairs with Object.fromEntries.
 */
export async function getCategoryCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ category: providers.category, n: count() })
    .from(providers)
    .where(published)
    .groupBy(providers.category);
  return Object.fromEntries(rows.map((r) => [r.category, r.n]));
}

/**
 * Kind: async function.
 * Number of published providers per provider type (same pattern as getCategoryCounts).
 * @returns `Promise<Record<string, number>>`.
 */
export async function getProviderTypeCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ type: providers.providerType, n: count() })
    .from(providers)
    .where(published)
    .groupBy(providers.providerType);
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

/**
 * Kind: type alias (the shape of an object). Headline numbers for the website: how many providers are
 * listed, how many are verified, how many RFIs are open, and the market's average mid-point fee.
 */
export type EcosystemStats = {
  indexedProviders: number;
  verifiedProviders: number;
  activeRfis: number;
  marketAvgMidpoint: number;
};

/**
 * Kind: async function.
 * @returns `Promise<EcosystemStats>`.
 */
export async function getEcosystemStats(): Promise<EcosystemStats> {
  // `Promise.all([a, b])` runs both queries at the same time and waits for both. Each query returns an
  // array with one row; `[[p], [r]]` takes the single row of each (nested array destructuring).
  const [[p], [r]] = await Promise.all([
    db
      .select({
        total: count(),
        // Count verified providers: add 1 for each verified row. coalesce(x, 0) = x, or 0 if x is NULL
        // (sum of no rows is NULL). `::int` casts the result to a whole number.
        verified: sql<number>`coalesce(sum(case when ${providers.verified} then 1 else 0 end), 0)::int`,
        // Average of each provider's mid-point fee ((min + max) / 2). Dividing by 2.0, not 2, keeps decimals.
        avgMid: sql<number>`coalesce(avg((${providers.priceMin} + ${providers.priceMax}) / 2.0), 0)`,
      })
      .from(providers)
      .where(published),
    // Open requests of type "rfi" (not advisory, data or award nominations).
    db
      .select({ n: count() })
      .from(rfiRequests)
      .where(and(eq(rfiRequests.status, "open"), eq(rfiRequests.requestType, "rfi"))),
  ]);

  // Postgres returns sums and averages as text (to avoid losing precision), hence Number(...).
  return {
    indexedProviders: p.total,
    verifiedProviders: Number(p.verified),
    activeRfis: r.n,
    marketAvgMidpoint: Number(p.avgMid),
  };
}

/**
 * Kind: type alias. Fee statistics for one category: number of providers, lowest minimum fee, average
 * minimum and maximum, highest maximum, and average rating.
 */
export type CategoryBenchmark = {
  category: string;
  providers: number;
  lowestMin: number;
  avgMin: number;
  avgMax: number;
  highestMax: number;
  avgRating: number;
};

/**
 * Kind: async function.
 * Fee benchmarks per category, using SQL's aggregate functions min/avg/max over each GROUP BY group.
 * @returns `Promise<CategoryBenchmark[]>`, in the official category order.
 */
export async function getFeeBenchmarks(): Promise<CategoryBenchmark[]> {
  const rows = await db
    .select({
      category: providers.category,
      providers: count(),
      lowestMin: sql<number>`min(${providers.priceMin})`,
      avgMin: sql<number>`avg(${providers.priceMin})`,
      avgMax: sql<number>`avg(${providers.priceMax})`,
      highestMax: sql<number>`max(${providers.priceMax})`,
      avgRating: sql<number>`avg(${providers.rating})`,
    })
    .from(providers)
    .where(published)
    .groupBy(providers.category);

  // A category's position in the official list (used for sorting). `c as CategorySlug` tells TypeScript to
  // treat the text as a category slug so indexOf accepts it.
  const order = (c: string) => CATEGORY_SLUGS.indexOf(c as CategorySlug);
  // Convert text numbers to real numbers (averages rounded to whole euros), then sort by official order.
  return rows
    .map((r) => ({
      ...r,
      lowestMin: Number(r.lowestMin),
      avgMin: Math.round(Number(r.avgMin)),
      avgMax: Math.round(Number(r.avgMax)),
      highestMax: Number(r.highestMax),
      avgRating: Number(r.avgRating),
    }))
    .sort((a, b) => order(a.category) - order(b.category));
}

/**
 * Kind: async function.
 * Average fees and headcount per provider type.
 * @returns a Promise of an array of { type, providers, avgMin, avgMax, avgHeadcount } (rounded numbers).
 *          The return type is not written out; TypeScript infers it from the code.
 */
export async function getFeeBenchmarksByType() {
  const rows = await db
    .select({
      type: providers.providerType,
      providers: count(),
      avgMin: sql<number>`avg(${providers.priceMin})`,
      avgMax: sql<number>`avg(${providers.priceMax})`,
      avgHeadcount: sql<number>`avg(${providers.headcount})`,
    })
    .from(providers)
    .where(published)
    .groupBy(providers.providerType);
  return rows.map((r) => ({
    ...r,
    avgMin: Math.round(Number(r.avgMin)),
    avgMax: Math.round(Number(r.avgMax)),
    avgHeadcount: Math.round(Number(r.avgHeadcount)),
  }));
}

/**
 * Kind: async function.
 * How many requests (of any type and status) were sent to one provider.
 * @param providerId  type `number`.
 * @returns `Promise<number>`. A COUNT query always returns exactly one row, so `row` is always there.
 */
export async function countRfisForProvider(providerId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(rfiRequests).where(eq(rfiRequests.providerId, providerId));
  return row.n;
}

// ---------------------------------------------------------------- data intelligence

/**
 * Kind: type alias. Everything the Data Intelligence page shows.
 * `byType: Awaited<ReturnType<typeof getFeeBenchmarksByType>>` = "whatever getFeeBenchmarksByType resolves
 * to": `typeof f` = the function's type, `ReturnType<…>` = what it returns (a Promise), `Awaited<…>` = the
 * value inside that Promise. This avoids writing the same shape twice.
 * `{ label: string; count: number; share: number }[]` = an array of objects with those three fields.
 */
export type MarketStats = {
  providers: number;
  verified: number;
  byCategory: CategoryBenchmark[];
  byType: Awaited<ReturnType<typeof getFeeBenchmarksByType>>;
  /** Share of providers listing each value (0–1), sorted descending. */
  techStack: { label: string; count: number; share: number }[];
  licences: { label: string; count: number; share: number }[];
  assetClasses: { label: string; count: number; share: number }[];
  /** Services most requested in RFIs. */
  demand: { label: string; count: number }[];
  rfiCount: number;
};

/** Counts how many published providers list each value of a JSON array column. */
/**
 * Kind: async function.
 * SQL idea: FROM providers CROSS JOIN LATERAL jsonb_array_elements_text(column) AS v(value)
 * "lateral" lets the function use the current provider row; it unpacks that provider's JSON array into
 * one row per item. So a provider with 3 licences produces 3 rows. Grouping by the item and counting gives
 * "how many providers list each item", most common first.
 * @param column  type `Column` — a jsonb array column such as providers.licences.
 * @param total   type `number` — total number of published providers, to compute each share.
 * @returns a Promise of an array of { label, count, share } where share is between 0 and 1.
 */
async function jsonValueCounts(column: Column, total: number) {
  const rows = await db
    .select({ label: sql<string>`v.value`, n: count() })
    .from(sql`${providers} cross join lateral jsonb_array_elements_text(${column}) as v(value)`)
    .where(published)
    .groupBy(sql`v.value`)
    .orderBy(desc(count()));
  // `total ? r.n / total : 0` avoids dividing by zero when there are no providers.
  return rows.map((r) => ({ label: r.label, count: r.n, share: total ? r.n / total : 0 }));
}

/**
 * Kind: async function.
 * Gathers all Data Intelligence numbers, running independent queries in parallel with Promise.all.
 * @returns `Promise<MarketStats>`.
 */
export async function getMarketStats(): Promise<MarketStats> {
  // First batch: headline stats and the two benchmark tables, at the same time.
  const [stats, byCategory, byType] = await Promise.all([
    getEcosystemStats(),
    getFeeBenchmarks(),
    getFeeBenchmarksByType(),
  ]);
  const total = stats.indexedProviders;
  // Second batch (needs `total`): value popularity for three columns, the 10 most requested services in
  // RFIs (same unpacking trick on rfi_requests.services_needed), and the total RFI count (`[rfis]` = its one row).
  const [techStack, licences, assetClasses, demandRows, [rfis]] = await Promise.all([
    jsonValueCounts(providers.techStack, total),
    jsonValueCounts(providers.licences, total),
    jsonValueCounts(providers.assetClasses, total),
    db
      .select({ label: sql<string>`v.value`, n: count() })
      .from(sql`${rfiRequests} cross join lateral jsonb_array_elements_text(${rfiRequests.servicesNeeded}) as v(value)`)
      .where(eq(rfiRequests.requestType, "rfi"))
      .groupBy(sql`v.value`)
      .orderBy(desc(count()))
      .limit(10),
    db.select({ n: count() }).from(rfiRequests).where(eq(rfiRequests.requestType, "rfi")),
  ]);

  // Shorthand keys: `byCategory` alone means `byCategory: byCategory`.
  return {
    providers: total,
    verified: stats.verifiedProviders,
    byCategory,
    byType,
    techStack,
    licences,
    assetClasses,
    demand: demandRows.map((r) => ({ label: r.label, count: r.n })),
    rfiCount: rfis.n,
  };
}

/** Highest peer score per category among verified providers (for the Awards page). */
/**
 * Kind: async function.
 * @returns `Promise<Provider[]>`: one provider per category, the first in rating order.
 */
export async function getPeerScoreLeaders(): Promise<Provider[]> {
  // All verified published providers, best rating first (ties: more reviews first).
  const rows = await db
    .select()
    .from(providers)
    .where(and(published, eq(providers.verified, true)))
    .orderBy(desc(providers.rating), desc(providers.reviewCount));
  // A Set is a collection without duplicates. Keep a provider only if its category was not seen yet.
  // The trick: `seen.add(x)` returns the Set itself (which counts as true), so `!seen.has(c) && seen.add(c)`
  // both tests and records the category in one expression.
  const seen = new Set<string>();
  return rows.filter((p) => !seen.has(p.category) && seen.add(p.category));
}

// ---------------------------------------------------------------- news & learn

/**
 * Kind: async function.
 * Published News & Learn articles, newest first, without the article body (for lists).
 * @param opts  type `{ kind?: "news" | "learn"; category?: string; limit?: number }`, default `{}` — every
 *              field is optional (`?`): filter by kind, by category, and cap how many to return.
 * @returns a Promise of an array of article summaries.
 */
export async function listPublishedPosts(opts: { kind?: "news" | "learn"; category?: string; limit?: number } = {}) {
  // Build the query (not run yet: a Drizzle query only runs when awaited).
  const q = db
    .select({
      slug: posts.slug,
      kind: posts.kind,
      title: posts.title,
      summary: posts.summary,
      topic: posts.topic,
      category: posts.category,
      readMinutes: posts.readMinutes,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    // and() skips undefined parts, so an unused filter simply drops out.
    .where(
      and(
        eq(posts.status, "published"),
        opts.kind ? eq(posts.kind, opts.kind) : undefined,
        opts.category ? eq(posts.category, opts.category) : undefined,
      ),
    )
    .orderBy(desc(posts.publishedAt));
  // Add LIMIT only when one was asked for. Returning the query from an async function runs it.
  return opts.limit ? q.limit(opts.limit) : q;
}

/**
 * Kind: async function.
 * One published article (all columns, including the Markdown body) by slug.
 * @param slug  type `string`.
 * @returns a Promise of the post row, or undefined if not found or not published.
 */
export async function getPublishedPost(slug: string) {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, "published")))
    .limit(1);
  return row;
}
