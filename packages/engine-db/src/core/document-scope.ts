/**
 * FILE: packages/engine-db/src/core/document-scope.ts
 * PART: shared package (packages/engine-db) — engine core
 * WHAT IT DOES: Which companies get their LBR filing PDFs downloaded and kept. Every other company keeps its
 *   filings list (metadata) but no documents. One rule, used by the capture server (refuses other PDFs), its
 *   status endpoint (the browser extension shows "Save all documents" only in scope) and reports.
 *   The rule is chosen with the env var DOCUMENT_SCOPE (read at call time):
 *   - "cssf" (default): CSSF entities that are not funds — supervised firms, ManCos / AIFMs, banks, financial
 *     institutions, service providers, GPs with a CSSF record. Funds (umbrellas, sub-funds, standalone,
 *     master / feeder) are left out.
 *   - "legacy": service providers and fund general partners (the rule before the CSSF run).
 *   Within a company in scope, only some FILING TYPES are worth their PDF (DOCUMENT_FILINGS, default "selected"):
 *   annual accounts and consolidated accounts (all variants), coordinated articles of association, registration, and modifications whose
 *   details include trade name(s), registered office, the person(s) in charge of checking the accounts
 *   (auditor), associate(s) or social capital; end of domiciliation agreements; dissolution / liquidation filings. Modifications that only change directors / signatories, signature lists, resignations, NACE
 *   updates… keep their filing row but not the document. "all" keeps every document.
 * WHERE IT RUNS: engine workers, capture server, admin console.
 */

import { sql, type SQL } from "drizzle-orm";
import { cssfLinkedSql } from "./registry";

/** Kind: type alias. The available rules. */
export type DocumentScopeMode = "cssf" | "legacy";

/** Kind: constant. Fund roles that never get documents in "cssf" mode (the fund itself, not its managers / GP). */
export const FUND_ROLES_WITHOUT_DOCUMENTS = ["umbrella_fund", "standalone_fund", "sub_fund", "master_fund", "feeder_fund"] as const;

/** Kind: function. The active rule (DOCUMENT_SCOPE, default "cssf"; anything unknown falls back to "cssf"). */
export function documentScopeMode(): DocumentScopeMode {
  return process.env.DOCUMENT_SCOPE?.trim().toLowerCase() === "legacy" ? "legacy" : "cssf";
}

const LABELS: Record<DocumentScopeMode, string> = {
  cssf: "CSSF entities that are not funds (supervised firms, ManCos / AIFMs, banks, service providers)",
  legacy: "service providers and fund general partners (GPs)",
};

/** Kind: function. Human wording of the active rule (extension, console, errors). */
export const documentScopeLabel = (mode = documentScopeMode()) => LABELS[mode];

/** Kind: type alias. What wantsDocuments() needs to know about a company. */
export type DocumentScopeInput = { isServiceProvider: boolean | null; fundRole: string | null; companyKind: string | null; hasCssf: boolean };

/** Kind: function. Does this company get its filing PDFs? (Same rule as documentScopeSql.) */
export function wantsDocuments(c: DocumentScopeInput, mode = documentScopeMode()): boolean {
  if (mode === "legacy") return !!c.isServiceProvider || c.fundRole === "general_partner";
  return c.hasCssf && c.companyKind !== "fund" && !(FUND_ROLES_WITHOUT_DOCUMENTS as readonly string[]).includes(c.fundRole ?? "");
}

/** Kind: function. The same rule as SQL, for a companies alias (default `e`). Never null (the extension checks `=== false`). */
export function documentScopeSql(alias = "e", mode = documentScopeMode()): SQL {
  if (mode === "legacy") return sql.raw(`(coalesce(${alias}.is_service_provider, false) or coalesce(${alias}.fund_role = 'general_partner', false))`);
  const roles = FUND_ROLES_WITHOUT_DOCUMENTS.map((r) => `'${r}'`).join(", ");
  return sql`(${cssfLinkedSql(alias)} and ${sql.raw(`${alias}.company_kind <> 'fund' and coalesce(${alias}.fund_role, '') not in (${roles})`)})`;
}

// ------------------------------------------------------------------ which filings get their document

/** Kind: function. The active filing rule (DOCUMENT_FILINGS: "selected" (default) or "all"). */
export function documentFilingsMode(): "selected" | "all" {
  return process.env.DOCUMENT_FILINGS?.trim().toLowerCase() === "all" ? "all" : "selected";
}

/**
 * Kind: constant. Filing types (lower case, as LBR writes them, English or French) whose document is kept.
 * Prefixes cover the variants ("Annual accounts (eCDF)", "Annual accounts (eCDF) - Article 71 …").
 */
const FILING_TYPE_PREFIXES = ["annual accounts", "comptes annuels", "consolidated accounts", "comptes consolidés"];
const FILING_TYPES_EXACT = ["coordinated articles of association", "statuts coordonnés", "registration", "immatriculation"];
/**
 * Kind: constant. Words that keep a filing when they appear in its type or in a detail: end of a domiciliation
 * agreement (names the domiciliation agent) and dissolution / liquidation decisions (name the liquidator).
 * Matched as words because LBR's exact wording varies (and is French on the French site).
 */
const FILING_KEYWORDS = ["domiciliation", "dissolution", "liquidation"];
/** Kind: constant. A "Modification…" filing is kept when one of its details is one of these. */
const MODIFICATION_DETAILS = [
  "trade name(s)",
  "registered office",
  "person(s) in charge of checking the accounts",
  "associate(s)",
  "social capital/social funds",
  "dénomination(s)",
  "siège social",
  "personne(s) chargée(s) du contrôle des comptes",
  "associé(s)",
  "capital social/fonds social",
];

/** Kind: function. Human wording of the filing rule (extension, errors). */
export const documentFilingsLabel = () =>
  documentFilingsMode() === "all"
    ? "all filings"
    : "annual and consolidated accounts, coordinated articles, registration, domiciliation / dissolution / liquidation filings, and modifications of trade name / registered office / auditor / associates / capital";

/** Kind: function. Is this filing's document worth keeping? */
export function filingWantsDocument(type: string, details: string[] = [], mode = documentFilingsMode()): boolean {
  if (mode === "all") return true;
  const t = type.trim().toLowerCase();
  if (FILING_TYPE_PREFIXES.some((p) => t.startsWith(p)) || FILING_TYPES_EXACT.includes(t)) return true;
  const ds = details.map((d) => d.trim().toLowerCase());
  if (FILING_KEYWORDS.some((k) => t.includes(k) || ds.some((d) => d.includes(k)))) return true;
  return t.startsWith("modification") && ds.some((d) => MODIFICATION_DETAILS.includes(d));
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Kind: function. The same rule as SQL, for a clean.filings alias (default `f`). Never null. */
export function filingDocumentSql(alias = "f", mode = documentFilingsMode()): SQL {
  if (mode === "all") return sql.raw("true");
  const t = `lower(trim(${alias}.type))`;
  return sql.raw(
    `(${FILING_TYPE_PREFIXES.map((p) => `${t} like ${lit(p + "%")}`).join(" or ")}` +
      ` or ${t} in (${FILING_TYPES_EXACT.map(lit).join(", ")})` +
      FILING_KEYWORDS.map((k) => ` or ${t} like ${lit(`%${k}%`)}`).join("") +
      ` or exists (select 1 from jsonb_array_elements_text(${alias}.details) kd where ${FILING_KEYWORDS.map((k) => `lower(kd) like ${lit(`%${k}%`)}`).join(" or ")})` +
      ` or (${t} like 'modification%' and exists (select 1 from jsonb_array_elements_text(${alias}.details) fd` +
      ` where lower(trim(fd)) in (${MODIFICATION_DETAILS.map(lit).join(", ")}))))`,
  );
}
