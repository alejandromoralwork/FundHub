/**
 * FILE: services/engine/src/pipeline/gate.ts
 * PART: scraping engine (services/engine) — the optional human APPROVAL GATE at staging
 * WHAT IT DOES: Decides, for each parsed version of a record, whether it may flow straight on (clean → match →
 *   core) or must wait in staging for a person ("pending"). The rules are rows of ops.review_policies, per
 *   source and scope, editable on the console's Sources page:
 *     auto        never hold
 *     review_all  always hold
 *     review_if   hold when a condition matches (new record, would create a company, parser changed,
 *                 a protected attribute changed, confidence below a threshold)
 *     sample      hold a random share for spot checks
 *   The most specific enabled policy wins: (source, scope) → (source, "*") → ("*", "*").
 * WHERE IT RUNS: engine workers. `evaluate()` is pure (tested in test/core.test.ts).
 */

import { db } from "@fundhub/engine-db/client";
import { reviewPolicies, type ReviewPolicy } from "@fundhub/engine-db/schema";
import type { Change } from "../core/diff";

/** Kind: type alias. What the gate knows about a parsed version. */
export type GateInput = {
  source: string;
  scope: string | null;
  /** No version of this record was released before. */
  newRecord: boolean;
  /** The record would create a new company (no identifier or link matches an existing one). */
  newCompany: boolean;
  parserChanged: boolean;
  /** Differences vs the released version (core/diff.ts). */
  changes: Change[];
  confidence: number | null;
  /** 0…1, injected so tests are deterministic. */
  random?: number;
};

/** Kind: type alias. The decision. */
export type GateDecision = { hold: boolean; reasons: string[]; policyId: number | null };

/** Kind: function. Picks the most specific enabled policy. */
export function pickPolicy(policies: ReviewPolicy[], source: string, scope: string | null): ReviewPolicy | null {
  const on = policies.filter((p) => p.enabled);
  return (
    (scope ? on.find((p) => p.source === source && p.scope === scope) : undefined) ??
    on.find((p) => p.source === source && p.scope === "*") ??
    on.find((p) => p.source === "*" && p.scope === "*") ??
    null
  );
}

/** Kind: function. Applies one policy to one parsed version. */
export function evaluate(policy: ReviewPolicy | null, input: GateInput): GateDecision {
  if (!policy || policy.mode === "auto") return { hold: false, reasons: [], policyId: policy?.id ?? null };
  if (policy.mode === "review_all") return { hold: true, reasons: [`every ${input.source} record is reviewed`], policyId: policy.id };
  if (policy.mode === "sample") {
    const r = input.random ?? Math.random();
    return r < policy.sampleRate ? { hold: true, reasons: [`random spot check (${Math.round(policy.sampleRate * 100)}%)`], policyId: policy.id } : { hold: false, reasons: [], policyId: policy.id };
  }
  const c = policy.conditions ?? {};
  const reasons: string[] = [];
  if (c.newRecord && input.newRecord) reasons.push("new record");
  if (c.newCompany && input.newCompany) reasons.push("would create a new company");
  if (c.parserChanged && input.parserChanged && !input.newRecord) reasons.push("parser version changed");
  if (c.protectedAttributes?.length && !input.newRecord) {
    const hit = input.changes.filter((ch) => ch.attribute && c.protectedAttributes!.includes(ch.attribute)).map((ch) => ch.attribute!);
    if (hit.length) reasons.push(`protected attribute changed: ${[...new Set(hit)].join(", ")}`);
  }
  if (typeof c.minConfidence === "number" && input.confidence !== null && input.confidence < c.minConfidence) {
    reasons.push(`confidence ${Math.round(input.confidence * 100)}% below ${Math.round(c.minConfidence * 100)}%`);
  }
  return { hold: reasons.length > 0, reasons, policyId: policy.id };
}

let cache: { at: number; rows: ReviewPolicy[] } | null = null;

/** Kind: async function. All policies, cached for one minute (policy edits apply within a minute). */
export async function loadPolicies(): Promise<ReviewPolicy[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  cache = { at: Date.now(), rows: await db.select().from(reviewPolicies) };
  return cache.rows;
}
/** Kind: function. Forget cached policies (tests, after edits in the same process). */
export const clearPolicyCache = () => (cache = null);
