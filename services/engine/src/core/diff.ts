/**
 * FILE: services/engine/src/core/diff.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Compares the previous parsed record of a source id with the new one and lists the changes
 *   as change events: attribute changes (name / status / address get their own event kinds), CSSF
 *   authorisations added or ended, new RCS filings, and relations (clients…) added or ended.
 *   Pure function: no database, easy to test.
 * WHERE IT RUNS: called by core/ingest.ts when a record's content hash changed.
 * TYPESCRIPT YOU WILL SEE HERE: `Set`, `Map`, type narrowing, object spread.
 */

import type { ChangeKind } from "@fundhub/engine-db/schema";
import { normalizeName, sameValue } from "./normalize";
import type { ParsedRecord } from "./types";

/** Kind: type alias. One detected change (entity / record ids are added by the caller). */
export type Change = { kind: ChangeKind; attribute?: string; oldValue?: unknown; newValue?: unknown };

/** Kind: constant. Attributes with a dedicated event kind. */
const ATTRIBUTE_KINDS: Record<string, ChangeKind> = { name: "name_change", status: "status_change", address: "address_change" };

/**
 * Kind: function. Lists the changes between two versions of the same source record.
 * @param prev  type `ParsedRecord | null` — null when the record is new (→ one "new_record" event).
 * @param next  type `ParsedRecord`.
 * @returns `Change[]`.
 */
export function diffRecords(prev: ParsedRecord | null, next: ParsedRecord): Change[] {
  if (!prev || prev.state !== "found") return [{ kind: "new_record", newValue: { name: next.facts.name ?? null } }];
  const out: Change[] = [];

  // 1. Facts, attribute by attribute.
  const keys = new Set([...Object.keys(prev.facts), ...Object.keys(next.facts)]);
  for (const key of keys) {
    const a = prev.facts[key] ?? null;
    const b = next.facts[key] ?? null;
    if (!sameValue(a, b)) out.push({ kind: ATTRIBUTE_KINDS[key] ?? "attribute_changed", attribute: key, oldValue: a, newValue: b });
  }

  // 2. CSSF authorisations / statuses: keyed by detail type + code.
  const key = (d: { detailType: string; code: string }) => `${d.detailType}:${d.code}`;
  const before = new Map((prev.cssfDetails ?? []).map((d) => [key(d), d]));
  for (const d of next.cssfDetails ?? []) {
    const old = before.get(key(d));
    if (!old) out.push({ kind: "authorisation_added", attribute: d.code, newValue: d });
    else if (!old.endDate && d.endDate) out.push({ kind: "authorisation_ended", attribute: d.code, oldValue: old, newValue: d });
    before.delete(key(d));
  }
  // A line that disappeared from the register is treated as ended.
  for (const d of before.values()) out.push({ kind: "authorisation_ended", attribute: d.code, oldValue: d, newValue: null });

  // 3. RCS filings: any filing number not seen before is new.
  const seen = new Set((prev.rcsFilings ?? []).map((f) => f.filingNumber));
  for (const f of next.rcsFilings ?? []) if (!seen.has(f.filingNumber)) out.push({ kind: "new_filing", attribute: f.type, newValue: f });

  // 4. Relations (clients…): keyed by kind + normalized client name. Only compared when the new record
  //    states relations at all, so a source that does not report them never "ends" existing ones.
  if (next.relations) {
    const rk = (r: { kind: string; objectName: string }) => `${r.kind}:${normalizeName(r.objectName)}`;
    const had = new Map((prev.relations ?? []).map((r) => [rk(r), r]));
    for (const r of next.relations) {
      if (!had.has(rk(r))) out.push({ kind: "relation_added", attribute: r.kind, newValue: r });
      had.delete(rk(r));
    }
    for (const r of had.values()) out.push({ kind: "relation_ended", attribute: r.kind, oldValue: r });
  }

  return out;
}
