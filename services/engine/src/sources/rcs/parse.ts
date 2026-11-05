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
const CORRECTS_RE = /^(?:Corrects filing|Correction of filing) N°\s*(L\d{9})/i;
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
    // …or at the page footer ("Site map"), so footer links never become filing details.
    while (end < lines.length && !FILING_RE.test(lines[end]) && !/^site map$/i.test(lines[end])) end++;
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
    i = end < lines.length && FILING_RE.test(lines[end]) ? end : -1;
  }
  return out;
}

/** Kind: constant. An RCS number on its own line (B123456, E7998, I6…). */
const RCS_LINE_RE = /^[A-Z]\s?\d{1,7}$/;
/** Kind: constant. The header label just below the RCS number (2026 portal: "Registered headquarters"). */
const HQ_RE = /^(registered )?(headquarters|office)$|^si[èe]ge (social|statutaire)$/i;

/**
 * Kind: function. The RCS number in an LBR URL (…/consult-company/B100554?tab=deposit), or null.
 * @param url  type `string | undefined`.
 */
export function rcsFromUrl(url: string | undefined): string | null {
  return normalizeRcs(url?.match(/consult-company\/([A-Za-z]\d{1,7})/)?.[1]);
}

/**
 * Kind: function. Parses the visible text of an RCS company page (LBR portal, English), e.g.
 *   "… SOPRA STERIA PSF LUXEMBOURG S.A. / B100554 / Manage this company / Registered headquarters /
 *    2-4, Rue du Chateau d'Eau / 3364 Leudelange / Registration date / 07/05/2004 / Legal form / Société anonyme /
 *    … Date of last filing :16/10/2026 … Filing N° / Date / Type of filing / Details / Consult the filing / L26…".
 * Header labels are only searched ABOVE the filings list: a filing detail can also read "Registered office".
 * @param text        type `string` — innerText of the page.
 * @param externalId  type `string` — the RCS number asked for / from the URL (e.g. "B145917").
 * @returns `ParsedRecord`.
 * @throws  `RcsPageError` when the text is neither a company page nor a "not found" page.
 */
export function parseRcsText(text: string, externalId: string): ParsedRecord {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const firstFiling = lines.findIndex((l) => FILING_RE.test(l));
  const top = firstFiling >= 0 ? lines.slice(0, firstFiling) : lines;
  const h = top.findIndex((l) => HQ_RE.test(l));
  // The RCS number is the nearest RCS-looking line above the header label; the name is the line above it.
  let r = h - 1;
  while (r >= 0 && h - r <= 4 && !RCS_LINE_RE.test(top[r])) r--;
  if (h < 2 || r < 1 || !RCS_LINE_RE.test(top[r])) {
    if (RCS_NOT_FOUND_RE.test(text)) return { source: "rcs", externalId, state: "not_found", scope: externalId[0], facts: {}, identifiers: [], names: [] };
    throw new RcsPageError(`Unrecognised RCS page for ${externalId} (no company header)`);
  }

  const rcsNumber = normalizeRcs(top[r]) ?? normalizeRcs(externalId);
  const name = top[r - 1];
  // Address lines run from after the header label to "Registration date".
  const regIdx = top.findIndex((l, idx) => idx > h && /^registration date$/i.test(l));
  const addressLines = top.slice(h + 1, regIdx > h ? regIdx : h + 3);
  const lastFiling = text.match(/Date of last filing\s*:\s*(\d{2}\/\d{2}\/\d{4})/i);

  // Status is read from the header part only (name … legal form), where LBR shows it.
  const header = top.slice(r - 1, regIdx > 0 ? regIdx + 4 : h + 8).join(" \n");
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
      registrationDate: dmyToIso(after(top, "Registration date")),
      // Struck-off companies ("radiée") show when they were removed from the register.
      rcsDeletionDate: dmyToIso(after(top, "Deletion date") ?? after(top, "Date de radiation")),
      legalForm: after(top, "Legal form"),
      status,
      rcsLastFilingDate: dmyToIso(lastFiling?.[1]),
      rcsFilingCount: rcsFilings.length,
    },
    identifiers: rcsNumber ? [{ scheme: "rcs", value: rcsNumber }] : [],
    names: [{ name, kind: "legal", validFrom: null }],
    rcsFilings,
  };
}

/** Kind: type alias. One row of an LBR search-results list. */
export type RcsListItem = { rcs: string; name: string; struckOff: boolean };

/**
 * Kind: function. Parses an LBR search-results page ("199 search result(s) for …", then pairs of
 * RCS number / trade name, each optionally followed by "struck off"). Returns null if it is not such a page.
 * Natural persons (prefix A = sole traders) are DROPPED here: their names are personal data and out of scope.
 * @param text  type `string`.
 */
export function parseRcsSearchList(text: string): { total: number | null; items: RcsListItem[] } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const head = lines.findIndex((l) => /^\d+ search result\(s\)/i.test(l));
  if (head < 0) return null;
  const total = Number(lines[head].match(/^(\d+)/)?.[1] ?? NaN);
  const items: RcsListItem[] = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (/^site map$/i.test(lines[i])) break;
    if (!RCS_LINE_RE.test(lines[i]) || i + 1 >= lines.length) continue;
    const rcs = normalizeRcs(lines[i]);
    const name = lines[i + 1];
    const struckOff = /^struck off$/i.test(lines[i + 2] ?? "");
    if (rcs && !rcs.startsWith("A") && !RCS_LINE_RE.test(name)) items.push({ rcs, name, struckOff });
  }
  return { total: Number.isFinite(total) ? total : null, items };
}

/**
 * Kind: function. The adapter's `parse`: the raw body is JSON `{ url, text, html }` saved by the browser.
 * The RCS number in the page URL (consult-company/B…) wins over the id asked for.
 * @param raw  type `RawCapture`.
 */
export function parseRcs(raw: RawCapture): ParsedRecord {
  const { text, url } = JSON.parse(raw.body.toString("utf8")) as { text: string; url?: string };
  return parseRcsText(text, rcsFromUrl(url) ?? raw.externalId);
}
