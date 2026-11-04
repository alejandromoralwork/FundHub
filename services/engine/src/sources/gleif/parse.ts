/**
 * FILE: services/engine/src/sources/gleif/parse.ts
 * PART: scraping engine (services/engine) — source "gleif"
 * WHAT IT DOES: Turns one GLEIF LEI record (JSON:API from api.gleif.org) into a ParsedRecord. The key value
 *   for FundHub: `entity.registeredAs` with `registeredAt.id = "RA000432"` (the Luxembourg RCS) is the RCS
 *   number — so every LEI-holding entity links the CSSF (which shows LEIs) to the RCS (which uses numbers).
 * WHERE IT RUNS: pure function, used by the adapter and tests.
 * TYPESCRIPT YOU WILL SEE HERE: optional chaining `?.`, `Intl.DateTimeFormat`.
 */

import { normalizeLei, normalizeRcs } from "../../core/normalize";
import type { ParsedRecord, RawCapture } from "../../core/types";

/** Kind: constant. GLEIF's id for the Luxembourg Trade and Companies Register. */
export const LU_RCS_AUTHORITY = "RA000432";
/** Kind: constant. Bump when parseGleif output changes. */
export const GLEIF_PARSER_VERSION = 1;

type GleifAddress = { addressLines: string[]; postalCode: string | null; city: string | null; country: string | null };
/** Kind: type alias. The parts of a GLEIF record we use. */
export type GleifRecord = {
  id: string;
  attributes: {
    lei: string;
    entity: {
      legalName: { name: string };
      otherNames: { name: string; type: string }[] | null;
      legalAddress: GleifAddress;
      headquartersAddress: GleifAddress | null;
      registeredAt: { id: string | null } | null;
      registeredAs: string | null;
      jurisdiction: string | null;
      category: string | null;
      legalForm: { id: string | null; other: string | null } | null;
      status: string | null;
      expiration: { date: string | null; reason: string | null } | null;
      creationDate: string | null;
    };
    registration: { status: string; lastUpdateDate: string; initialRegistrationDate: string };
    bic: string[] | null;
  };
};

/** Kind: function. An ISO timestamp → the calendar date in Luxembourg ("2009-05-03T21:00:00Z" → "2009-05-04"). */
function luDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Luxembourg", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Kind: function. GLEIF address → our Address shape. */
function toAddress(a: GleifAddress | null) {
  if (!a) return null;
  const street = a.addressLines.join(", ");
  const postcode = a.postalCode?.replace(/^L-?\s*/i, "") ?? null;
  return { street, postcode, city: a.city, country: a.country, raw: [street, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ") };
}

/**
 * Kind: function. Parses one GLEIF record.
 * @param r  type `GleifRecord`.
 */
export function parseGleifRecord(r: GleifRecord): ParsedRecord {
  const e = r.attributes.entity;
  const lei = normalizeLei(r.attributes.lei)!;
  const rcs = e.registeredAt?.id === LU_RCS_AUTHORITY ? normalizeRcs(e.registeredAs) : null;
  const status = e.status === "ACTIVE" ? "active" : e.expiration?.reason === "DISSOLVED" ? "struck_off" : "unknown";

  const identifiers: ParsedRecord["identifiers"] = [{ scheme: "lei", value: lei }];
  if (rcs) identifiers.push({ scheme: "rcs", value: rcs });

  const names: ParsedRecord["names"] = [{ name: e.legalName.name.trim(), kind: "legal", validFrom: null }];
  for (const o of e.otherNames ?? []) {
    names.push({ name: o.name.trim(), kind: o.type === "PREVIOUS_LEGAL_NAME" ? "former" : "trade", validFrom: null });
  }

  return {
    source: "gleif",
    externalId: lei,
    state: "found",
    scope: e.legalAddress.country,
    facts: {
      name: e.legalName.name.trim(),
      legalForm: e.legalForm?.other ?? null,
      status,
      address: toAddress(e.legalAddress),
      registrationDate: luDate(e.creationDate),
      lei,
      rcsNumber: rcs,
      gleifLegalFormCode: e.legalForm?.id ?? null,
      gleifCategory: e.category,
      gleifRegistrationStatus: r.attributes.registration.status,
      gleifHeadquarters: toAddress(e.headquartersAddress),
      gleifRegisteredAs: e.registeredAs,
      gleifRegisteredAt: e.registeredAt?.id ?? null,
      bic: r.attributes.bic ?? [],
    },
    identifiers,
    names,
  };
}

/**
 * Kind: function. Parses raw bytes: either `{ data: record }` (single-record endpoint) or a bare record.
 * @param raw  type `RawCapture`.
 */
export function parseGleif(raw: RawCapture): ParsedRecord {
  if (raw.httpStatus === 404 || raw.body.length === 0) {
    return { source: "gleif", externalId: raw.externalId, state: "not_found", facts: {}, identifiers: [], names: [] };
  }
  const json = JSON.parse(raw.body.toString("utf8")) as { data?: GleifRecord } & Partial<GleifRecord>;
  return parseGleifRecord((json.data ?? json) as GleifRecord);
}
