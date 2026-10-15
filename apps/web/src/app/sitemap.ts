import type { MetadataRoute } from "next";
import { listProviderOptions, listPublishedPosts } from "@fundhub/db/queries";
import { siteUrl } from "@/lib/site";
import { TAXONOMY } from "@fundhub/core/taxonomy";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticPaths = [
    "",
    "/compare",
    "/services",
    "/benchmarks",
    "/advisory",
    "/rfi",
    "/news",
    "/data-intelligence",
    "/awards",
    "/methodology",
    "/independence",
    "/for-providers",
  ];
  const [providers, posts] = await Promise.all([listProviderOptions().catch(() => []), listPublishedPosts().catch(() => [])]);

  return [
    ...staticPaths.map((p) => ({ url: `${base}${p}` })),
    ...TAXONOMY.map((c) => ({ url: `${base}/services/${c.slug}` })),
    ...posts.map((p) => ({ url: `${base}/news/${p.slug}`, lastModified: p.publishedAt ?? undefined })),
    ...providers.map((p) => ({ url: `${base}/providers/${p.slug}` })),
  ];
}
