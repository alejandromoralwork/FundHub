"use server";
/**
 * FILE: apps/web/src/lib/account-actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Server actions for provider accounts on the website:
 *   1. `submitClaim` — "this company is mine": claim an existing provider profile, or propose a new company.
 *      FundHub staff then approve or reject the claim in the console.
 *   2. `updateProviderProfile` — a provider with an approved claim edits the factual parts of its public profile.
 *      Every saved change is also recorded (old value → new value) in the `profile_edits` table for audit.
 * WHERE IT RUNS: on the server (it checks permissions and writes to the database).
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line, must stay first): every exported async function in the file becomes a server
 *     action that a browser form can call; Next.js runs it on the server and returns the result to the form.
 *   - With React's `useActionState`, an action receives `(previousState, formData)` and returns the new state.
 *   - `revalidatePath(path)` = tell Next.js that page's cached copy is out of date.
 *   - Zod (`z`) schemas describe and check the form data. Methods used here: `z.object`, `z.string().trim()`,
 *     `.min/.max`, `.url()`, `z.enum`, `z.literal`, `z.union` (one of several shapes), `z.discriminatedUnion`,
 *     `z.coerce.number()` (turn the text "42" into the number 42), `.default`, `.transform`, `.refine`.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases and `Record<K, V>`; `Partial<T>` = "T with every field optional"; `unknown` = "any value,
 *     but you must check it before use"; `keyof T` = "one of T's field names".
 *   - generics `<T extends string>` = "a function that works for any kind of text type T".
 *   - `readonly T[]`, tuple type `[T, ...T[]]` = "at least one T"; `as const` = "freeze this list's exact values".
 *   - destructuring with rest `const { a, b, ...d } = obj` = take a and b out, put everything else into d.
 *   - spread `[...a, ...b]`, `new Set(list)` (removes duplicates); `for (const [k, v] of Object.entries(o))`.
 */

// `import { a } from "b"` loads named things from module b.
// Drizzle ORM helpers: `and` (both conditions), `eq` (equals).
import { and, eq } from "drizzle-orm";
// Next.js: mark a page as outdated so it is rebuilt with fresh data.
import { revalidatePath } from "next/cache";
// Zod, the validation library.
import { z } from "zod";
// `@fundhub/...` = our shared packages in packages/. The database connection:
import { db } from "@fundhub/db/client";
// From the database package: lists of allowed values (in CAPITALS, e.g. LICENCES), the tables
// `profileEdits`, `providerClaims`, `providers`, and the `Provider` type (one row of `providers`).
import {
  ASSET_CLASSES,
  CERTIFICATIONS,
  LICENCES,
  PROVIDER_TYPES,
  profileEdits,
  providerClaims,
  providers,
  REGULATORY_SCOPES,
  TECH_STACKS,
  type Provider,
} from "@fundhub/db/schema";
// Permission helpers: "must be logged in" and "may this user edit this provider?".
import { canManageProvider, requireUser } from "./auth/session";
// The service taxonomy: every known service name, and the service category slugs.
import { ALL_SERVICES, CATEGORY_SLUGS } from "@fundhub/core/taxonomy";

/**
 * Kind: type alias. What these actions return for the form to show: a success message (`ok`), an `error`, and/or
 * one message per field (`fieldErrors`). All fields are optional.
 */
export type ActionState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };

/**
 * Kind: function (internal helper).
 * @param issues  type `z.core.$ZodIssue[]` — Zod's list of validation problems (each with a field `path` and `message`).
 * @returns       `Record<string, string>`: the first message for each field, e.g. `{ jobTitle: "Enter your job title" }`.
 */
function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  // `??=` = assign only if empty, so the first message per field wins.
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

// ---------------------------------------------------------------- claims

/**
 * Kind: constant (Zod discriminated union schema).
 * The claim form has two modes, told apart by the "mode" field (the "discriminator"):
 * - "existing": the company is already listed → we need its `providerId` (form text coerced to a positive
 *   whole number) and the person's job title;
 * - "new": the company is not listed yet → we need its proposed name, main category and website.
 * Zod picks the right set of rules by looking at "mode" first.
 */
const claimSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    providerId: z.coerce.number().int().positive({ message: "Choose your company" }),
    jobTitle: z.string().trim().min(2, "Enter your job title").max(120),
    message: z.string().trim().max(2000).default(""),
  }),
  z.object({
    mode: z.literal("new"),
    proposedName: z.string().trim().min(2, "Enter the company name").max(160),
    proposedCategory: z.enum(CATEGORY_SLUGS, { message: "Choose the main service category" }),
    proposedWebsite: z.string().trim().url("Enter a full URL, e.g. https://example.lu").max(300),
    jobTitle: z.string().trim().min(2, "Enter your job title").max(120),
    message: z.string().trim().max(2000).default(""),
  }),
]);

/**
 * Kind: server action (async function), used by the "Claim your company" form on the account page.
 * @param _prev     type `ActionState` — previous form state, unused (hence the underscore).
 * @param formData  type `FormData` — the submitted form fields.
 * @returns         `Promise<ActionState>`: errors, or a success message.
 */
export async function submitClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  // Anonymous visitors are redirected to the login page.
  const user = await requireUser();
  // `Object.fromEntries(formData)` turns the form into a plain object for Zod to check.
  const parsed = claimSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues) };
  const d = parsed.data;

  // Checking `d.mode` also tells TypeScript which fields exist ("narrowing"): inside this branch `d.providerId`
  // is known to be there; in the `else` branch `d.proposedName` etc. are.
  if (d.mode === "existing") {
    // Has this user already claimed this company? (Prevents duplicate claims.)
    const [existing] = await db
      .select({ id: providerClaims.id })
      .from(providerClaims)
      .where(and(eq(providerClaims.userId, user.id), eq(providerClaims.providerId, d.providerId)));
    if (existing) return { error: "You already have a claim for this company." };
    // Save the claim; its status starts as "pending" (the database default) until staff review it.
    await db.insert(providerClaims).values({
      userId: user.id,
      providerId: d.providerId,
      jobTitle: d.jobTitle,
      message: d.message,
    });
  } else {
    // A claim for a company not yet in FundHub: no providerId, but the proposed details instead.
    await db.insert(providerClaims).values({
      userId: user.id,
      proposedName: d.proposedName,
      proposedCategory: d.proposedCategory,
      proposedWebsite: d.proposedWebsite,
      jobTitle: d.jobTitle,
      message: d.message,
    });
  }
  // The account page lists the user's claims, so refresh it.
  revalidatePath("/account");
  return { ok: "Claim submitted. FundHub will confirm it, usually within two business days." };
}

// ---------------------------------------------------------------- profile edits

/**
 * Textarea lists: one item per line (commas also accepted).
 * Kind: constant (Zod schema with a transform). Turns the text of a multi-line box into a clean list:
 * `.split(/[\n,]/)` cuts at every new line or comma (a regular expression: "\n or ,"), `.map(trim)` removes
 * spaces, `.filter(Boolean)` drops empty entries, `.slice(0, 30)` keeps at most 30 items.
 * E.g. "Apex, Acme\nBeta" → ["Apex", "Acme", "Beta"].
 */
const lines = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30),
  );

/**
 * Kind: generic arrow function that builds a Zod schema.
 * @param allowed  type `readonly T[]` — a fixed list of allowed values (e.g. LICENCES).
 * @returns        a Zod schema for "a list of values, each one from `allowed`", defaulting to an empty list.
 * `<T extends string>` lets TypeScript keep the exact allowed texts, so the result type is e.g.
 * `("Authorised AIFM" | "Chapter 15 ManCo" | …)[]` instead of just `string[]`.
 * `z.enum` insists on a non-empty list, written as the tuple type `[T, ...T[]]`; `as` tells TypeScript to treat our list that way.
 */
const pick = <T extends string>(allowed: readonly T[]) => z.array(z.enum(allowed as [T, ...T[]])).default([]);

/**
 * Only factual fields. Fees, scores, reviews, Verified and the primary category stay FundHub-controlled.
 * Kind: constant (Zod object schema) — the rules for the profile edit form. Notable parts:
 * - `z.union([z.literal(""), …])` = either left empty, or a valid value (used for optional website and year);
 * - `z.coerce.number()` = form fields are text, so convert to numbers first, then check `.int()` (whole), ranges;
 * - `100_000` = 100000 (underscore only for readability); `new Date().getFullYear()` = this year;
 * - `.refine(test, message)` = a custom rule: every service must be a known one, and at least one is required;
 * - `pick(LIST)` = multi-select checkboxes limited to that list; `lines` = free text box turned into a list.
 */
const profileSchema = z.object({
  description: z.string().trim().max(1200).default(""),
  website: z.union([z.literal(""), z.string().trim().url("Enter a full URL, e.g. https://example.lu").max(300)]),
  headquarters: z.string().trim().min(2, "Enter your Luxembourg address/area").max(160),
  providerType: z.enum(PROVIDER_TYPES),
  headcount: z.coerce.number().int().positive("Enter your local headcount").max(100_000),
  mandates: z.coerce.number().int().min(0).max(100_000),
  foundedYear: z.union([z.literal(""), z.coerce.number().int().min(1800).max(new Date().getFullYear())]),
  services: z
    .array(z.string())
    .default([])
    .refine((l) => l.every((s) => ALL_SERVICES.includes(s)), "Unknown service")
    .refine((l) => l.length > 0, "Select at least one service"),
  secondaryCategories: pick(CATEGORY_SLUGS),
  techStack: pick(TECH_STACKS),
  otherTech: lines,
  regulatoryScope: pick(REGULATORY_SCOPES),
  assetClasses: pick(ASSET_CLASSES),
  licences: pick(LICENCES),
  certifications: pick(CERTIFICATIONS),
  topClients: lines,
  footprint: lines,
  tags: lines,
});

/**
 * Kind: constant (read-only list). The form fields that are groups of checkboxes and so can send several values
 * under the same name. `as const` freezes the list and keeps each exact name as its own type.
 */
const LIST_FIELDS = [
  "services",
  "secondaryCategories",
  "techStack",
  "regulatoryScope",
  "assetClasses",
  "licences",
  "certifications",
] as const;

/**
 * Kind: server action (async function), used by the profile edit form.
 * @param _prev     type `ActionState` — previous form state, unused.
 * @param formData  type `FormData` — the edit form, including the hidden field "providerId".
 * @returns         `Promise<ActionState>`: errors, "No changes to save.", or how many changes were saved.
 */
export async function updateProviderProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const providerId = Number(formData.get("providerId"));
  // Permission check on the server: never trust that the form was only shown to the right person.
  if (!providerId || !(await canManageProvider(user, providerId))) return { error: "You can't edit this profile." };

  // `Object.fromEntries` keeps only ONE value per field name, so for checkbox groups we replace it with
  // `formData.getAll(name)`, which returns every ticked value as a list.
  const raw: Record<string, unknown> = Object.fromEntries(formData);
  for (const f of LIST_FIELDS) raw[f] = formData.getAll(f);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };

  // Load the profile as it is now, to compare against and to know its slug and main category.
  const [current] = await db.select().from(providers).where(eq(providers.id, providerId));
  if (!current) return { error: "Profile not found." };

  // Take out the fields that need special handling; `d` holds all the rest unchanged.
  const { otherTech, website, foundedYear, ...d } = parsed.data;
  // `Partial<Provider>` = an object with some (not necessarily all) provider columns: the new values.
  const next: Partial<Provider> = {
    ...d,
    // The primary category is implied, so it isn't stored as secondary too.
    secondaryCategories: d.secondaryCategories.filter((c) => c !== current.category),
    // Merge ticked tools with the free-text "other" tools; `new Set` removes duplicates, `[...set]` makes a list.
    techStack: [...new Set([...d.techStack, ...otherTech])],
    // Empty website / year are stored as `null` ("no value") rather than empty text.
    website: website || null,
    foundedYear: foundedYear === "" ? null : foundedYear,
  };

  // Build the audit record: for every field whose value really changed, remember `{ from, to }`.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  // `Object.entries(next)` = list of [fieldName, value] pairs.
  for (const [k, v] of Object.entries(next)) {
    // `k as keyof Provider` tells TypeScript that k is a valid column name of Provider.
    const before = current[k as keyof Provider];
    // Comparing as JSON text also works for lists (two different lists with the same items count as equal).
    if (JSON.stringify(before) !== JSON.stringify(v)) changes[k] = { from: before, to: v };
  }
  // `Object.keys(changes).length` = number of changed fields; `!0` is true, so "nothing changed" returns early.
  if (!Object.keys(changes).length) return { ok: "No changes to save." };

  // Save the new values and note when the provider itself last updated its profile.
  await db
    .update(providers)
    .set({ ...next, providerUpdatedAt: new Date() })
    .where(eq(providers.id, providerId));
  // Record who changed what, for staff review in the console.
  await db.insert(profileEdits).values({ providerId, userId: user.id, changes });

  // Rebuild the public profile page with the new data.
  revalidatePath(`/providers/${current.slug}`);
  return { ok: `Saved ${Object.keys(changes).length} change(s). Your public profile is updated.` };
}
