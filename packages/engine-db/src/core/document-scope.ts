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
