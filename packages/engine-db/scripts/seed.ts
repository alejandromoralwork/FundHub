/**
 * FILE: packages/engine-db/scripts/seed.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Loads the Intelligence DB's reference data: the activity category tree (the 8 website
 *   categories from packages/core/src/taxonomy.ts with their services as subcategories, plus the extra roots in
 *   src/seed-data.ts), the classification rules, the RCS prefixes, and pipeline control: the source registry,
 *   attribute precedence, staging review policies, news feeds and quality checks.
 *   Idempotent: re-running updates descriptions but keeps what staff changed in the console (enabled flags,
 *   policies, precedence) — only rows that do not exist yet are created for those.
 * WHERE IT RUNS: from the command line (`npm run engine:db:seed`) and at container start.
 * TYPESCRIPT YOU WILL SEE HERE: `for…of` loops, `Map`, `await` inside loops, `onConflictDoUpdate` (upsert).
 */

import "dotenv/config";
import { TAXONOMY } from "@fundhub/core/taxonomy";
import { db, pool } from "../src/client";
import { activityCategories, attributePrecedence, classificationRules, lbrNumberSpace, mandateRoles, newsFeeds, qualityChecks, reviewPolicies, sources } from "../src/schema";
import { EXTRA_CATEGORIES, MANDATE_ROLE_SEED, NEWS_FEEDS, PRECEDENCE, QUALITY_CHECKS, RCS_PREFIXES, REVIEW_POLICIES, RULES, SOURCES, subSlug, type CategorySeed } from "../src/seed-data";

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
      companyKind: r.companyKind ?? null,
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
    await db.insert(lbrNumberSpace).values(p).onConflictDoUpdate({ target: lbrNumberSpace.prefix, set: { label: p.label } });
  }

  // Source registry: descriptive fields follow this file; `enabled` and limits stay as staff set them.
  let sourceSort = 0;
  for (const s of SOURCES) {
    const row = { ...s, sort: sourceSort++ };
    await db
      .insert(sources)
      .values(row)
      .onConflictDoUpdate({ target: sources.code, set: { system: s.system, name: s.name, kind: s.kind, acquisition: s.acquisition, homepage: s.homepage ?? null, description: s.description, complianceNote: s.complianceNote ?? null, sort: row.sort } });
  }

  // Precedence: "manual" first, then the listed order. Existing ranks (edited in the console) are kept.
  let precedenceRows = 0;
  for (const [attribute, list] of Object.entries(PRECEDENCE)) {
    const rows = ["manual" as const, ...list].map((source, rank) => ({ attribute, source, rank }));
    precedenceRows += rows.length;
    await db.insert(attributePrecedence).values(rows).onConflictDoNothing();
  }

  for (const p of REVIEW_POLICIES) {
    await db
      .insert(reviewPolicies)
      .values({ source: p.source, scope: p.scope ?? "*", mode: p.mode, conditions: p.conditions ?? {}, sampleRate: p.sampleRate ?? 0, note: p.note, updatedBy: "seed" })
      .onConflictDoNothing();
  }
  for (const f of NEWS_FEEDS) await db.insert(newsFeeds).values(f).onConflictDoNothing();
  // Mandate roles: new ones added; labels / flags edited by staff are kept.
  for (const [i, r] of MANDATE_ROLE_SEED.entries()) await db.insert(mandateRoles).values({ ...r, sort: i }).onConflictDoNothing();
  let qsort = 0;
  for (const q of QUALITY_CHECKS) {
    const row = { code: q.code, label: q.label, description: q.description, layer: q.layer, min: q.min ?? null, max: q.max ?? null, sort: qsort++ };
    await db.insert(qualityChecks).values(row).onConflictDoUpdate({ target: qualityChecks.code, set: { label: row.label, description: row.description, layer: row.layer, sort: row.sort } });
  }

  console.log(
    `✔ Intelligence DB seed: ${ids.size} categories, ${RULES.length} rules, ${RCS_PREFIXES.length} RCS prefixes, ${SOURCES.length} sources, ` +
      `${precedenceRows} precedence rows, ${REVIEW_POLICIES.length} review policies, ${NEWS_FEEDS.length} news feeds, ${QUALITY_CHECKS.length} quality checks`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
