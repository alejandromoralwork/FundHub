/**
 * FILE: apps/admin/src/lib/engine-resources.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The Intelligence DB's tables as shown in the Console's generic "Database" module, grouped by
 *   pipeline layer (one Postgres schema each: raw, staging, clean, match, core, ops). Each entry says
 *   `database: "engine"`. Most tables are read-only here on purpose: data comes from the pipeline, company
 *   edits go through the Companies page (stored as "manual" claims with history), approvals through Review.
 *   Only reference / steering tables are editable directly (rules, categories, precedence, review policies,
 *   news feeds); every write is attributed to the staff member in core.row_history.
 *   URL keys start with "engine-" so they never collide with website tables.
 * WHERE IT RUNS: server only (imported by lib/resources.ts).
 */

import "server-only";
import * as e from "@fundhub/engine-db/schema";
import { CAN } from "./auth";
import type { ResourceDef } from "./resources";

const RAW = "Intelligence · 1 raw";
const STAGING = "Intelligence · 2 staging";
const CLEAN = "Intelligence · 3 clean";
const MATCH = "Intelligence · 4 match";
const CORE = "Intelligence · 5 core (golden)";
const OPS = "Intelligence · ops";

/** Kind: constant. Intelligence DB table entries, keyed by URL name. */
export const ENGINE_RESOURCES: Record<string, ResourceDef> = {
  // 1 raw
  "engine-raw-fetches": { table: e.fetches, label: "Fetches (every content version)", database: "engine", group: RAW, search: ["url", "rawHash"] },
  "engine-raw-documents": { table: e.documents, label: "Documents (PDFs)", database: "engine", group: RAW, search: ["filingNumber"] },
  // 2 staging
  "engine-staging-source_records": { table: e.sourceRecords, label: "Source records (one per id at a source)", database: "engine", group: STAGING, search: ["externalId", "scope"], hidden: ["released"] },
  "engine-staging-parsed_records": { table: e.parsedRecords, label: "Parsed versions + approval gate (approve in Review)", database: "engine", group: STAGING, search: ["reviewStatus"], hidden: ["payload", "editedPayload"] },
  // 3 clean
  "engine-clean-claims": { table: e.claims, label: "Claims (attribute history per source)", database: "engine", group: CLEAN, search: ["attribute"] },
  "engine-clean-rejects": { table: e.rejects, label: "Rejected values", database: "engine", group: CLEAN, search: ["attribute", "reason"] },
  "engine-clean-licences": { table: e.licences, label: "CSSF licences & compartments", database: "engine", group: CLEAN, search: ["code", "label"] },
  "engine-clean-filings": { table: e.filings, label: "LBR filings", database: "engine", group: CLEAN, search: ["filingNumber", "type"] },
  "engine-clean-web_pages": { table: e.webPages, label: "Crawled website pages", database: "engine", group: CLEAN, search: ["url", "title"] },
  "engine-clean-articles": { table: e.articles, label: "News articles", database: "engine", group: CLEAN, search: ["title", "url"] },
  // 4 match
  "engine-match-candidates": {
    table: e.candidates,
    label: "Match candidates (decide in Review)",
    database: "engine",
    group: MATCH,
    readOnly: ["id", "sourceRecordId", "companyId", "method", "score", "createdAt"],
    write: CAN.engineEdit,
  },
  "engine-match-conflicts": { table: e.conflicts, label: "Cross-source conflicts (decide in Review)", database: "engine", group: MATCH, search: ["attribute"] },
  // 5 core
  "engine-core-companies": { table: e.companies, label: "Companies (golden records) — edit on the Companies page", database: "engine", group: CORE, search: ["canonicalName", "rcsNumber", "lei"], defaultSort: "canonicalName" },
  "engine-core-company_identifiers": { table: e.companyIdentifiers, label: "Company identifiers", database: "engine", group: CORE, search: ["value"] },
  "engine-core-company_names": { table: e.companyNames, label: "Company names (history)", database: "engine", group: CORE, search: ["name"] },
  "engine-core-company_relations": { table: e.companyRelations, label: "Relations / clients", database: "engine", group: CORE, search: ["objectName"] },
  "engine-core-company_groups": { table: e.companyGroups, label: "Company groups", database: "engine", group: CORE, search: ["name", "key", "headLei"] },
  "engine-core-company_group_members": { table: e.companyGroupMembers, label: "Group members", database: "engine", group: CORE, search: ["role", "evidence"] },
  "engine-core-mandates": { table: e.mandates, label: "Service mandates", database: "engine", group: CORE, search: ["providerName", "providerLei", "role"] },
  "engine-core-mandate_evidence": { table: e.mandateEvidence, label: "Mandate evidence", database: "engine", group: CORE, search: ["quote", "url"] },
  "engine-core-fund_events": { table: e.fundEvents, label: "Fund events", database: "engine", group: CORE, search: ["kind", "evidence"] },
  "engine-core-people": { table: e.people, label: "People (GDPR: name + public profile only)", database: "engine", group: CORE, search: ["fullName"] },
  "engine-core-positions": { table: e.positions, label: "Positions (person × company × role)", database: "engine", group: CORE, search: ["title"] },
  "engine-core-web_presence": { table: e.webPresence, label: "Website & social profiles", database: "engine", group: CORE, search: ["url", "handle"] },
  "engine-core-news_mentions": { table: e.newsMentions, label: "News mentions", database: "engine", group: CORE, search: ["matchedText"] },
  "engine-core-review_summaries": { table: e.reviewSummaries, label: "Employer / review ratings", database: "engine", group: CORE },
  "engine-core-field_lineage": { table: e.fieldLineage, label: "Field lineage (which source won each field)", database: "engine", group: CORE, search: ["attribute"] },
  "engine-core-changes": { table: e.changes, label: "Change feed", database: "engine", group: CORE, search: ["kind", "attribute", "actor"] },
  "engine-core-row_history": { table: e.rowHistory, label: "Row history (all edits)", database: "engine", group: CORE, search: ["tableName", "rowId", "actor"] },
  "engine-core-classification_rules": {
    table: e.classificationRules,
    label: "Classification rules",
    database: "engine",
    group: CORE,
    search: ["match", "note"],
    readOnly: ["id"],
    write: CAN.engineEdit,
    canCreate: true,
    canDelete: true,
    defaultSort: "priority",
  },
  "engine-core-activity_categories": {
    table: e.activityCategories,
    label: "Activity categories",
    database: "engine",
    group: CORE,
    search: ["slug", "label"],
    readOnly: ["id"],
    write: CAN.engineEdit,
    canCreate: true,
    defaultSort: "sort",
  },
  // ops
  "engine-ops-mandate_roles": { table: e.mandateRoles, label: "Mandate roles (exclusive = one at a time)", database: "engine", group: OPS, search: ["code", "label"], defaultSort: "sort" },
  "engine-ops-sources": { table: e.sources, label: "Source registry (toggle on the Sources page)", database: "engine", group: OPS, search: ["code", "name", "system"], defaultSort: "sort" },
  "engine-ops-attribute_precedence": { table: e.attributePrecedence, label: "Attribute precedence (0 = most trusted)", database: "engine", group: OPS, search: ["attribute", "source"], write: CAN.engineEdit, canCreate: true, canDelete: true, defaultSort: "attribute" },
  "engine-ops-review_policies": { table: e.reviewPolicies, label: "Staging review policies (edit on the Sources page)", database: "engine", group: OPS, search: ["source", "scope"] },
  "engine-ops-news_feeds": { table: e.newsFeeds, label: "News feeds", database: "engine", group: OPS, search: ["name", "url"], readOnly: ["id", "etag", "lastModified", "lastPolledAt", "lastError", "articles"], write: CAN.engineEdit, canCreate: true, canDelete: true },
  "engine-ops-quality_checks": { table: e.qualityChecks, label: "Quality checks", database: "engine", group: OPS, search: ["code", "label"], readOnly: ["code"], write: CAN.engineEdit, defaultSort: "sort" },
  "engine-ops-quality_results": { table: e.qualityResults, label: "Quality results", database: "engine", group: OPS, search: ["checkCode"] },
  "engine-ops-runs": { table: e.runs, label: "Runs", database: "engine", group: OPS, search: ["job", "status"] },
  "engine-ops-census_snapshots": { table: e.censusSnapshots, label: "Census snapshots", database: "engine", group: OPS, search: ["source", "scope"] },
  "engine-ops-session_health": { table: e.sessionHealth, label: "Session health", database: "engine", group: OPS },
  "engine-ops-lbr_number_space": { table: e.lbrNumberSpace, label: "LBR number space (edit on the Jobs page)", database: "engine", group: OPS },
};
