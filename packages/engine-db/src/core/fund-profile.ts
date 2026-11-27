/**
 * FILE: packages/engine-db/src/core/fund-profile.ts
 * PART: shared package (packages/engine-db) — engine core
 * WHAT IT DOES: The fund side of a company's classification: is it a fund, UCITS or AIF, under which Luxembourg
 *   law, in which legal vehicle (FCP, SICAV, SCSp…), what role in a fund structure (umbrella, sub-fund, feeder,
 *   general partner, SPV, holding) and, for managers, which licence (UCITS ManCo, super-ManCo, AIFM…).
 *   Evidence, strongest first: CSSF registers (type, group, sub-group, compartments) → GLEIF (category, legal
 *   form) → the group the company belongs to (sub-fund of an umbrella…) → RCS legal form → the name.
 *   Pure function; recomputeCompany() feeds it and writes the result on core.companies.
 * WHERE IT RUNS: engine workers and the admin console (through recomputeCompany).
 */

import type { CompanyKind, FundLaw, FundRegime, FundRole, GroupRole, LegalVehicle, ManagerType } from "../enums";

/** Kind: type alias. What the fund profile looks at. */
export type FundProfileInput = {
  name: string;
  /** Golden legal form (RCS, GLEIF text), e.g. "Société en commandite spéciale". */
  legalForm?: string | null;
  /** CSSF entity types of the linked CSSF records, e.g. ["OPC"], ["C15", "AIFM_AUT"]. */
  cssfTypes: string[];
  /** CSSF groups and sub-groups, e.g. ["OPCLUX_1"], ["OPCLUX_1_2"], ["FIS2-SICAV"], ["C15_SUCC"]. */
  cssfGroups: string[];
  cssfSubGroups: string[];
  /** How many sub-funds (compartments) the CSSF lists for this fund. */
  compartments?: number;
  /** GLEIF entity category ("FUND", "GENERAL", "BRANCH") and legal-form text ("SUB-FUND", "FONDS COMMUN DE PLACEMENT"). */
  gleifCategory?: string | null;
  gleifLegalForm?: string | null;
  /** The company's role in its fund structure group (from core.company_group_members), if any. */
  structureRole?: GroupRole | null;
  /** The umbrella / master fund's profile, inherited by sub-funds that have no evidence of their own. */
  parentFund?: { fundRegime: FundRegime | null; fundLaw: FundLaw | null } | null;
};

/** Kind: type alias. The result written to core.companies (null = does not apply / unknown). */
export type FundProfile = {
  isFund: boolean;
  fundRegime: FundRegime | null;
  fundLaw: FundLaw | null;
  legalVehicle: LegalVehicle | null;
  fundRole: FundRole | null;
  managerType: ManagerType | null;
  /** The kind this profile implies, or null to keep the rule-based kind. */
  kind: CompanyKind | null;
  /** Short explanation for the console, e.g. ["CSSF OPCLUX_1 → UCITS", "name: SICAV"]. */
  evidence: string[];
};

/** Kind: function. Lower case, accents removed, punctuation → spaces, so patterns stay simple. */
export const plain = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,'’()\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Kind: constant. Legal-vehicle patterns, tried in order on plain() text (full French names first, then the
 * abbreviations as they appear at the end of names: "s a r l", "scsp", "s a"…).
 */
const VEHICLE_PATTERNS: [LegalVehicle, RegExp][] = [
  ["fcp", /fonds commun de placement|\bfcp\b/],
  ["sicav", /capital variable|\bsicav\b/],
  ["sicaf", /capital fixe|\bsicaf\b/],
  ["scsp", /commandite speciale|\bscsp\b|\bs c sp\b|\bscs p\b/],
  ["sca", /commandite par actions|\bsca\b|\bs c a\b|\bs ca\b/],
  ["scs", /commandite simple|\bscs\b|\bs c s\b/],
  ["sarl", /responsabilite limitee|\bs a r l\b|\bsarl\b|\bs a rl\b|\bs ar l\b|\bsa r l\b|\bsarl s\b|\bs a r l s\b/],
  ["sas", /actions simplifiee|\bsas\b|\bs a s\b/],
  ["scoop", /cooperative|\bscoop\b|\bsc\b$/],
  ["sa", /societe anonyme|\bs a\b|\bsa\b|\bag\b$/],
  // Last: "… Sub Fund SCSp" is an SCSp; only a name with no legal form at all is taken as a sub-fund.
  ["sub_fund", /\bsub fund\b|\bcompartiment\b/],
];

/** Kind: function. The vehicle a text names, or null. */
export function vehicleOf(text: string | null | undefined): LegalVehicle | null {
  const t = plain(text);
  if (!t) return null;
  for (const [v, re] of VEHICLE_PATTERNS) if (re.test(t)) return v;
  return null;
}

/** Kind: function. CSSF fund sub-group → vehicle (OPCLUX_x_1 = FCP, _2 = SICAV, _3 = other UCI; FIS1/2/3). */
export function vehicleOfCssfGroup(subGroups: string[], groups: string[]): LegalVehicle | null {
  for (const g of [...subGroups, ...groups]) {
    if (/^OPCLUX_\d_1$/.test(g) || g === "FIS1-FCP") return "fcp";
    if (/^OPCLUX_\d_2$/.test(g) || g === "FIS2-SICAV") return "sicav";
    if (g === "FIS3-SICAF") return "sicaf";
  }
  return null;
}

const GP = /\b(gp|general partner|associe commandite|associe gerant commandite|gerant commandite|managing gp|comandite)\b/;
const SPV = /\b(spv|topco|holdco|bidco|midco|propco|finco|investco|acquico|debtco|lux ?co \d+|luxco)\b/;
const RAIF = /\b(raif|fiar)\b|reserved alternative investment fund|fonds d investissement alternatif reserve/;
const SICAR = /\bsicar\b|capital a risque/;
const SIF = /\b(sif|fis)\b|specialised investment fund|fonds d investissement specialise/;
const FUNDISH = /\b(fund|funds|fonds|sicav|sicaf|fcp|sicar|raif|fiar|ucits|opcvm)\b/;
/** Words that mean "the company around the fund", not the fund itself. */
const NOT_FUND = /\b(management|manager|managers|advisors?|advisory|services|gp|general partner|consulting|administration|partners? s a r l)\b/;

const CSSF_FUND_TYPES = new Set(["OPC", "FIS", "SIC"]);

/**
 * Kind: function. Derives the fund profile.
 * @param i  type `FundProfileInput`.
 * @returns  `FundProfile`.
 */
export function fundProfile(i: FundProfileInput): FundProfile {
  const ev: string[] = [];
  const name = plain(i.name);
  const types = new Set(i.cssfTypes);
  const groups = [...i.cssfGroups, ...i.cssfSubGroups];
  const gleifForm = plain(i.gleifLegalForm);

  // ---- manager licence (CSSF types)
  let managerType: ManagerType | null = null;
  if (types.has("C15") && groups.includes("C15_SUCC")) managerType = "manco_branch";
  else if (types.has("C15") && types.has("AIFM_AUT")) managerType = "super_manco";
  else if (types.has("C15")) managerType = "ucits_manco";
  else if (types.has("AIFM_AUT")) managerType = "aifm_authorised";
  else if (types.has("C16")) managerType = "manco_ch16";
  else if (types.has("AIFM_REG_LU_OTHER_EU_MEMBER_STATE")) managerType = "aifm_branch";
  else if (types.has("AIFM_REG")) managerType = "aifm_registered";
  if (managerType) ev.push(`CSSF ${[...types].filter((t) => /^(C1[56]|AIFM)/.test(t)).join(" + ")} → ${managerType}`);

  // ---- regime and law
  let fundRegime: FundRegime | null = null;
  let fundLaw: FundLaw | null = null;
  const set = (r: FundRegime, l: FundLaw | null, why: string) => {
    if (fundLaw) return;
    fundRegime = r;
    fundLaw = l;
    ev.push(why);
  };
  if (types.has("OPC")) {
    if (groups.some((g) => g.startsWith("OPCLUX_1"))) set("ucits", "ucits_part_i", "CSSF UCI Part I → UCITS");
    else if (groups.some((g) => g.startsWith("OPCLUX_2"))) set("aif", "uci_part_ii", "CSSF UCI Part II → AIF");
    else set("other", null, "CSSF UCI (2010 Law)");
  }
  if (types.has("FIS")) set("aif", "sif", "CSSF SIF → AIF");
  if (types.has("SIC")) set("aif", "sicar", "CSSF SICAR → AIF");
  if (types.has("TIT")) set("other", "securitisation", "CSSF securitisation undertaking");
  if (types.has("PF")) set("other", "pension", "CSSF pension fund");
  if (!fundLaw && (RAIF.test(name) || RAIF.test(plain(i.legalForm)))) set("aif", "raif", "name: RAIF");
  if (!fundLaw && SICAR.test(name)) set("aif", "sicar", "name: SICAR");
  if (!fundLaw && SIF.test(name)) set("aif", "sif", "name: SIF");

  // ---- is it a fund?
  const cssfFund = [...types].some((t) => CSSF_FUND_TYPES.has(t));
  const gleifFund = i.gleifCategory === "FUND";
  const structureFund = !!i.structureRole && ["sub_fund", "umbrella_fund", "master_fund", "feeder_fund", "managed_fund"].includes(i.structureRole);
  const nameFund = !managerType && FUNDISH.test(name) && !NOT_FUND.test(name);
  const isFund = cssfFund || gleifFund || structureFund || !!fundLaw && fundLaw !== "securitisation" && fundLaw !== "pension" || nameFund;
  if (gleifFund && !cssfFund) ev.push("GLEIF category FUND");
  if (nameFund && !cssfFund && !gleifFund) ev.push("name looks like a fund");

  // ---- legal vehicle: for funds the CSSF sub-group is the most precise; otherwise legal form, GLEIF form, name.
  let legalVehicle: LegalVehicle | null = null;
  if (gleifForm === "sub fund" || i.structureRole === "sub_fund") legalVehicle = "sub_fund";
  if (!legalVehicle && isFund) legalVehicle = vehicleOfCssfGroup(i.cssfSubGroups, i.cssfGroups);
  if (!legalVehicle && isFund && /\bsicav\b/.test(name)) legalVehicle = "sicav";
  legalVehicle ??= vehicleOf(i.legalForm) ?? vehicleOf(i.gleifLegalForm) ?? vehicleOf(i.name);

  // ---- role in a fund structure
  let fundRole: FundRole | null = null;
  const fromGroup: Partial<Record<GroupRole, FundRole>> = {
    sub_fund: "sub_fund",
    feeder_fund: "feeder_fund",
    master_fund: "master_fund",
    umbrella_fund: "umbrella_fund",
    general_partner: "general_partner",
    spv: "spv",
    holding: "holding",
  };
  if (i.structureRole && fromGroup[i.structureRole]) {
    fundRole = fromGroup[i.structureRole]!;
    ev.push(`group role: ${i.structureRole}`);
  } else if (legalVehicle === "sub_fund") fundRole = "sub_fund";
  else if (isFund) fundRole = (i.compartments ?? 0) > 0 ? "umbrella_fund" : "standalone_fund";
  else if (!managerType && types.size === 0 && GP.test(name)) {
    fundRole = "general_partner";
    ev.push("name: general partner");
  } else if (!managerType && types.size === 0 && SPV.test(name)) {
    fundRole = "spv";
    ev.push("name: SPV");
  }

  // Sub-funds / feeders without evidence of their own take the umbrella's regime and law.
  if (!fundLaw && i.parentFund && (fundRole === "sub_fund" || fundRole === "feeder_fund")) {
    fundRegime = i.parentFund.fundRegime;
    fundLaw = i.parentFund.fundLaw;
    if (fundRegime || fundLaw) ev.push("inherited from umbrella");
  }
  // Every fund that is not UCITS is an AIF (UCITS are always on the CSSF Part I list).
  if (isFund && !fundRegime && !["securitisation", "pension"].includes(fundLaw ?? "")) {
    fundRegime = "aif";
    ev.push("fund not on the CSSF UCITS list → AIF");
  }

  let kind: CompanyKind | null = null;
  if (managerType) kind = "asset_manager";
  else if (fundRole && ["general_partner", "spv", "holding"].includes(fundRole)) kind = "fund_vehicle";
  else if (isFund) kind = "fund";

  return {
    isFund,
    fundRegime: isFund || fundRole === "general_partner" || fundRole === "spv" || fundRole === "holding" ? fundRegime : null,
    // Securitisation undertakings and pension funds keep their law even though they are not investment funds.
    fundLaw: isFund || fundLaw === "securitisation" || fundLaw === "pension" ? fundLaw : null,
    legalVehicle,
    fundRole,
    managerType,
    kind,
    evidence: ev,
  };
}

/**
 * Kind: function. Final company kind: the rule-based kind, unless the fund profile is more specific. Regulated
 * kinds from the CSSF rules (bank, service provider, financial institution) are never overridden.
 */
export function mergeKind(ruleKind: CompanyKind, profile: FundProfile): CompanyKind {
  if (!profile.kind) return ruleKind;
  if (ruleKind === "corporate" || ruleKind === "other") return profile.kind;
  if (ruleKind === "fund" && profile.kind === "fund") return "fund";
  if (ruleKind === "asset_manager" || profile.kind === "asset_manager") return "asset_manager";
  return ruleKind;
}
