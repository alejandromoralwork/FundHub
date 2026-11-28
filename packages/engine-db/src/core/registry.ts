/**
 * FILE: packages/engine-db/src/core/registry.ts
 * PART: shared package (packages/engine-db) — engine core
 * WHAT IT DOES: The existence rule. LBR / RCS is the source of truth for whether a company exists: a company is
 *   VALID only when an LBR record ("rcs" page or "lbr_bulk" search row) was found for it. CSSF and GLEIF may add
 *   companies (so the census stays complete and the capture work list knows what to look up), but those stay
 *   pending / unregistered until LBR confirms them. Sub-funds are not RCS entities: they are valid as children of
 *   a verified umbrella (core.company_group_members, role sub_fund).
 *   registryStatus() is pure (tested in test/core.test.ts) and used by entity.ts recomputeCompany(); migration
 *   0008 backfilled the column with the same rule in SQL. validCompanySql() is the gate for publishing / reports.
 * WHERE IT RUNS: engine workers, capture server, admin console.
 */

import { sql, type SQL } from "drizzle-orm";
import type { RegistryStatus } from "../enums";

/** Kind: type alias. What registryStatus() needs to know about a company. */
export type RegistryInput = {
  /** States of the company's LBR source records (sources "rcs" and "lbr_bulk"). */
  lbrStates: string[];
  /** Does the company have an RCS identifier (from any source)? */
  hasRcsIdentifier: boolean;
  /** Does it have a CSSF compartment code (cssf_compartment identifier: a sub-fund per the CSSF)? */
  hasCompartmentIdentifier?: boolean;
  fundRole: string | null;
  legalVehicle: string | null;
};

/** Kind: function. Where the company stands against the RCS (see REGISTRY_STATUSES in enums.ts). */
export function registryStatus(c: RegistryInput): RegistryStatus {
  if (c.lbrStates.includes("found")) return "verified";
  if (c.lbrStates.some((s) => s === "not_found" || s === "gone")) return "rcs_not_found";
  if (c.hasRcsIdentifier) return "pending";
  if (c.hasCompartmentIdentifier || c.fundRole === "sub_fund" || c.legalVehicle === "sub_fund") return "compartment";
  return "unregistered";
}

/** Kind: function. SQL: does the company have a CSSF record that is currently found? For a companies alias. */
export function cssfLinkedSql(alias = "e"): SQL {
  return sql.raw(`exists (select 1 from staging.source_records cs where cs.company_id = ${alias}.id and cs.source = 'cssf' and cs.state = 'found')`);
}

/**
 * Kind: function. SQL: is this company valid (exists in RCS)? Verified, or a compartment whose fund structure's
 * umbrella / head (group role umbrella_fund or head) is verified. For a companies alias (default `e`).
 */
export function validCompanySql(alias = "e"): SQL {
  return sql.raw(`(${alias}.registry_status = 'verified' or (${alias}.registry_status = 'compartment' and exists (
    select 1 from core.company_group_members m
    join core.company_group_members u on u.group_id = m.group_id and u.company_id <> m.company_id and u.role in ('umbrella_fund', 'head')
    join core.companies uc on uc.id = u.company_id and uc.registry_status = 'verified'
    where m.company_id = ${alias}.id and m.role = 'sub_fund')))`);
}
