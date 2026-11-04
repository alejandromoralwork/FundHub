/**
 * FILE: apps/admin/src/lib/engine-resources.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The Scraping Engine's tables as shown in the Console's generic "Database" module. They live in
 *   the engine's OWN database (packages/engine-db, ENGINE_DATABASE_URL), so each entry says `database: "engine"`.
 *   Most tables are read-only here on purpose: register data comes from the scrapers, and entity edits go
 *   through the Registry page (/engine/registry), which records them as "manual" observations with history.
 *   Only reference tables are editable directly (rules, categories, match decisions); every write is
 *   attributed to the staff member in the engine's row_history.
 *   URL keys start with "engine-" so they never collide with website tables.
 * WHERE IT RUNS: server only (imported by lib/resources.ts).
 * TYPESCRIPT YOU WILL SEE HERE: `import * as e`, object literals typed later by `ResourceDef`.
 */

import "server-only";
import * as e from "@fundhub/engine-db/schema";
import { CAN } from "./auth";
import type { ResourceDef } from "./resources";

/** Kind: constant. Engine table entries, keyed by URL name. */
export const ENGINE_RESOURCES: Record<string, ResourceDef> = {
  "engine-entities": { table: e.entities, label: "Entities (golden records) — edit in Registry", database: "engine", group: "Scraping engine", search: ["canonicalName", "rcsNumber", "lei"], defaultSort: "canonicalName" },
  "engine-entity_identifiers": { table: e.entityIdentifiers, label: "Entity identifiers", database: "engine", group: "Scraping engine", search: ["value"] },
  "engine-entity_names": { table: e.entityNames, label: "Entity names (history)", database: "engine", group: "Scraping engine", search: ["name"] },
  "engine-entity_relations": { table: e.entityRelations, label: "Relations / clients", database: "engine", group: "Scraping engine", search: ["objectName"] },
  "engine-source_records": { table: e.sourceRecords, label: "Source records", database: "engine", group: "Scraping engine", search: ["externalId", "scope"], hidden: ["parsed"] },
  "engine-captures": { table: e.captures, label: "Captures (raw snapshots)", database: "engine", group: "Scraping engine", search: ["url"], hidden: ["parsed"] },
  "engine-observations": { table: e.observations, label: "Observations (attribute history)", database: "engine", group: "Scraping engine", search: ["attribute"] },
  "engine-cssf_details": { table: e.cssfDetails, label: "CSSF statuses & compartments", database: "engine", group: "Scraping engine", search: ["code", "label"] },
  "engine-rcs_filings": { table: e.rcsFilings, label: "RCS filings", database: "engine", group: "Scraping engine", search: ["filingNumber", "type"] },
  "engine-documents": { table: e.documents, label: "Documents (PDFs)", database: "engine", group: "Scraping engine" },
  "engine-change_events": { table: e.changeEvents, label: "Change events", database: "engine", group: "Scraping engine", search: ["kind", "attribute", "actor"] },
  "engine-row_history": { table: e.rowHistory, label: "Row history (all edits)", database: "engine", group: "Scraping engine", search: ["tableName", "rowId", "actor"] },
  "engine-census_snapshots": { table: e.censusSnapshots, label: "Census snapshots", database: "engine", group: "Scraping engine", search: ["source", "scope"] },
  "engine-crawl_runs": { table: e.crawlRuns, label: "Runs", database: "engine", group: "Scraping engine", search: ["job", "status"] },
  "engine-session_health": { table: e.sessionHealth, label: "Session health", database: "engine", group: "Scraping engine" },
  "engine-rcs_number_space": { table: e.rcsNumberSpace, label: "RCS number space (edit on Jobs page)", database: "engine", group: "Scraping engine" },
  "engine-classification_rules": {
    table: e.classificationRules,
    label: "Classification rules",
    database: "engine",
    group: "Scraping engine",
    search: ["match", "note"],
    readOnly: ["id"],
    write: CAN.engineEdit,
    canCreate: true,
    canDelete: true,
    defaultSort: "priority",
  },
  "engine-activity_categories": {
    table: e.activityCategories,
    label: "Activity categories",
    database: "engine",
    group: "Scraping engine",
    search: ["slug", "label"],
    readOnly: ["id"],
    write: CAN.engineEdit,
    canCreate: true,
    defaultSort: "sort",
  },
  "engine-match_candidates": {
    table: e.matchCandidates,
    label: "Match candidates (decide on Matches page)",
    database: "engine",
    group: "Scraping engine",
    readOnly: ["id", "sourceRecordId", "entityId", "method", "score", "createdAt"],
    write: CAN.engineEdit,
  },
};
