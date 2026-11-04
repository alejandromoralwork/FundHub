/**
 * FILE: packages/engine-db/scripts/seed.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Loads the engine's reference data: the activity category tree (the 8 website categories from
 *   packages/core/src/taxonomy.ts with their services as subcategories, plus the extra roots in
 *   src/seed-data.ts), the classification rules and the RCS prefixes. Idempotent: re-running updates rows.
 * WHERE IT RUNS: from the command line (`npm run engine:db:seed`) and at container start.
 * TYPESCRIPT YOU WILL SEE HERE: `for…of` loops, `Map`, `await` inside loops, `onConflictDoUpdate` (upsert).
 */

import "dotenv/config";
import { TAXONOMY } from "@fundhub/core/taxonomy";
import { db, pool } from "../src/client";
import { activityCategories, classificationRules, rcsNumberSpace } from "../src/schema";
import { EXTRA_CATEGORIES, RCS_PREFIXES, RULES, subSlug, type CategorySeed } from "../src/seed-data";

/**
 * Kind: async function. Upserts one category row.
 * @returns `Promise<number>`: the row id.
 */
async function upsertCategory(row: { slug: string; label: string; parentId: number | null; level: number; serviceProvider: boolean; sort: number }) {
  const [r] = await db
    .insert(activityCategories)
    .values(row)
    .onConflictDoUpdate({ target: activityCategories.slug, set: { label: row.label, parentId: row.parentId, level: row.level, serviceProvider: row.serviceProvider, sort: row.sort } })
    .returning({ id: activityCategories.id });
  return r.id;
}

async function main() {
  // Website categories first (service providers), then the extra roots.
  const roots: CategorySeed[] = [
    ...TAXONOMY.map((c) => ({ slug: c.slug, label: c.label, serviceProvider: true, subs: c.services.map((s) => ({ slug: subSlug(c.slug, s), label: s })) })),
    ...EXTRA_CATEGORIES,
  ];
  const ids = new Map<string, number>();
  let sort = 0;
  for (const root of roots) {
    const rootId = await upsertCategory({ slug: root.slug, label: root.label, parentId: null, level: 1, serviceProvider: root.serviceProvider, sort: sort++ });
    ids.set(root.slug, rootId);
    let subSort = 0;
    for (const sub of root.subs) {
      ids.set(sub.slug, await upsertCategory({ slug: sub.slug, label: sub.label, parentId: rootId, level: 2, serviceProvider: root.serviceProvider, sort: subSort++ }));
    }
  }

  // Rules: resolve slugs to ids; an unknown slug is a typo in seed-data.ts, so stop loudly.
  const idOf = (slug?: string) => {
    if (!slug) return null;
    const id = ids.get(slug);
    if (!id) throw new Error(`seed-data.ts: unknown category slug "${slug}"`);
    return id;
  };
  for (const r of RULES) {
    const row = {
      kind: r.kind,
      match: r.match,
      isServiceProvider: r.isServiceProvider ?? null,
      entityKind: r.entityKind ?? null,
      categoryId: idOf(r.category),
      subcategoryId: idOf(r.subcategory),
      tier: r.tier ?? null,
      priority: r.priority,
      note: r.note ?? null,
    };
    await db.insert(classificationRules).values(row).onConflictDoUpdate({ target: [classificationRules.kind, classificationRules.match], set: row });
  }

  // RCS prefixes: keep progress counters, only refresh label / enabled.
  for (const p of RCS_PREFIXES) {
    await db.insert(rcsNumberSpace).values(p).onConflictDoUpdate({ target: rcsNumberSpace.prefix, set: { label: p.label, enabled: p.enabled } });
  }

  console.log(`✔ Engine seed: ${ids.size} categories, ${RULES.length} rules, ${RCS_PREFIXES.length} RCS prefixes`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
