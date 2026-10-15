import "dotenv/config";
import { readFile } from "node:fs/promises";
import { count, eq } from "drizzle-orm";
import { db } from "../src/client";
import { posts, providers, rfiRequests, type NewRfiRequest } from "../src/schema";
import { providerInputSchema, toNewProvider, upsertProviders } from "../src/provider-input";

const SAMPLE_RFIS: (Omit<NewRfiRequest, "providerId"> & { providerSlug: string })[] = [
  {
    providerSlug: "lumen-fund-services-s-a",
    contactName: "Anne Lambert",
    email: "a.lambert@odyssey-capital.example",
    company: "Odyssey Capital SICAV",
    fundStructure: "RAIF",
    aumBand: "250m-1bn",
    servicesNeeded: ["Fund Accounting & NAV Calculation", "Depositary Services"],
    message: "Launching a RAIF sub-fund in Q1. Need bundled depositary-lite + central admin quote at quarterly NAV.",
  },
  {
    providerSlug: "moselle-compliance-partners",
    contactName: "Jonas Weber",
    email: "j.weber@verta.example",
    company: "Verta Ventures",
    fundStructure: "SCSp / SCS",
    aumBand: "lt-100m",
    servicesNeeded: ["AML/CFT & KYC"],
    message: "Looking to outsource MLRO function for our second vintage.",
  },
  {
    providerSlug: "clervaux-tax-partners",
    contactName: "Sofia Marques",
    email: "s.marques@ourthe-re.example",
    company: "Ourthe Real Estate",
    fundStructure: "SIF",
    aumBand: "100m-250m",
    servicesNeeded: ["Transfer Pricing Documentation", "NWT & Corporate Income Tax"],
    message: "TP documentation for four intra-group shareholder loans.",
  },
];

async function main() {
  const raw = JSON.parse(await readFile(new URL("../data/providers.json", import.meta.url), "utf8")) as unknown[];
  const rows = raw.map((r, i) => {
    const parsed = providerInputSchema.safeParse(r);
    if (!parsed.success) throw new Error(`providers.json[${i}] invalid: ${parsed.error.message}`);
    return toNewProvider(parsed.data, "published");
  });

  const written = await upsertProviders(db, rows);
  console.log(`✔ Upserted ${written} providers`);

  const [{ n }] = await db.select({ n: count() }).from(rfiRequests);
  if (n === 0) {
    for (const { providerSlug, ...rfi } of SAMPLE_RFIS) {
      const [p] = await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, providerSlug));
      await db.insert(rfiRequests).values({ ...rfi, providerId: p?.id ?? null });
    }
    console.log(`✔ Inserted ${SAMPLE_RFIS.length} sample RFIs`);
  } else {
    console.log(`• RFI table already has ${n} rows, skipping sample RFIs`);
  }

  // News & Learn: insert missing articles only, so edits made in the admin are never overwritten.
  type SeedPost = typeof posts.$inferInsert & { publishedAt: string };
  const seedPosts = JSON.parse(await readFile(new URL("../data/posts.json", import.meta.url), "utf8")) as SeedPost[];
  const inserted = await db
    .insert(posts)
    .values(seedPosts.map((p) => ({ ...p, status: "published" as const, publishedAt: new Date(p.publishedAt) })))
    .onConflictDoNothing({ target: posts.slug })
    .returning({ id: posts.id });
  console.log(`✔ Inserted ${inserted.length} new posts (${seedPosts.length - inserted.length} already present)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
