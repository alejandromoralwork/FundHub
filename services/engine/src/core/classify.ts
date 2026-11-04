/**
 * FILE: services/engine/src/core/classify.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Decides an entity's classification — isServiceProvider, entity kind, activity category and
 *   subcategory, and tier — from the facts the registers give us (CSSF entity types and active activity
 *   codes, RCS legal form) and the `classification_rules` table. For each output field the highest-priority
 *   matching rule wins; the subcategory must belong to the winning category. Pure function.
 * WHERE IT RUNS: called by core/ingest.ts and by the `reclassify` job.
 * TYPESCRIPT YOU WILL SEE HERE: `Pick<T, K>`, `filter` + `sort`, `??`.
 */

import type { ClassificationRule, EntityKind } from "@fundhub/engine-db/schema";

/** Kind: type alias. What classification looks at. */
export type ClassifyInput = {
  /** CSSF entity types of all CSSF records linked to the entity, e.g. ["SPP"]. */
  cssfTypes: string[];
  /** Active CSSF detail codes (no end date), e.g. ["ACT_SPP_DOM", "OST_SPP_AA"]. */
  cssfCodes: string[];
  legalForm?: string | null;
  /** True when the entity is in the RCS (or GLEIF says LU-registered) — corporates default. */
  hasRcs: boolean;
};

/** Kind: type alias. The result written to `entities`. */
export type Classification = {
  isServiceProvider: boolean;
  entityKind: EntityKind;
  activityCategoryId: number | null;
  activitySubcategoryId: number | null;
  tier: number;
  /** Ids of the rules used, for explanations in the console. */
  ruleIds: number[];
};

type Rule = Pick<ClassificationRule, "id" | "kind" | "match" | "isServiceProvider" | "entityKind" | "categoryId" | "subcategoryId" | "tier" | "priority" | "enabled">;

/**
 * Kind: function. Applies the rules.
 * @param input        type `ClassifyInput`.
 * @param rules        type `Rule[]` — all rules (disabled ones are ignored).
 * @param defaults     `corporateCategoryId` — category for entities no rule matched but that are in the RCS.
 * @returns `Classification`.
 */
export function classify(input: ClassifyInput, rules: Rule[], defaults: { corporateCategoryId: number | null } = { corporateCategoryId: null }): Classification {
  const hits = rules
    .filter((r) => r.enabled)
    .filter(
      (r) =>
        (r.kind === "cssf_type" && input.cssfTypes.includes(r.match)) ||
        (r.kind === "cssf_activity" && input.cssfCodes.includes(r.match)) ||
        (r.kind === "rcs_legal_form" && !!input.legalForm && input.legalForm.toLowerCase() === r.match.toLowerCase()),
    )
    // Highest priority first; ties broken by id so the result is stable.
    .sort((a, b) => b.priority - a.priority || a.id - b.id);

  const first = <K extends keyof Rule>(field: K) => hits.find((r) => r[field] !== null && r[field] !== undefined);

  const catRule = first("categoryId");
  const categoryId = catRule?.categoryId ?? null;
  const subRule = hits.find((r) => r.subcategoryId !== null && (r.categoryId === null || r.categoryId === categoryId));
  const spRule = first("isServiceProvider");
  const kindRule = first("entityKind");
  // Tier: the deepest any matching rule asks for.
  const tier = Math.max(0, ...hits.map((r) => r.tier ?? 0));

  const noRule = hits.length === 0;
  return {
    isServiceProvider: spRule?.isServiceProvider ?? false,
    entityKind: (kindRule?.entityKind as EntityKind | undefined) ?? (input.hasRcs ? "corporate" : "other"),
    activityCategoryId: categoryId ?? (noRule && input.hasRcs ? defaults.corporateCategoryId : null),
    activitySubcategoryId: subRule?.subcategoryId ?? null,
    tier,
    ruleIds: [...new Set([catRule, subRule, spRule, kindRule].filter(Boolean).map((r) => r!.id))],
  };
}
