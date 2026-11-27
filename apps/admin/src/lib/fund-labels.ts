/**
 * FILE: apps/admin/src/lib/fund-labels.ts
 * PART: console (apps/admin) — Company intelligence
 * WHAT IT DOES: Display labels for the fund profile (UCITS / AIF, product law, legal vehicle, fund role, manager
 *   licence) and for company groups (layers, kinds, member roles). Plain data: usable in server and browser code.
 */

import type { FundLaw, FundRegime, FundRole, GroupKind, GroupLayer, GroupRole, LegalVehicle, ManagerType } from "@fundhub/engine-db/enums";

export const REGIME_LABEL: Record<FundRegime, string> = { ucits: "UCITS", aif: "AIF", other: "Other" };
export const REGIME_COLOR: Record<FundRegime, string> = { ucits: "geekblue", aif: "volcano", other: "default" };

export const LAW_LABEL: Record<FundLaw, string> = {
  ucits_part_i: "2010 Law Part I (UCITS)",
  uci_part_ii: "2010 Law Part II",
  sif: "SIF (2007 Law)",
  sicar: "SICAR (2004 Law)",
  raif: "RAIF (2016 Law)",
  securitisation: "Securitisation (2004 Law)",
  pension: "Pension fund (SEPCAV / ASSEP)",
  unregulated: "Unregulated",
  foreign: "Foreign",
};

export const VEHICLE_LABEL: Record<LegalVehicle, string> = {
  fcp: "FCP", sicav: "SICAV", sicaf: "SICAF", scsp: "SCSp", scs: "SCS", sca: "SCA", sa: "S.A.", sarl: "S.à r.l.", sas: "SAS", scoop: "Cooperative", sub_fund: "Sub-fund", other: "Other",
};

export const FUND_ROLE_LABEL: Record<FundRole, string> = {
  standalone_fund: "Standalone fund",
  umbrella_fund: "Umbrella fund",
  sub_fund: "Sub-fund",
  master_fund: "Master fund",
  feeder_fund: "Feeder fund",
  general_partner: "General partner (GP)",
  spv: "SPV",
  holding: "Holding",
};

export const MANAGER_LABEL: Record<ManagerType, string> = {
  super_manco: "Super-ManCo (UCITS + AIFM)",
  ucits_manco: "UCITS management company",
  manco_ch16: "Management company (Chapter 16)",
  aifm_authorised: "Authorised AIFM",
  aifm_registered: "Registered AIFM (sub-threshold)",
  aifm_branch: "AIFM branch (other EU State)",
  manco_branch: "ManCo branch (other EU State)",
};

export const LAYER_LABEL: Record<GroupLayer, string> = { corporate: "Corporate groups", fund: "Fund structures", service_provider: "Service-provider groups" };

export const GROUP_KIND_LABEL: Record<GroupKind, string> = {
  corporate_group: "Corporate group",
  fund_platform: "Fund platform (manager)",
  fund_structure: "Fund structure",
  provider_group: "Provider group",
};

export const GROUP_ROLE_LABEL: Record<GroupRole, string> = {
  head: "Head",
  subsidiary: "Subsidiary",
  branch: "Branch",
  managed_fund: "Managed fund",
  umbrella_fund: "Umbrella fund",
  sub_fund: "Sub-fund",
  master_fund: "Master fund",
  feeder_fund: "Feeder fund",
  general_partner: "General partner",
  spv: "SPV",
  holding: "Holding",
  member: "Member",
};

export const GROUP_SOURCE_COLOR: Record<string, string> = { gleif: "cyan", cssf: "blue", name_rule: "gold", manual: "purple" };

/** Kind: function. `{ value, label }` options for a Select from a label map. */
export const optionsOf = <K extends string>(labels: Record<K, string>) => (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));
