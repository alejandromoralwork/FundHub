import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type Column, type SQL } from "drizzle-orm";
import { db } from "./client";
import { posts, providers, rfiRequests, type Provider } from "./schema";
import { SCALE_BANDS, type ProviderFilters } from "@fundhub/core/filters";
import { computeScores, type ProviderScore } from "@fundhub/core/score";
import { CATEGORY_SLUGS, type CategorySlug } from "@fundhub/core/taxonomy";

const published = eq(providers.status, "published");

/** A Postgres text[] literal from bound parameters (drizzle expands a bare JS array into a record). */
function textArray(values: string[]): SQL {
  return sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

/** True when the JSON array column contains any of the given values. */
function jsonArrayHasAny(column: Column, values: string[]): SQL {
  return sql`${column} ?| ${textArray(values)}`;
}

/** Primary category, or listed as a secondary category. */
function inCategory(slug: CategorySlug): SQL {
  return or(eq(providers.category, slug), jsonArrayHasAny(providers.secondaryCategories, [slug]))!;
}

function buildWhere(f: ProviderFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [published];

  if (f.q) {
    const term = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
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
  if (f.category) conditions.push(inCategory(f.category));
  if (f.service.length) conditions.push(jsonArrayHasAny(providers.services, f.service));
  if (f.asset.length) conditions.push(jsonArrayHasAny(providers.assetClasses, f.asset));
  if (f.licence.length) conditions.push(jsonArrayHasAny(providers.licences, f.licence));
  if (f.scale) {
    const band = SCALE_BANDS[f.scale];
    conditions.push(gte(providers.headcount, band.min), lte(providers.headcount, band.max));
  }
  if (f.type.length) conditions.push(inArray(providers.providerType, f.type));
  if (f.stack.length) conditions.push(jsonArrayHasAny(providers.techStack, f.stack));
  if (f.reg.length) conditions.push(jsonArrayHasAny(providers.regulatoryScope, f.reg));

  // Price bounds: keep providers whose range overlaps [min, max].
  let { min, max } = f;
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  if (min !== undefined) conditions.push(gte(providers.priceMax, min));
  if (max !== undefined) conditions.push(lte(providers.priceMin, max));

  if (f.density) conditions.push(gte(providers.mandates, f.density));

  return and(...conditions);
}

// ---------------------------------------------------------------- FundHub Score

export type ScoredProvider = Provider & { score: ProviderScore };

let scoreCache: { at: number; map: Map<number, ProviderScore> } | null = null;
const SCORE_TTL_MS = 60_000;

/** FundHub Scores for every published provider (prices are compared within the whole category). */
export async function getScores(): Promise<Map<number, ProviderScore>> {
  if (scoreCache && Date.now() - scoreCache.at < SCORE_TTL_MS) return scoreCache.map;
  const rows = await db
    .select({
      id: providers.id,
      category: providers.category,
      priceMin: providers.priceMin,
      priceMax: providers.priceMax,
      rating: providers.rating,
      reviewCount: providers.reviewCount,
      verified: providers.verified,
      licences: providers.licences,
      certifications: providers.certifications,
      lastVerifiedAt: providers.lastVerifiedAt,
      providerUpdatedAt: providers.providerUpdatedAt,
    })
    .from(providers)
    .where(published);
  scoreCache = { at: Date.now(), map: computeScores(rows) };
  return scoreCache.map;
}

const NO_SCORE: ProviderScore = { fundhub: 0, grade: "D", quality: 0, price: null, peer: 0, credibility: 0, provisional: true };

export async function withScores(rows: Provider[]): Promise<ScoredProvider[]> {
  const scores = await getScores();
  return rows.map((p) => ({ ...p, score: scores.get(p.id) ?? NO_SCORE }));
}

const byScore = (key: "fundhub" | "quality" | "price") => (a: ScoredProvider, b: ScoredProvider) =>
  (b.score[key] ?? -1) - (a.score[key] ?? -1) || b.reviewCount - a.reviewCount;

export async function searchProviders(f: ProviderFilters): Promise<ScoredProvider[]> {
  const orderBy =
    f.sort === "fee"
      ? [asc(providers.priceMin), desc(providers.rating)]
      : f.sort === "headcount"
        ? [desc(providers.headcount)]
        : [desc(providers.rating), desc(providers.reviewCount)];

  const rows = await withScores(
    await db
      .select()
      .from(providers)
      .where(buildWhere(f))
      .orderBy(...orderBy)
      .limit(500),
  );
  if (f.sort === "score" || f.sort === "quality" || f.sort === "price") rows.sort(byScore(f.sort === "score" ? "fundhub" : f.sort));
  return rows.slice(0, 200);
}

/** Top providers per category by FundHub Score, plus the best-value pick (Price Score among Quality ≥ 60). */
export async function getCategoryRankings(perCategory = 5) {
  const rows = await withScores(await db.select().from(providers).where(published));
  return CATEGORY_SLUGS.map((category) => {
    const inCat = rows.filter((p) => p.category === category);
    const top = [...inCat].sort(byScore("fundhub")).slice(0, perCategory);
    const bestValue = inCat.filter((p) => p.score.price !== null && p.score.quality >= 60).sort(byScore("price"))[0] ?? null;
    return { category, providers: inCat.length, top, bestValue };
  }).filter((c) => c.providers > 0);
}

export async function getProviderBySlug(slug: string): Promise<ScoredProvider | undefined> {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.slug, slug), published))
    .limit(1);
  return row && (await withScores([row]))[0];
}

export async function getProviderById(id: number): Promise<Provider | undefined> {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), published))
    .limit(1);
  return row;
}

export async function listProviderOptions() {
  return db
    .select({ id: providers.id, slug: providers.slug, name: providers.name })
    .from(providers)
    .where(published)
    .orderBy(asc(providers.name));
}

export async function getSimilarProviders(p: Provider, limit = 3): Promise<ScoredProvider[]> {
  // Same category first, ranked by how many services overlap, then by score.
  const overlap = p.services.length
    ? sql<number>`(select count(*) from jsonb_array_elements_text(${providers.services}) as s(v) where s.v = any(${textArray(p.services)}))`
    : sql<number>`0`;
  return db
    .select()
    .from(providers)
    .where(and(published, inCategory(p.category), sql`${providers.id} <> ${p.id}`))
    .orderBy(desc(overlap), desc(providers.rating))
    .limit(limit)
    .then(withScores);
}

/** Highest FundHub Scores among verified providers (home page). */
export async function getTopRatedProviders(limit = 4): Promise<ScoredProvider[]> {
  const rows = await withScores(await db.select().from(providers).where(and(published, eq(providers.verified, true))));
  return rows.sort(byScore("fundhub")).slice(0, limit);
}

export async function getCategoryCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ category: providers.category, n: count() })
    .from(providers)
    .where(published)
    .groupBy(providers.category);
  return Object.fromEntries(rows.map((r) => [r.category, r.n]));
}

export async function getProviderTypeCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ type: providers.providerType, n: count() })
    .from(providers)
    .where(published)
    .groupBy(providers.providerType);
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

export type EcosystemStats = {
  indexedProviders: number;
  verifiedProviders: number;
  activeRfis: number;
  marketAvgMidpoint: number;
};

export async function getEcosystemStats(): Promise<EcosystemStats> {
  const [[p], [r]] = await Promise.all([
    db
      .select({
        total: count(),
        verified: sql<number>`coalesce(sum(case when ${providers.verified} then 1 else 0 end), 0)::int`,
        avgMid: sql<number>`coalesce(avg((${providers.priceMin} + ${providers.priceMax}) / 2.0), 0)`,
      })
      .from(providers)
      .where(published),
    db
      .select({ n: count() })
      .from(rfiRequests)
      .where(and(eq(rfiRequests.status, "open"), eq(rfiRequests.requestType, "rfi"))),
  ]);

  return {
    indexedProviders: p.total,
    verifiedProviders: Number(p.verified),
    activeRfis: r.n,
    marketAvgMidpoint: Number(p.avgMid),
  };
}

export type CategoryBenchmark = {
  category: string;
  providers: number;
  lowestMin: number;
  avgMin: number;
  avgMax: number;
  highestMax: number;
  avgRating: number;
};

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

  const order = (c: string) => CATEGORY_SLUGS.indexOf(c as CategorySlug);
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

export async function countRfisForProvider(providerId: number): Promise<number> {
  const [row] = await db.select({ n: count() }).from(rfiRequests).where(eq(rfiRequests.providerId, providerId));
  return row.n;
}

// ---------------------------------------------------------------- data intelligence

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
async function jsonValueCounts(column: Column, total: number) {
  const rows = await db
    .select({ label: sql<string>`v.value`, n: count() })
    .from(sql`${providers} cross join lateral jsonb_array_elements_text(${column}) as v(value)`)
    .where(published)
    .groupBy(sql`v.value`)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: r.label, count: r.n, share: total ? r.n / total : 0 }));
}

export async function getMarketStats(): Promise<MarketStats> {
  const [stats, byCategory, byType] = await Promise.all([
    getEcosystemStats(),
    getFeeBenchmarks(),
    getFeeBenchmarksByType(),
  ]);
  const total = stats.indexedProviders;
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
export async function getPeerScoreLeaders(): Promise<Provider[]> {
  const rows = await db
    .select()
    .from(providers)
    .where(and(published, eq(providers.verified, true)))
    .orderBy(desc(providers.rating), desc(providers.reviewCount));
  const seen = new Set<string>();
  return rows.filter((p) => !seen.has(p.category) && seen.add(p.category));
}

// ---------------------------------------------------------------- news & learn

export async function listPublishedPosts(opts: { kind?: "news" | "learn"; category?: string; limit?: number } = {}) {
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
    .where(
      and(
        eq(posts.status, "published"),
        opts.kind ? eq(posts.kind, opts.kind) : undefined,
        opts.category ? eq(posts.category, opts.category) : undefined,
      ),
    )
    .orderBy(desc(posts.publishedAt));
  return opts.limit ? q.limit(opts.limit) : q;
}

export async function getPublishedPost(slug: string) {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), eq(posts.status, "published")))
    .limit(1);
  return row;
}
