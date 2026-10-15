import { z } from "zod";
import { ASSET_CLASSES, LICENCES, PROVIDER_TYPES, REGULATORY_SCOPES, TECH_STACKS } from "./enums";
import { ALL_SERVICES, CATEGORY_SLUGS } from "./taxonomy";

export const PRICE_FLOOR = 500;
export const PRICE_CEILING = 6000;
export const DENSITY_CEILING = 150;

export const SCALE_BANDS = {
  "1-50": { label: "1–50", min: 1, max: 50 },
  "51-250": { label: "51–250", min: 51, max: 250 },
  "251-1000": { label: "251–1,000", min: 251, max: 1000 },
  "1000+": { label: "1,000+", min: 1001, max: Number.MAX_SAFE_INTEGER },
} as const;
export type ScaleBand = keyof typeof SCALE_BANDS;

export const SORTS = {
  score: "Peer Opinion Score",
  fee: "Lowest Fee",
  headcount: "Headcount",
} as const;
export type Sort = keyof typeof SORTS;

/** Comma-separated list, keeping only allowed values. */
function csvOf<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is T => (allowed as readonly string[]).includes(s)),
    );
}

const optionalInt = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().catch(undefined);

const filterSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  category: z.enum(CATEGORY_SLUGS).optional().catch(undefined),
  service: csvOf(ALL_SERVICES).catch([]),
  asset: csvOf(ASSET_CLASSES).catch([]),
  licence: csvOf(LICENCES).catch([]),
  scale: z.enum(Object.keys(SCALE_BANDS) as [ScaleBand, ...ScaleBand[]]).optional().catch(undefined),
  stack: csvOf(TECH_STACKS).catch([]),
  type: csvOf(PROVIDER_TYPES).catch([]),
  reg: csvOf(REGULATORY_SCOPES).catch([]),
  min: optionalInt(0, PRICE_CEILING),
  max: optionalInt(0, PRICE_CEILING),
  density: optionalInt(0, DENSITY_CEILING),
  sort: z.enum(Object.keys(SORTS) as [Sort, ...Sort[]]).catch("score"),
});

export type ProviderFilters = z.infer<typeof filterSchema>;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseFilters(raw: RawSearchParams): ProviderFilters {
  const flat = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v || undefined]),
  );
  return filterSchema.parse(flat);
}
