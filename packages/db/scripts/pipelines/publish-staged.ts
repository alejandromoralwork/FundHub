/**
 * Publish staged providers so they appear on the site.
 *
 *   npm run pipeline:publish                 (list staged, then publish all)
 *   npm run pipeline:publish -- some-slug    (publish specific slugs)
 *   npm run pipeline:publish -- --list       (only list what's staged)
 */
/**
 * FILE: packages/db/scripts/pipelines/publish-staged.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Lists providers whose status is "staged" (imported but hidden) and switches them to
 *   "published" so the website shows them: either all of them, or only the slugs named on the command line.
 * WHERE IT RUNS: from a developer's terminal (Node.js). Not part of the website.
 * FRAMEWORK NOTES: Drizzle ORM query builder: `db.select({...}).from(table).where(...)` becomes SQL
 *   "SELECT … FROM … WHERE …"; `db.update(table).set({...}).where(...)` becomes "UPDATE … SET … WHERE …".
 * TYPESCRIPT YOU WILL SEE HERE: async/await, array methods `.filter/.some/.map/.includes/.join`,
 *   ternary `c ? a : b`, template strings, `for … of`.
 */

// `import { a } from "b"`: bring named items from another module.
// Loads .env into process.env.
import "dotenv/config";
// Drizzle's condition helpers: and(a, b) = "a AND b"; eq(col, v) = "col = v"; inArray(col, list) = "col IN (…)".
import { and, eq, inArray } from "drizzle-orm";
// The shared database object, and the definition of the providers table.
import { db } from "../../src/client";
import { providers } from "../../src/schema";

/**
 * Kind: async function.
 * Lists staged providers, then publishes all of them or the requested ones.
 * @returns `Promise<void>`.
 */
async function main() {
  // Command-line words after the script name (see import-providers.ts for process.argv).
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  // `.filter(test)` returns a new array with only the items passing the test: here, the slugs.
  const slugs = args.filter((a) => !a.startsWith("--"));

  // SQL: SELECT slug, name, category FROM providers WHERE status = 'staged'.
  // Passing an object to select() picks only those columns and names the result fields.
  const staged = await db
    .select({ slug: providers.slug, name: providers.name, category: providers.category })
    .from(providers)
    .where(eq(providers.status, "staged"));

  // `!staged.length` = the array is empty.
  if (!staged.length) {
    console.log("No staged providers.");
    return;
  }

  console.log(`${staged.length} staged provider(s):`);
  for (const p of staged) console.log(`  • ${p.slug}  (${p.name}, ${p.category})`);
  if (listOnly) return;

  // Requested slugs that are not in the staged list (typo, or already published). `.some` = "any match?".
  const unknown = slugs.filter((s) => !staged.some((p) => p.slug === s));
  if (unknown.length) console.warn(`! Not staged, ignored: ${unknown.join(", ")}`);

  // Which slugs to publish: the requested ones that are staged, or (no slugs given) every staged one.
  // `.map(p => p.slug)` turns the list of providers into a list of their slugs.
  const target = slugs.length ? slugs.filter((s) => !unknown.includes(s)) : staged.map((p) => p.slug);
  if (!target.length) return;

  // SQL: UPDATE providers SET status = 'published', updated_at = <now>
  //      WHERE status = 'staged' AND slug IN (<target slugs>).
  // Checking status again in the WHERE makes sure we never touch a provider that is not staged.
  await db
    .update(providers)
    .set({ status: "published", updatedAt: new Date() })
    .where(and(eq(providers.status, "staged"), inArray(providers.slug, target)));

  console.log(`✔ Published ${target.length} provider(s)`);
}

// Exit 0 on success (so the open database pool does not keep the process alive), 1 on failure.
main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
