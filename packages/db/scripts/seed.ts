/**
 * FILE: packages/db/scripts/seed.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: "Seeding" fills a database with starter data. This script loads the provider list from
 *   data/providers.json (insert or update by slug), adds three sample RFIs (requests for information) if
 *   that table is empty, and adds News & Learn articles from data/posts.json that are not there yet.
 *   It is safe to run repeatedly.
 * WHERE IT RUNS: from a developer's terminal or a setup step (Node.js), e.g. as part of `npm run db:setup`.
 * FRAMEWORK NOTES: Drizzle ORM: `db.insert(table).values(rows)` = SQL INSERT; `.onConflictDoNothing()` =
 *   "skip rows that would break a uniqueness rule"; `.returning()` = send back the inserted rows.
 * TYPESCRIPT YOU WILL SEE HERE: `type` imports, utility types `Omit<T, "key">` (T without that property),
 *   intersection `A & B` (both shapes combined), `typeof posts.$inferInsert` (row type derived from a table),
 *   `as unknown[]` / `as const` assertions, destructuring with rest `{ a, ...rest }`, spread `{ ...obj }`,
 *   optional chaining `?.`, `??`.
 */

// `import { a } from "b"`: bring named items from another module.
// Loads .env into process.env.
import "dotenv/config";
// Reads a file and returns a Promise of its contents.
import { readFile } from "node:fs/promises";
// Drizzle helpers: count() = SQL COUNT(*) (number of rows); eq(col, v) = "col = v".
import { count, eq } from "drizzle-orm";
// The shared database object.
import { db } from "../src/client";
// Table definitions; `type NewRfiRequest` imports only a type (the shape of a row to insert into rfi_requests).
import { posts, providers, rfiRequests, type NewRfiRequest } from "../src/schema";
// Validation and insert-or-update helpers for providers.
import { providerInputSchema, toNewProvider, upsertProviders } from "../src/provider-input";

/**
 * Kind: constant (array of sample RFIs).
 * Type: `(Omit<NewRfiRequest, "providerId"> & { providerSlug: string })[]` reads as: an array of objects
 * that look like an RFI row *without* providerId, *plus* a providerSlug. We name the provider by slug
 * because database ids differ between machines; the real id is looked up when inserting.
 */
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

/**
 * Kind: async function.
 * Runs the three seeding steps in order.
 * @returns `Promise<void>`.
 */
async function main() {
  // Read data/providers.json and parse the JSON. `as unknown[]` says "an array of not-yet-checked values".
  const raw = JSON.parse(await readFile(new URL("../data/providers.json", import.meta.url), "utf8")) as unknown[];
  // Validate each record and convert it to a database row marked "published". `.map((r, i) => …)` gives
  // each item and its position; a bad record stops the whole seed with a clear message.
  const rows = raw.map((r, i) => {
    const parsed = providerInputSchema.safeParse(r);
    if (!parsed.success) throw new Error(`providers.json[${i}] invalid: ${parsed.error.message}`);
    return toNewProvider(parsed.data, "published");
  });

  // Insert new providers and update existing ones (matched by slug).
  const written = await upsertProviders(db, rows);
  console.log(`✔ Upserted ${written} providers`);

  // SQL: SELECT count(*) AS n FROM rfi_requests. The result is an array with one row; `[{ n }]` takes the
  // first row and pulls out its `n` property in one go (nested destructuring).
  const [{ n }] = await db.select({ n: count() }).from(rfiRequests);
  if (n === 0) {
    // `{ providerSlug, ...rfi }` = take providerSlug out, put all the other properties into `rfi`.
    for (const { providerSlug, ...rfi } of SAMPLE_RFIS) {
      // Find the provider's id by slug: SELECT id FROM providers WHERE slug = …
      const [p] = await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, providerSlug));
      // Insert the RFI. `{ ...rfi, providerId: … }` copies rfi's fields and adds providerId.
      // `p?.id ?? null`: the id if the provider was found, else null (an RFI not linked to any provider).
      await db.insert(rfiRequests).values({ ...rfi, providerId: p?.id ?? null });
    }
    console.log(`✔ Inserted ${SAMPLE_RFIS.length} sample RFIs`);
  } else {
    console.log(`• RFI table already has ${n} rows, skipping sample RFIs`);
  }

  // News & Learn: insert missing articles only, so edits made in the admin are never overwritten.
  // A local type alias: a row to insert into posts (`$inferInsert` is Drizzle's ready-made type for that),
  // but with publishedAt as text, because JSON has no date type.
  type SeedPost = typeof posts.$inferInsert & { publishedAt: string };
  const seedPosts = JSON.parse(await readFile(new URL("../data/posts.json", import.meta.url), "utf8")) as SeedPost[];
  // INSERT all posts; ON CONFLICT (slug) DO NOTHING skips any whose slug already exists (slug is unique);
  // RETURNING id gives back only the rows really inserted, so we can count them.
  // `"published" as const` tells TypeScript the value is exactly "published" (not just any string), which the
  // status column's allowed-values type requires. new Date(text) turns the date text into a Date.
  const inserted = await db
    .insert(posts)
    .values(seedPosts.map((p) => ({ ...p, status: "published" as const, publishedAt: new Date(p.publishedAt) })))
    .onConflictDoNothing({ target: posts.slug })
    .returning({ id: posts.id });
  console.log(`✔ Inserted ${inserted.length} new posts (${seedPosts.length - inserted.length} already present)`);
}

// Exit 0 on success (the open database pool would otherwise keep Node.js running), 1 on failure.
main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
