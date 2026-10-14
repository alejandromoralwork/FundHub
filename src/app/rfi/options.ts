export const FUND_STRUCTURES = ["RAIF", "SIF", "SICAV (UCITS)", "SICAR", "SCSp / SCS", "ELTIF", "Other"] as const;

/** Stored value → display label. ASCII values keep form posts encoding-safe. */
export const AUM_BAND_LABELS = {
  "lt-100m": "< €100m",
  "100m-250m": "€100m – €250m",
  "250m-1bn": "€250m – €1bn",
  "1bn-5bn": "€1bn – €5bn",
  "gt-5bn": "> €5bn",
} as const;
export type AumBand = keyof typeof AUM_BAND_LABELS;
export const AUM_BANDS = Object.keys(AUM_BAND_LABELS) as [AumBand, ...AumBand[]];

export const RFI_SERVICES = [
  "Central administration",
  "Depositary",
  "Transfer agency",
  "AML/KYC",
  "RC / MLRO",
  "Regulatory reporting",
  "Tax compliance",
  "Transfer pricing",
  "Fund formation (legal)",
  "Independent directors",
  "Valuation / risk",
  "Third-party AIFM / ManCo",
] as const;
