/**
 * FILE: packages/engine-db/src/core/classify.ts
 * PART: shared package (packages/engine-db) — engine core, used by the engine workers and the admin console
 * WHAT IT DOES: Decides an entity's classification — isServiceProvider, entity kind, activity category and
 *   subcategory, and tier — from the facts the registers give us (CSSF entity types and active activity
 *   codes, RCS legal form) and the `core.classification_rules` table. For each output field the highest-priority
 *   matching rule wins; the subcategory must belong to the winning category. Pure function.
 * WHERE IT RUNS: called by core/ingest.ts and by the `reclassify` job.
 * TYPESCRIPT YOU WILL SEE HERE: `Pick<T, K>`, `filter` + `sort`, `??`.
 */

import type { ClassificationRule, CompanyKind } from "../schema";

/** Kind: type alias. What classification looks at. */
export type ClassifyInput = {
  /** CSSF entity types of all CSSF records linked to the entity, e.g. ["SPP"]. */
  cssfTypes: string[];
  /** Active CSSF detail codes (no end date), e.g. ["ACT_SPP_DOM", "OST_SPP_AA"]. */
  cssfCodes: string[];
  legalForm?: string | null;
  /** True when the entity is in the RCS (or GLEIF says LU-registered) — corporates default. */
  hasRcs: boolean;
  /** The company's name, for "keyword" rules (regular expressions on the plain name). */
  name?: string;
  /** False for funds and fund vehicles: name rules ("… Advisory", "… Services") must not make them providers. */
  allowNameRules?: boolean;
};

const plainName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.,'’()&\-_/]/g, " ").replace(/\s+/g, " ").trim();
const reCache = new Map<string, RegExp | null>();
/** Kind: function. A keyword rule's regular expression (cached; an invalid one never matches). */
function keywordRe(src: string): RegExp | null {
  if (!reCache.has(src)) {
    try {
      reCache.set(src, new RegExp(src, "i"));
    } catch {
      reCache.set(src, null);
    }
  }
  return reCache.get(src)!;
}

/** Kind: type alias. The result written to `companies`. */
export type Classification = {
  isServiceProvider: boolean;
  companyKind: CompanyKind;
  activityCategoryId: number | null;
  activitySubcategoryId: number | null;
  tier: number;
  /** Ids of the rules used, for explanations in the console. */
  ruleIds: number[];
  /** Every category / service any matching rule gives (a provider licensed for several activities has several). */
  serviceIds: number[];
};

type Rule = Pick<ClassificationRule, "id" | "kind" | "match" | "isServiceProvider" | "companyKind" | "categoryId" | "subcategoryId" | "tier" | "priority" | "enabled">;

/**
 * Kind: function. Applies the rules.
 * @param input        type `ClassifyInput`.
 * @param rules        type `Rule[]` — all rules (disabled ones are ignored).
 * @param defaults     `corporateCategoryId` — category for companies no rule matched but that are in the RCS.
 * @returns `Classification`.
 */
export function classify(input: ClassifyInput, rules: Rule[], defaults: { corporateCategoryId: number | null } = { corporateCategoryId: null }): Classification {
  const hits = rules
    .filter((r) => r.enabled)
    .filter(
      (r) =>
        (r.kind === "cssf_type" && input.cssfTypes.includes(r.match)) ||
        (r.kind === "cssf_activity" && input.cssfCodes.includes(r.match)) ||
        (r.kind === "rcs_legal_form" && !!input.legalForm && input.legalForm.toLowerCase() === r.match.toLowerCase()) ||
        (r.kind === "keyword" && input.allowNameRules !== false && !!input.name && !!keywordRe(r.match)?.test(plainName(input.name))),
    )
    // Highest priority first; ties broken by id so the result is stable.
    .sort((a, b) => b.priority - a.priority || a.id - b.id);

  const first = <K extends keyof Rule>(field: K) => hits.find((r) => r[field] !== null && r[field] !== undefined);

  const catRule = first("categoryId");
  const categoryId = catRule?.categoryId ?? null;
  const subRule = hits.find((r) => r.subcategoryId !== null && (r.categoryId === null || r.categoryId === categoryId));
  const spRule = first("isServiceProvider");
  const kindRule = first("companyKind");
  // Tier: the deepest any matching rule asks for.
  const tier = Math.max(0, ...hits.map((r) => r.tier ?? 0));

  const noRule = hits.length === 0;
  return {
    isServiceProvider: spRule?.isServiceProvider ?? false,
    companyKind: (kindRule?.companyKind as CompanyKind | undefined) ?? (input.hasRcs ? "corporate" : "other"),
    activityCategoryId: categoryId ?? (noRule && input.hasRcs ? defaults.corporateCategoryId : null),
    activitySubcategoryId: subRule?.subcategoryId ?? null,
    tier,
    ruleIds: [...new Set([catRule, subRule, spRule, kindRule].filter(Boolean).map((r) => r!.id))],
    serviceIds: [...new Set(hits.flatMap((r) => [r.categoryId, r.subcategoryId]).filter((x): x is number => typeof x === "number"))],
  };
}
