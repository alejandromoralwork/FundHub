/**
 * FILE: packages/engine-db/src/core/document-scope.ts
 * PART: shared package (packages/engine-db) — engine core
 * WHAT IT DOES: Which companies get their LBR filing PDFs downloaded and kept: service providers, and general
 *   partners of funds (fund_role = general_partner). Every other company keeps its filings list (metadata) but no
 *   documents. One rule, used by the capture server (refuses other PDFs), its status endpoint (the browser
 *   extension shows "Save all documents" only in scope) and reports.
 * WHERE IT RUNS: engine workers, capture server, admin console.
 */

import { sql, type SQL } from "drizzle-orm";

/** Kind: constant. Human wording of the rule (extension, console, errors). */
export const DOCUMENT_SCOPE_LABEL = "service providers and fund general partners (GPs)";

/** Kind: function. Does this company get its filing PDFs? */
export function wantsDocuments(c: { isServiceProvider: boolean | null; fundRole: string | null }): boolean {
  return !!c.isServiceProvider || c.fundRole === "general_partner";
}

/** Kind: function. The same rule as SQL, for a companies alias (default `e`). */
export function documentScopeSql(alias = "e"): SQL {
  // coalesce: a company with no fund role gives false, never null (the extension checks `=== false`).
  return sql.raw(`(coalesce(${alias}.is_service_provider, false) or coalesce(${alias}.fund_role = 'general_partner', false))`);
}
