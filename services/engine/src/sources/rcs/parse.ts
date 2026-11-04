/**
 * FILE: services/engine/src/sources/rcs/parse.ts
 * PART: scraping engine (services/engine) — source "rcs"
 * WHAT IT DOES: Parses an RCS company page from lbr.lu (English UI) into a ParsedRecord: name, RCS number,
 *   registered office, registration date, legal form, date of last filing, and the full list of filings
 *   (number L…, date, type, detail lines, "Corrects filing N°…" / "Corrected by the filing N°…" links,
 *   "No documents"). It reads the page's VISIBLE TEXT (innerText), line by line, rather than HTML tags: the
 *   text layout is what a person sees and changes far less often than the markup.
 *   ⚠ Built from the text of B145917 shared by the team; verify against a fresh `engine rcs:capture`
 *   (struck-off and in-liquidation pages especially) and add those as fixtures.
 * WHERE IT RUNS: pure function, used by the adapter and tests.
 * TYPESCRIPT YOU WILL SEE HERE: regular expressions, `findIndex`, a small state machine over lines.
 */

import { dmyToIso, normalizeRcs, parseLuAddress } from "../../core/normalize";
import type { ParsedRecord, RawCapture, RcsFilingRow } from "../../core/types";

/** Kind: constant. Bump when parseRcsText output changes. */
export const RCS_PARSER_VERSION = 1;

/** Kind: constant. Page text that means "this number does not exist". */
export const RCS_NOT_FOUND_RE = /no (result|company|match)|aucun r[ée]sultat|not found|does not exist/i;

const FILING_RE = /^L\d{9}$/;
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const CORRECTS_RE = /^Corrects filing N°\s*(L\d{9})/i;
const CORRECTED_BY_RE = /^Corrected by the filing N°\s*(L\d{9})/i;

/** Kind: class. Thrown when the page is not a company page (login page, layout change…). */
export class RcsPageError extends Error {}

/**
 * Kind: function. The line after the first line equal to `label` (case-insensitive), or null.
 * @param lines  page lines.
 * @param label  e.g. "Registration date".
 */
function after(lines: string[], label: string): string | null {
  const i = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
  return i >= 0 && i + 1 < lines.length ? lines[i + 1] : null;
}

/**
 * Kind: function. Parses the filings section: blocks that start with a filing number.
 * @param lines  page lines starting anywhere before the first filing.
 */
export function parseFilings(lines: string[]): RcsFilingRow[] {
  const out: RcsFilingRow[] = [];
  let i = lines.findIndex((l) => FILING_RE.test(l));
  while (i >= 0 && i < lines.length) {
    const filingNumber = lines[i];
    // The block ends at the next filing number (or the end of the page).
    let end = i + 1;
    while (end < lines.length && !FILING_RE.test(lines[end])) end++;
    const block = lines.slice(i + 1, end);
    // A complete block has at least a date and a type; a truncated last block is skipped.
    if (block.length >= 2 && DATE_RE.test(block[0])) {
      const row: RcsFilingRow = { filingNumber, filingDate: dmyToIso(block[0]), type: block[1], details: [], corrects: null, correctedBy: null, hasDocuments: true };
      for (const line of block.slice(2)) {
        const c = line.match(CORRECTS_RE);
        const cb = line.match(CORRECTED_BY_RE);
        if (c) row.corrects = c[1];
        else if (cb) row.correctedBy = cb[1];
        else if (/^no documents?$/i.test(line)) row.hasDocuments = false;
        else if (line !== "-") row.details.push(line);
      }
      out.push(row);
    }
    i = end < lines.length ? end : -1;
  }
  return out;
}

/**
 * Kind: function. Parses the visible text of an RCS company page.
 * @param text        type `string` — innerText of the page.
 * @param externalId  type `string` — the RCS number we asked for (e.g. "B145917").
 * @returns `ParsedRecord`.
 * @throws  `RcsPageError` when the text is neither a company page nor a "not found" page.
 */
export function parseRcsText(text: string, externalId: string): ParsedRecord {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const h = lines.findIndex((l) => l.toLowerCase() === "headquarters" || l.toLowerCase() === "registered office");
  if (h < 2) {
    if (RCS_NOT_FOUND_RE.test(text)) return { source: "rcs", externalId, state: "not_found", scope: externalId[0], facts: {}, identifiers: [], names: [] };
    throw new RcsPageError(`Unrecognised RCS page for ${externalId} (no "headquarters" line)`);
  }

  const rcsNumber = normalizeRcs(lines[h - 1]) ?? normalizeRcs(externalId);
  const name = lines[h - 2];
  // Address lines run from after "headquarters" to "Registration date".
  const regIdx = lines.findIndex((l, idx) => idx > h && /^registration date$/i.test(l));
  const addressLines = lines.slice(h + 1, regIdx > h ? regIdx : h + 3);
  const lastFiling = text.match(/Date of last filing:\s*(\d{2}\/\d{2}\/\d{4})/i);

  // Status is read from the header part only (before the filings), where LBR shows it.
  const header = lines.slice(0, regIdx > 0 ? regIdx + 6 : h + 8).join(" \n");
  const status = /struck off|deregistered|radi[ée]e/i.test(header) ? "struck_off" : /liquidation/i.test(header) ? "in_liquidation" : "active";

  const filingsStart = lines.findIndex((l) => /^consult the filing$/i.test(l));
  const rcsFilings = parseFilings(filingsStart >= 0 ? lines.slice(filingsStart + 1) : lines.slice(h));

  return {
    source: "rcs",
    externalId: rcsNumber ?? externalId,
    state: "found",
    scope: (rcsNumber ?? externalId)[0],
    facts: {
      name,
      rcsNumber,
      address: addressLines.length ? parseLuAddress(addressLines.join(", ")) : null,
      registrationDate: dmyToIso(after(lines, "Registration date")),
      legalForm: after(lines, "Legal form"),
      status,
      rcsLastFilingDate: dmyToIso(lastFiling?.[1]),
      rcsFilingCount: rcsFilings.length,
    },
    identifiers: rcsNumber ? [{ scheme: "rcs", value: rcsNumber }] : [],
    names: [{ name, kind: "legal", validFrom: null }],
    rcsFilings,
  };
}

/**
 * Kind: function. The adapter's `parse`: the raw body is JSON `{ url, text, html }` saved by the browser.
 * @param raw  type `RawCapture`.
 */
export function parseRcs(raw: RawCapture): ParsedRecord {
  const { text } = JSON.parse(raw.body.toString("utf8")) as { text: string };
  return parseRcsText(text, raw.externalId);
}
