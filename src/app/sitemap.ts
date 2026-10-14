import type { MetadataRoute } from "next";
import { INSIGHTS } from "@/content/insights";
import { listProviderOptions } from "@/db/queries";
import { siteUrl } from "@/lib/site";
import { TAXONOMY } from "@/lib/taxonomy";

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
    "/insights",
    "/methodology",
    "/independence",
    "/for-providers",
  ];
  const providers = await listProviderOptions().catch(() => []);

  return [
    ...staticPaths.map((p) => ({ url: `${base}${p}` })),
    ...TAXONOMY.map((c) => ({ url: `${base}/services/${c.slug}` })),
    ...INSIGHTS.map((i) => ({ url: `${base}/insights/${i.slug}`, lastModified: i.published })),
    ...providers.map((p) => ({ url: `${base}/providers/${p.slug}` })),
  ];
}
