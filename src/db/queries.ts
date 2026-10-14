import "server-only";
import { and, asc, count, desc, eq, gte, inArray, like, lte, or, sql, type Column, type SQL } from "drizzle-orm";
import { db } from "./index";
import { providers, rfiRequests, type Provider } from "./schema";
import { SCALE_BANDS, type ProviderFilters } from "@/lib/filters";
import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/taxonomy";

const published = eq(providers.status, "published");

/** True when the JSON array column contains any of the given values. */
function jsonArrayHasAny(column: Column, values: string[]): SQL {
  return sql`exists (select 1 from json_each(${column}) where json_each.value in ${values})`;
}

/** Primary category, or listed as a secondary category. */
function inCategory(slug: CategorySlug): SQL {
  return or(eq(providers.category, slug), jsonArrayHasAny(providers.secondaryCategories, [slug]))!;
}

function buildWhere(f: ProviderFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [published];

  if (f.q) {
    const term = `%${f.q.toLowerCase()}%`;
    conditions.push(
      or(
        like(sql`lower(${providers.name})`, term),
        like(sql`lower(${providers.description})`, term),
        like(sql`lower(${providers.techStack})`, term),
        like(sql`lower(${providers.regulatoryScope})`, term),
        like(sql`lower(${providers.services})`, term),
        like(sql`lower(${providers.tags})`, term),
        like(sql`lower(${providers.category})`, term),
        like(sql`lower(${providers.assetClasses})`, term),
        like(sql`lower(${providers.licences})`, term),
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

export async function searchProviders(f: ProviderFilters): Promise<Provider[]> {
  const orderBy =
    f.sort === "fee"
      ? [asc(providers.priceMin), desc(providers.rating)]
      : f.sort === "headcount"
        ? [desc(providers.headcount)]
        : [desc(providers.rating), desc(providers.reviewCount)];

  return db
    .select()
    .from(providers)
    .where(buildWhere(f))
    .orderBy(...orderBy)
    .limit(200);
}

export async function getProviderBySlug(slug: string): Promise<Provider | undefined> {
  const [row] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.slug, slug), published))
    .limit(1);
  return row;
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

export async function getSimilarProviders(p: Provider, limit = 3): Promise<Provider[]> {
  // Same category first, ranked by how many services overlap, then by score.
  const overlap = p.services.length
    ? sql<number>`(select count(*) from json_each(${providers.services}) where json_each.value in ${p.services})`
    : sql<number>`0`;
  return db
    .select()
    .from(providers)
    .where(and(published, inCategory(p.category), sql`${providers.id} <> ${p.id}`))
    .orderBy(desc(overlap), desc(providers.rating))
    .limit(limit);
}

export async function getTopRatedProviders(limit = 4): Promise<Provider[]> {
  return db
    .select()
    .from(providers)
    .where(and(published, eq(providers.verified, true)))
    .orderBy(desc(providers.rating), desc(providers.reviewCount))
    .limit(limit);
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
        verified: sql<number>`coalesce(sum(case when ${providers.verified} then 1 else 0 end), 0)`,
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
