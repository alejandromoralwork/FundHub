"use server";
/**
 * FILE: apps/web/src/lib/review-actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The server action behind the "Write a review" form on a provider's page. It validates the review,
 *   blocks reviews by the provider's own staff, adds warning "flags" for FundHub moderators (e.g. a personal Gmail
 *   address), and saves the review. New reviews start as "pending" (the database default) and only appear on the
 *   site after a moderator approves them in the console.
 * WHERE IT RUNS: on the server (it reads and writes the database).
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line, must stay first): exported async functions here are server actions the
 *     browser form can call; Next.js runs them on the server.
 *   - With React's `useActionState`, the action gets `(previousState, formData)` and returns the new state.
 *   - Zod (`z`) describes the form rules; `z.coerce.number()` turns the form's text "4" into the number 4.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - a union type of three shapes told apart by `status` (`"idle" | "error" | "success"`).
 *   - `new Set([...])` = a collection for fast "is this in it?" checks with `.has(x)`.
 *   - `try { … } catch { … }` = run code and handle any error it throws; regular expressions like `/^www\./`.
 *   - destructuring with renaming and rest: `const { attest: _attest, clientSince, ...values } = d`.
 *   - `!` non-null assertion; `?.` optional chaining; `??` nullish coalescing; ternary `a ? b : c`.
 */

// `import { a } from "b"` loads named things from module b. Drizzle helpers `and` (both) and `eq` (equals).
import { and, eq } from "drizzle-orm";
// Zod, the validation library.
import { z } from "zod";
// `@fundhub/...` = our shared packages. Database connection:
import { db } from "@fundhub/db/client";
// The allowed client relationships (a fixed list) and the tables used here.
import { CLIENT_RELATIONSHIPS, providers, reviews, users, providerClaims } from "@fundhub/db/schema";
// Postgres-backed attempt counter, to slow down spam.
import { rateLimit } from "@fundhub/db/rate-limit";
// Who is logged in (reviews can also be written without an account).
import { getCurrentUser } from "./auth/session";
// The visitor's IP address, the key for the rate limit.
import { clientIp } from "./client-ip";

/**
 * Kind: type alias (union of three shapes):
 * - `"idle"`: nothing sent yet; `"success"`: review received;
 * - `"error"`: a general message, one message per field, and the submitted values so the form can be refilled.
 */
export type ReviewFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Record<string, string>; values: Record<string, unknown> }
  | { status: "success" };

/**
 * Kind: constant (a Set of texts). Free/personal email domains. A review from one of these is still accepted,
 * but flagged so a moderator asks for proof that the reviewer really works for a client of the provider.
 */
const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "web.de",
  "pt.lu",
]);

/** Kind: constant (Zod schema). One star rating: a whole number from 1 to 5, reused for every rating below. */
const score = z.coerce.number().int().min(1, "Rate 1–5").max(5);

/**
 * Kind: constant (Zod object schema). The review form's rules. Notable parts:
 * - `clientSince`: empty, or a year between 1950 and this year; `.optional()` = the field may be missing;
 * - five ratings, all using `score`; the text must be 80–4000 characters;
 * - `evidence`: how FundHub can check the reviewer is a real client (kept private, for moderators);
 * - `attest`: the declaration check box must be ticked (a ticked box sends "on").
 */
const reviewSchema = z.object({
  providerId: z.coerce.number().int().positive(),
  reviewerName: z.string().trim().min(2, "Enter your name").max(120),
  reviewerEmail: z.string().trim().toLowerCase().email("Enter your work email").max(200),
  reviewerCompany: z.string().trim().min(2, "Enter your company").max(160),
  reviewerRole: z.string().trim().min(2, "Enter your role").max(120),
  relationship: z.enum(CLIENT_RELATIONSHIPS, { message: "Choose your relationship" }),
  clientSince: z.union([z.literal(""), z.coerce.number().int().min(1950).max(new Date().getFullYear())]).optional(),
  fundStructure: z.string().trim().max(60).default(""),
  overall: score,
  serviceQuality: score,
  responsiveness: score,
  pricingTransparency: score,
  technology: score,
  title: z.string().trim().min(5, "Add a short title").max(120),
  body: z.string().trim().min(80, "Please write at least 80 characters").max(4000),
  evidence: z.string().trim().min(5, "Tell us how we can verify you're a client").max(1000),
  attest: z.literal("on", { message: "Please confirm the declaration" }),
});

/**
 * Kind: constant holding an arrow function.
 * @param emailOrUrl  type `string` — an email ("jane@acme.lu") or a website address ("https://www.acme.lu").
 * @returns           `string`: the bare domain, e.g. "acme.lu", or "" if it cannot be worked out.
 */
const domainOf = (emailOrUrl: string) => {
  try {
    // Email: the part after "@" (`!` = "this exists", since we checked for "@"). Website: let the built-in
    // `URL` class read the host name; it throws an error for text that is not a valid address.
    const host = emailOrUrl.includes("@") ? emailOrUrl.split("@")[1]! : new URL(emailOrUrl).hostname;
    // Lower-case and strip a leading "www." (`^` = "at the start", `\.` = a real dot).
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    // Invalid website address: no domain.
    return "";
  }
};

/**
 * Kind: server action (async function).
 * @param _prev     type `ReviewFormState` — previous form state, unused (the underscore says so).
 * @param formData  type `FormData` — the submitted review form.
 * @returns         `Promise<ReviewFormState>`: an error state, or `{ status: "success" }`.
 */
export async function submitReview(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  // (Honeypot = a field hidden from humans; robots fill it, so we pretend success and save nothing.)
  if (formData.get("website")) return { status: "success" }; // honeypot
  // The form fields as a plain object, used both for checking and for refilling the form after errors.
  const raw = Object.fromEntries(formData);
  // At most 5 reviews per IP address per hour.
  if (!(await rateLimit(`review:${await clientIp()}`, 5, 60 * 60))) {
    return { status: "error", message: "Too many reviews submitted. Please try again later.", fieldErrors: {}, values: raw };
  }
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) {
    // Keep the first message for each field (`??=` = only set it if not set yet).
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values: raw };
  }
  const d = parsed.data;

  // Load the reviewed provider (only the columns we need).
  const [provider] = await db
    .select({ id: providers.id, website: providers.website, slug: providers.slug })
    .from(providers)
    .where(eq(providers.id, d.providerId));
  if (!provider) return { status: "error", message: "Provider not found.", fieldErrors: {}, values: raw };

  const emailDomain = domainOf(d.reviewerEmail);
  // Hard block: nobody may review their own employer.
  // (If the reviewer's email domain equals the provider's website domain, it is the provider's own staff.)
  if (provider.website && domainOf(provider.website) === emailDomain) {
    return {
      status: "error",
      message: "Reviews from the provider's own staff aren't accepted.",
      fieldErrors: { reviewerEmail: "This email belongs to the provider itself" },
      values: raw,
    };
  }
  // Also block anyone with a FundHub account that has claimed this provider (whatever the claim's status).
  // SQL idea: SELECT claim id FROM provider_claims JOIN users ON users.id = claims.user_id
  //           WHERE claims.provider_id = <provider> AND users.email = <reviewer email>
  const [managed] = await db
    .select({ id: providerClaims.id })
    .from(providerClaims)
    .innerJoin(users, eq(users.id, providerClaims.userId))
    .where(and(eq(providerClaims.providerId, provider.id), eq(users.email, d.reviewerEmail)));
  if (managed) {
    return { status: "error", message: "Provider account holders can't review their own company.", fieldErrors: {}, values: raw };
  }

  // Soft warnings for moderators, stored with the review. `.push(x)` adds x to the end of the list.
  const flags: string[] = [];
  if (FREE_MAIL.has(emailDomain)) flags.push("Personal email domain: ask for a work email or other proof");
  // Rough check: does the company name contain the first part of the email domain ("acme" from "acme.lu")?
  if (!d.reviewerCompany.toLowerCase().includes(emailDomain.split(".")[0] ?? "")) {
    flags.push(`Company "${d.reviewerCompany}" doesn't obviously match email domain ${emailDomain}`);
  }

  // Split the data: `attest` is only a check box and is not stored (renamed to `_attest` = "unused");
  // `clientSince` needs converting; `values` = all the remaining fields, ready to store.
  const { attest: _attest, clientSince, ...values } = d;
  try {
    // Link the review to the account if the reviewer is logged in; otherwise `null`.
    const user = await getCurrentUser();
    await db.insert(reviews).values({
      ...values,
      userId: user?.id ?? null,
      // Empty or missing year → `null` (no value) in the database.
      clientSince: clientSince === "" ? null : (clientSince ?? null),
      flags,
    });
  } catch {
    // The database allows one review per provider per email address (a unique index), so a second attempt fails
    // here. Note: any other database error would show this same message.
    return {
      status: "error",
      message: "You've already submitted a review for this provider.",
      fieldErrors: {},
      values: raw,
    };
  }
  return { status: "success" };
}
