/**
 * Publish staged providers so they appear on the site.
 *
 *   npm run pipeline:publish                 (list staged, then publish all)
 *   npm run pipeline:publish -- some-slug    (publish specific slugs)
 *   npm run pipeline:publish -- --list       (only list what's staged)
 */
import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/index";
import { providers } from "@/db/schema";

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const slugs = args.filter((a) => !a.startsWith("--"));

  const staged = await db
    .select({ slug: providers.slug, name: providers.name, category: providers.category })
    .from(providers)
    .where(eq(providers.status, "staged"));

  if (!staged.length) {
    console.log("No staged providers.");
    return;
  }

  console.log(`${staged.length} staged provider(s):`);
  for (const p of staged) console.log(`  • ${p.slug}  (${p.name}, ${p.category})`);
  if (listOnly) return;

  const unknown = slugs.filter((s) => !staged.some((p) => p.slug === s));
  if (unknown.length) console.warn(`! Not staged, ignored: ${unknown.join(", ")}`);

  const target = slugs.length ? slugs.filter((s) => !unknown.includes(s)) : staged.map((p) => p.slug);
  if (!target.length) return;

  await db
    .update(providers)
    .set({ status: "published", updatedAt: sql`(unixepoch())` })
    .where(and(eq(providers.status, "staged"), inArray(providers.slug, target)));

  console.log(`✔ Published ${target.length} provider(s)`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
