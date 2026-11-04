/**
 * FILE: services/engine/src/sources/lbr-bulk/parse.ts
 * PART: scraping engine (services/engine) — source "lbr_bulk"
 * WHAT IT DOES: Reads an official LBR data extract (the complete list of RCS entities, obtained under LBR's
 *   data-reuse licence) given as CSV, and turns each row into a ParsedRecord keyed by RCS number. Column
 *   names differ between extracts, so a COLUMN MAP says which header holds what
 *   (default guesses cover common FR/EN headers). XLSX extracts: save as CSV (UTF-8) first.
 *   Rows go through the normal ingest pipeline, so history, diffs and matching work like any source.
 * WHERE IT RUNS: pure functions, used by the `rcs_import_file` job and tests.
 * TYPESCRIPT YOU WILL SEE HERE: a small CSV state machine, `Record<string, string>`, generators.
 */

import { dmyToIso, normalizeRcs, parseLuAddress } from "../../core/normalize";
import type { ParsedRecord, RawCapture } from "../../core/types";

/** Kind: constant. Bump when the output of parseLbrRow changes. */
export const LBR_BULK_PARSER_VERSION = 1;

/** Kind: type alias. Which CSV header holds each field (only `rcs` is required). */
export type ColumnMap = { rcs: string; name?: string; legalForm?: string; address?: string; registrationDate?: string; status?: string };

/** Kind: constant. Header guesses, lower-cased, tried in order when no explicit map is given. */
const GUESSES: Record<keyof ColumnMap, string[]> = {
  rcs: ["rcs", "rcs number", "numero rcs", "numéro rcs", "n° rcs", "matricule rcs", "registration number"],
  name: ["name", "denomination", "dénomination", "raison sociale", "company name", "nom"],
  legalForm: ["legal form", "forme juridique", "forme"],
  address: ["address", "adresse", "siège social", "siege social", "registered office", "headquarters"],
  registrationDate: ["registration date", "date d'immatriculation", "date immatriculation", "date de constitution"],
  status: ["status", "statut", "état", "etat"],
};

/**
 * Kind: function. Parses CSV text (RFC 4180: quotes, doubled quotes, newlines inside quotes).
 * The delimiter is detected from the header line (";" , "," or tab).
 * @returns `string[][]` — rows of cells, header included.
 */
export function parseCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.slice(0, body.search(/\r?\n/) >>> 0 || body.length);
  const delim = [";", "\t", ","].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/**
 * Kind: function. Resolves the column map against the header row.
 * @param header    the CSV header cells.
 * @param explicit  e.g. { rcs: "Numéro RCS", name: "Dénomination" } — overrides the guesses.
 * @returns `Record<field, column index>`.
 * @throws  when no RCS column is found.
 */
export function resolveColumns(header: string[], explicit: Partial<ColumnMap> = {}): Partial<Record<keyof ColumnMap, number>> {
  const lower = header.map((h) => h.trim().toLowerCase());
  const out: Partial<Record<keyof ColumnMap, number>> = {};
  for (const field of Object.keys(GUESSES) as (keyof ColumnMap)[]) {
    const wanted = explicit[field] ? [explicit[field]!.toLowerCase()] : GUESSES[field];
    const idx = lower.findIndex((h) => wanted.includes(h));
    if (idx >= 0) out[field] = idx;
  }
  if (out.rcs === undefined) throw new Error(`No RCS column found in header: ${header.join(" | ")}. Pass --map rcs=<header>.`);
  return out;
}

/** Kind: function. Status text from the extract → entity status. */
function statusOf(v: string | undefined): "active" | "in_liquidation" | "struck_off" | "unknown" {
  if (!v?.trim()) return "unknown";
  if (/radi|struck|deregist|dissol/i.test(v)) return "struck_off";
  if (/liquidation|faillite|bankrupt/i.test(v)) return "in_liquidation";
  if (/actif|active|inscrit|registered/i.test(v)) return "active";
  return "unknown";
}

/**
 * Kind: function. One CSV row → ParsedRecord (null when the RCS number is not valid).
 * @param cells  the row.
 * @param cols   from resolveColumns().
 */
export function parseLbrRow(cells: string[], cols: Partial<Record<keyof ColumnMap, number>>): ParsedRecord | null {
  const get = (f: keyof ColumnMap) => (cols[f] === undefined ? undefined : cells[cols[f]!]?.trim());
  const rcs = normalizeRcs(get("rcs"));
  if (!rcs) return null;
  const name = get("name") || undefined;
  const date = get("registrationDate");
  const address = get("address");
  return {
    source: "lbr_bulk",
    externalId: rcs,
    state: "found",
    scope: rcs[0],
    facts: {
      ...(name ? { name } : {}),
      rcsNumber: rcs,
      legalForm: get("legalForm") || null,
      address: address ? parseLuAddress(address) : null,
      registrationDate: date ? (dmyToIso(date) ?? (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null)) : null,
      status: statusOf(get("status")),
    },
    identifiers: [{ scheme: "rcs", value: rcs }],
    names: name ? [{ name, kind: "legal", validFrom: null }] : [],
  };
}

/** Kind: function. The adapter's `parse`: the raw body is the JSON of an already parsed row. */
export function parseLbrBulk(raw: RawCapture): ParsedRecord {
  return JSON.parse(raw.body.toString("utf8")) as ParsedRecord;
}
