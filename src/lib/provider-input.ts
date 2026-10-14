import { z } from "zod";
import { sql } from "drizzle-orm";
import { CATEGORIES, PROVIDER_TYPES, providers, type NewProvider, type ProviderStatus } from "@/db/schema";
import { slugify } from "./format";

const stringList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split("|")).map((s) => s.trim()).filter(Boolean))
  .default([]);

const optionalString = z
  .string()
  .trim()
  .transform((v) => v || undefined)
  .optional();

/** Validates one provider record coming from JSON or CSV. */
export const providerInputSchema = z
  .object({
    name: z.string().trim().min(2),
    slug: optionalString,
    category: z.enum(CATEGORIES),
    providerType: z.enum(PROVIDER_TYPES),
    headcount: z.coerce.number().int().positive(),
    mandates: z.coerce.number().int().min(0).default(0),
    techStack: stringList,
    topClients: stringList,
    regulatoryScope: stringList,
    services: stringList,
    tags: stringList,
    priceMin: z.coerce.number().int().positive(),
    priceMax: z.coerce.number().int().positive(),
    rating: z.coerce.number().min(0).max(5).default(0),
    reviewCount: z.coerce.number().int().min(0).default(0),
    verified: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || ["true", "yes", "1"].includes(String(v).toLowerCase()))
      .default(false),
    rcsNumber: optionalString,
    foundedYear: z.coerce.number().int().min(1800).max(2100).optional().catch(undefined),
    headquarters: z.string().trim().default("Luxembourg"),
    website: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
    description: z.string().trim().default(""),
  })
  .refine((p) => p.priceMin <= p.priceMax, { message: "priceMin must be <= priceMax", path: ["priceMin"] });

export type ProviderInput = z.infer<typeof providerInputSchema>;

export function toNewProvider(input: ProviderInput, status: ProviderStatus): NewProvider {
  return { ...input, slug: input.slug ?? slugify(input.name), status };
}

/** Insert-or-update by slug. Returns the number of rows written. */
export async function upsertProviders(
  // Accept any drizzle libsql database instance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  rows: NewProvider[],
): Promise<number> {
  if (!rows.length) return 0;
  await database
    .insert(providers)
    .values(rows)
    .onConflictDoUpdate({
      target: providers.slug,
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        providerType: sql`excluded.provider_type`,
        headcount: sql`excluded.headcount`,
        mandates: sql`excluded.mandates`,
        techStack: sql`excluded.tech_stack`,
        topClients: sql`excluded.top_clients`,
        regulatoryScope: sql`excluded.regulatory_scope`,
        services: sql`excluded.services`,
        tags: sql`excluded.tags`,
        priceMin: sql`excluded.price_min`,
        priceMax: sql`excluded.price_max`,
        rating: sql`excluded.rating`,
        reviewCount: sql`excluded.review_count`,
        verified: sql`excluded.verified`,
        rcsNumber: sql`excluded.rcs_number`,
        foundedYear: sql`excluded.founded_year`,
        headquarters: sql`excluded.headquarters`,
        website: sql`excluded.website`,
        description: sql`excluded.description`,
        status: sql`excluded.status`,
        updatedAt: sql`(unixepoch())`,
      },
    });
  return rows.length;
}
