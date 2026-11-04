/**
 * FILE: services/engine/src/sources/cssf/parse.ts
 * PART: scraping engine (services/engine) — source "cssf"
 * WHAT IT DOES: Turns one CSSF eDesk entity (JSON from /search-entities-api/api/v1/entite/{id}) into a
 *   ParsedRecord: identity facts, identifiers (CSSF code P…, internal id, LEI), name history, and the detail
 *   lines (authorised statuses ACT_…, other statuses OST_…, services, fund compartments).
 *   Labels for codes come from labels.json (the CSSF site's own English translations).
 * WHERE IT RUNS: pure function, used by the adapter and by tests.
 * TYPESCRIPT YOU WILL SEE HERE: a JSON import, type aliases for API shapes, `startsWith`, `map`/`filter`.
 */

import labels from "./labels.json";
import { normalizeLei, parseLuAddress, ymdArrayToIso } from "../../core/normalize";
import type { CssfDetailRow, ParsedRecord, RawCapture } from "../../core/types";

/** Kind: type alias. One detail line as the CSSF API returns it. */
export type CssfApiDetail = { detailType: string; detailValue: string; dtDebValid: number[] | null; dtEndValid: number[] | null; leiCode: string | null };
/** Kind: type alias. The fields of a CSSF API entity we use. */
export type CssfApiEntity = {
  entiteId: number;
  entiteCode: string | null;
  entiteName: string;
  entiteType: string;
  entiteAddress: string | null;
  entiteCountryCode: string | null;
  entiteGroup: string | null;
  entiteSubGroup: string | null;
  entiteStatus: string | null;
  activate: boolean;
  branch: boolean;
  agent: boolean;
  dtAuthorisation: number[] | null;
  dtDebValid: number[] | null;
  dtEndValid: number[] | null;
  leiCode: string | null;
  details: CssfApiDetail[];
};

/** Kind: constant. Bump when the output of parseCssf changes. */
export const CSSF_PARSER_VERSION = 1;

const ACTIVITY_LABELS = labels.activities as Record<string, string>;
const TYPE_LABELS = labels.entityTypes as Record<string, string>;

/** Kind: function. The English label of an entity type code ("SPP" → "Specialised PFS"). */
export const cssfTypeLabel = (code: string) => TYPE_LABELS[code] ?? code;

/**
 * Kind: function. Which group a detail code belongs to (the sections of the CSSF page).
 * @param detailType  "ACTIVITY_CODE", "COMPARTMENT_NAME"…
 * @param code        e.g. "ACT_SPP_DOM".
 */
export function detailKind(detailType: string, code: string): string {
  if (detailType === "COMPARTMENT_NAME") return "compartment";
  if (detailType !== "ACTIVITY_CODE") return "other_detail";
  if (code.startsWith("ACT_CASP") || code.startsWith("SERVVA_")) return "crypto";
  if (code.startsWith("ACT_")) return "authorised";
  if (code.startsWith("OST_")) return "other";
  if (code.startsWith("SER_")) return "service";
  if (code.startsWith("ANC_")) return "ancillary";
  if (code.startsWith("SERVPAY_")) return "payment";
  return "other_detail";
}

/**
 * Kind: function. Parses one CSSF entity JSON.
 * @param e  type `CssfApiEntity`.
 * @returns `ParsedRecord`.
 */
export function parseCssfEntity(e: CssfApiEntity): ParsedRecord {
  const lei = normalizeLei(e.leiCode);
  const country = e.entiteCountryCode && e.entiteCountryCode !== "LU" ? e.entiteCountryCode : null;
  const address = e.entiteAddress ? (country ? { raw: e.entiteAddress, country } : parseLuAddress(e.entiteAddress)) : null;
  const validTo = ymdArrayToIso(e.dtEndValid);
  const active = e.activate && !validTo;

  // Name history: the most recent HISTORIC_NAME is the current legal name, older ones are former names.
  const history = e.details
    .filter((d) => d.detailType === "HISTORIC_NAME")
    .map((d) => ({ name: d.detailValue.trim(), validFrom: ymdArrayToIso(d.dtDebValid) }))
    .sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""));
  const names = history.map((h) => ({ name: h.name, kind: (h.name === e.entiteName.trim() ? "legal" : "former") as "legal" | "former", validFrom: h.validFrom }));
  if (!names.some((n) => n.kind === "legal")) names.unshift({ name: e.entiteName.trim(), kind: "legal", validFrom: null });

  const cssfDetails: CssfDetailRow[] = e.details
    .filter((d) => d.detailType !== "HISTORIC_NAME")
    .map((d) => {
      const kind = detailKind(d.detailType, d.detailValue);
      return {
        detailType: d.detailType,
        kind,
        code: d.detailValue,
        // Compartments look like "O00012720_00000001-MERCHFONDO": the label is the part after the dash.
        label: kind === "compartment" ? d.detailValue.replace(/^[^-]*-/, "") : (ACTIVITY_LABELS[d.detailValue] ?? null),
        lei: normalizeLei(d.leiCode),
        startDate: ymdArrayToIso(d.dtDebValid),
        endDate: ymdArrayToIso(d.dtEndValid),
      };
    })
    .sort((a, b) => `${a.detailType}:${a.code}`.localeCompare(`${b.detailType}:${b.code}`));

  const identifiers: ParsedRecord["identifiers"] = [{ scheme: "cssf_id", value: String(e.entiteId) }];
  if (e.entiteCode) identifiers.push({ scheme: "cssf_code", value: e.entiteCode });
  if (lei) identifiers.push({ scheme: "lei", value: lei });

  return {
    source: "cssf",
    externalId: String(e.entiteId),
    state: "found",
    scope: e.entiteType,
    facts: {
      name: e.entiteName.trim(),
      address,
      lei,
      // A CSSF listing proves the entity is active at the CSSF, not in the RCS: never claim "struck_off" here.
      status: active ? "active" : "unknown",
      cssfType: e.entiteType,
      cssfTypeLabel: cssfTypeLabel(e.entiteType),
      cssfCode: e.entiteCode,
      cssfActive: active,
      cssfValidFrom: ymdArrayToIso(e.dtDebValid),
      cssfValidTo: validTo,
      cssfAuthorisationDate: ymdArrayToIso(e.dtAuthorisation),
      cssfGroup: e.entiteGroup,
      cssfSubGroup: e.entiteSubGroup,
      cssfBranch: e.branch,
      cssfAgent: e.agent,
    },
    identifiers,
    names,
    cssfDetails,
  };
}

/**
 * Kind: function. Parses raw bytes from the CSSF API (the adapter's `parse`).
 * @param raw  type `RawCapture`.
 */
export function parseCssf(raw: RawCapture): ParsedRecord {
  if (raw.httpStatus === 404 || raw.body.length === 0) {
    return { source: "cssf", externalId: raw.externalId, state: "not_found", facts: {}, identifiers: [], names: [] };
  }
  return parseCssfEntity(JSON.parse(raw.body.toString("utf8")) as CssfApiEntity);
}
