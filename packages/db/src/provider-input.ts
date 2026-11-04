/**
 * FILE: packages/db/src/provider-input.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: The rules for a valid service-provider record coming from outside (a CSV or JSON file, or
 *   a form), a helper that turns a checked record into a database row, and a helper that writes many rows
 *   at once, updating providers that already exist (matched by slug) instead of duplicating them.
 * WHERE IT RUNS: on the server only (Node.js): the import/seed scripts and the console use it.
 * FRAMEWORK NOTES: Zod is a validation library. You describe the expected shape once (`z.object({...})`),
 *   and Zod both checks incoming data and gives TypeScript the matching type (`z.infer`). Methods chain:
 *   `z.string().trim().min(2)` = "a text, spaces trimmed, at least 2 characters". `.transform(fn)` changes
 *   the value after checking; `.default(x)` fills in x when missing; `.optional()` allows it to be missing;
 *   `z.coerce.number()` converts text such as "12" into the number 12 first (CSV fields are always text).
 * TYPESCRIPT YOU WILL SEE HERE: `type` imports, `z.infer<typeof schema>` (a type derived from a value),
 *   arrow functions, ternary `c ? a : b`, spread `{ ...obj }`, `??`, `any` (switches off type checking),
 *   `Promise<number>`, Drizzle's `sql`…`` tag.
 */

// `import { a } from "b"`: bring named items from another module. Plain names (zod, drizzle-orm) are npm
// libraries; `@fundhub/…` are our own shared packages in packages/; "./schema" is a file in this folder.
// Zod: the validation library (see above).
import { z } from "zod";
// Drizzle's raw-SQL helper, used below to refer to "the value we tried to insert".
import { sql } from "drizzle-orm";
// slugify("Lumen Fund Services S.A.") -> "lumen-fund-services-s-a": a URL-friendly name.
import { slugify } from "@fundhub/core/format";
// The official list of service names and category slugs, so imports cannot invent new ones.
import { ALL_SERVICES, CATEGORY_SLUGS } from "@fundhub/core/taxonomy";
// From our table definitions: allowed provider types, the providers table, the insert-row type, and the
// allowed status values ("staged" | "published" …). `type X` means "import only the type, not code".
import { PROVIDER_TYPES, providers, type NewProvider, type ProviderStatus } from "./schema";

/**
 * Kind: constant (a reusable Zod rule).
 * Accepts either a real list of texts (from JSON) or one text with items separated by "|" (from CSV), and
 * always produces a clean list: each item trimmed, blank items removed (`.filter(Boolean)` drops empty
 * texts). Missing -> empty list [].
 * `z.union([A, B])` = "either A or B". `Array.isArray(v)` tests whether v is already a list.
 */
const stringList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split("|")).map((s) => s.trim()).filter(Boolean))
  .default([]);

/**
 * Kind: constant (a reusable Zod rule).
 * An optional text where an empty text counts as "not given": `v || undefined` returns v if it is
 * non-empty, otherwise undefined (`||` picks the right side when the left is empty/false).
 */
const optionalString = z
  .string()
  .trim()
  .transform((v) => v || undefined)
  .optional();

/** Validates one provider record coming from JSON or CSV. */
/**
 * Kind: constant (a Zod object schema). Each key is a field name; its value is the rule for that field.
 * Notable rules:
 * - `z.enum(LIST)`: the value must be one of the texts in LIST.
 * - `stringList.pipe(z.array(z.enum(...)))`: first clean the list, then check every item is a known category.
 * - `.int().positive()`: a whole number above 0; `.min(0)`/`.max(5)`: lower/upper limits.
 * - `.refine(test, { message })`: a custom rule; fails with the message when test returns false.
 * - `.catch(undefined)`: if the value is invalid, quietly use undefined instead of rejecting the record.
 * - `verified`: true for a real true, or the texts "true", "yes", "1" in any letter case.
 * - `website`: a valid URL, or an empty text which becomes undefined (`.or(...)` = "or this other rule").
 * The final `.refine` checks the two prices together: the minimum may not exceed the maximum. `path`
 * says which field the error message belongs to.
 */
export const providerInputSchema = z
  .object({
    name: z.string().trim().min(2),
    slug: optionalString,
    category: z.enum(CATEGORY_SLUGS),
    secondaryCategories: stringList.pipe(z.array(z.enum(CATEGORY_SLUGS))),
    providerType: z.enum(PROVIDER_TYPES),
    headcount: z.coerce.number().int().positive(),
    mandates: z.coerce.number().int().min(0).default(0),
    techStack: stringList,
    topClients: stringList,
    regulatoryScope: stringList,
    // `.every(test)` = true only if every item passes; `.includes(s)` = "is s in the official list?".
    services: stringList.refine((list) => list.every((s) => ALL_SERVICES.includes(s)), {
      message: "services must use the canonical names from src/lib/taxonomy.ts",
    }),
    tags: stringList,
    assetClasses: stringList,
    licences: stringList,
    certifications: stringList,
    footprint: stringList,
    // Typical quarterly fee range in euros, whole numbers (see the providers table in schema.ts).
    priceMin: z.coerce.number().int().positive(),
    priceMax: z.coerce.number().int().positive(),
    setupFee: z.coerce.number().int().positive().optional().catch(undefined),
    rating: z.coerce.number().min(0).max(5).default(0),
    reviewCount: z.coerce.number().int().min(0).default(0),
    verified: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || ["true", "yes", "1"].includes(String(v).toLowerCase()))
      .default(false),
    // RCS = Luxembourg's trade and companies register number.
    rcsNumber: optionalString,
    foundedYear: z.coerce.number().int().min(1800).max(2100).optional().catch(undefined),
    headquarters: z.string().trim().default("Luxembourg"),
    website: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
    description: z.string().trim().default(""),
  })
  .refine((p) => p.priceMin <= p.priceMax, { message: "priceMin must be <= priceMax", path: ["priceMin"] });

/**
 * Kind: type alias. `z.infer<typeof providerInputSchema>` asks Zod for the TypeScript type of a record
 * *after* validation (lists are real arrays, numbers are numbers, and so on). `typeof x` = "the type of value x".
 */
export type ProviderInput = z.infer<typeof providerInputSchema>;

/**
 * Kind: function.
 * Turns a validated record into a row ready to insert into the providers table.
 * @param input   type `ProviderInput` — a record that passed providerInputSchema.
 * @param status  type `ProviderStatus` — e.g. "staged" (hidden) or "published" (visible on the site).
 * @returns `NewProvider`: the insert-row type that Drizzle derives from the providers table.
 */
export function toNewProvider(input: ProviderInput, status: ProviderStatus): NewProvider {
  return {
    // Spread: copy every field of input into the new object…
    ...input,
    // …then set or override these. No slug given? Make one from the name.
    slug: input.slug ?? slugify(input.name),
    status,
    // If the record says it is verified, stamp "verified now"; otherwise null (never verified).
    lastVerifiedAt: input.verified ? new Date() : null,
  };
}

/** Insert-or-update by slug. Returns the number of rows written. */
/**
 * Kind: async function.
 * Writes all rows in one SQL statement. Roughly:
 *   INSERT INTO providers (…) VALUES (…), (…), …
 *   ON CONFLICT (slug) DO UPDATE SET name = excluded.name, …, updated_at = now()
 * "ON CONFLICT (slug)" works because slug has a unique index (no two providers may share a slug). When a
 * row's slug already exists, Postgres updates that existing row instead. In that update, `excluded` is
 * Postgres's name for "the new row we tried to insert", so `excluded.name` is the incoming name.
 * Note the right-hand names are database column names (snake_case, e.g. price_min), while the keys on the
 * left are the TypeScript property names (camelCase, e.g. priceMin) defined in schema.ts.
 * Fields not listed (id, created_at, …) keep their existing values.
 * @param database  type `any` — the Drizzle database (or a transaction). `any` turns off type checking for
 *                  this parameter, so any database object is accepted; the eslint comment silences the
 *                  linter's warning about using `any`.
 * @param rows      type `NewProvider[]` — the rows to write.
 * @returns `Promise<number>`: how many rows were sent (inserted or updated).
 */
export async function upsertProviders(
  // Accept any drizzle libsql database instance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  rows: NewProvider[],
): Promise<number> {
  // Nothing to write: an INSERT with no values would be an SQL error, so stop early.
  if (!rows.length) return 0;
  await database
    .insert(providers)
    .values(rows)
    .onConflictDoUpdate({
      // The unique column that decides "already exists".
      target: providers.slug,
      // What to change on the existing row. Each sql`excluded.<column>` means "take the incoming value".
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        secondaryCategories: sql`excluded.secondary_categories`,
        providerType: sql`excluded.provider_type`,
        headcount: sql`excluded.headcount`,
        mandates: sql`excluded.mandates`,
        techStack: sql`excluded.tech_stack`,
        topClients: sql`excluded.top_clients`,
        regulatoryScope: sql`excluded.regulatory_scope`,
        services: sql`excluded.services`,
        tags: sql`excluded.tags`,
        assetClasses: sql`excluded.asset_classes`,
        licences: sql`excluded.licences`,
        certifications: sql`excluded.certifications`,
        footprint: sql`excluded.footprint`,
        priceMin: sql`excluded.price_min`,
        priceMax: sql`excluded.price_max`,
        setupFee: sql`excluded.setup_fee`,
        rating: sql`excluded.rating`,
        reviewCount: sql`excluded.review_count`,
        verified: sql`excluded.verified`,
        rcsNumber: sql`excluded.rcs_number`,
        foundedYear: sql`excluded.founded_year`,
        headquarters: sql`excluded.headquarters`,
        website: sql`excluded.website`,
        description: sql`excluded.description`,
        lastVerifiedAt: sql`excluded.last_verified_at`,
        status: sql`excluded.status`,
        // now() = the database's current date and time.
        updatedAt: sql`now()`,
      },
    });
  return rows.length;
}
