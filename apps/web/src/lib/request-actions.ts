"use server";
/**
 * FILE: apps/web/src/lib/request-actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The server action behind the website's enquiry forms. One action handles five kinds of request:
 *   "rfi" (a fund asks providers for a quote), "advisory", "data", "awards" and "claim" (a provider wants to be
 *   listed). It validates the form with rules that depend on the request type, saves the request in the
 *   `rfi_requests` table and returns a reference number such as "RFI-000042" for the thank-you message.
 * WHERE IT RUNS: on the server (it writes to the database).
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line, must stay first): the exported async functions are server actions that a
 *     browser form can call; Next.js runs them on the server.
 *   - With React's `useActionState`, the action gets `(previousState, formData)` and returns the new state;
 *     here the state says whether the form is "idle", shows an "error", or shows "success".
 *   - Zod schemas can be combined: `.extend({...})` adds fields, `.merge(other)` joins two object schemas,
 *     `.catch(v)` = "if invalid, use v instead of failing", `.parse` = check and throw on failure.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Record<RequestType, string>` = one text value for each request type (TypeScript checks none is missing).
 *   - discriminated union type `{ status: "idle" } | { status: "error"; … } | { status: "success"; … }`:
 *     the `status` field tells which of the shapes the value has.
 *   - `Partial<…>`, `unknown`, optional `?:`, `?.` and `??`; `try { … } catch (err) { … }` = handle failures.
 *   - `.flatMap` = map each item to a list, then join the lists into one; `.padStart(6, "0")` = "42" → "000042".
 */

// `import { a } from "b"` loads named things from module b. `z` = Zod, the validation library.
import { z } from "zod";
// `@fundhub/...` = our shared packages. Database connection, attempt counter (anti-spam):
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
// The visitor's IP address.
import { clientIp } from "./client-ip";
// Shared query: look up one published provider by id.
import { getProviderById } from "@fundhub/db/queries";
// The list of request types, the `rfi_requests` table, and two types: one new row, and one request type.
import { REQUEST_TYPES, rfiRequests, type NewRfiRequest, type RequestType } from "@fundhub/db/schema";
// Allowed answers for the form's drop-downs and check boxes, shared with the form itself.
import { AUM_BANDS, FUND_STRUCTURES, NO_FUND_FIELDS, SERVICE_GROUPS } from "@fundhub/core/request-options";

/** Kind: constant (lookup table). The letters that start each request type's reference number. */
const REFERENCE_PREFIX: Record<RequestType, string> = { rfi: "RFI", advisory: "ADV", data: "DAT", awards: "AWD", claim: "PRO" };

/**
 * Kind: constant (Zod object schema). Fields every request type has.
 * `providerId` is optional: `z.coerce.number()` turns form text into a number; `.catch(undefined)` means a
 * missing or broken value simply becomes "no provider" instead of an error.
 */
const baseSchema = z.object({
  providerId: z.coerce.number().int().positive().optional().catch(undefined),
  contactName: z.string().trim().min(2, "Please enter your name").max(120),
  email: z.string().trim().email("Please enter a valid email").max(200),
  company: z.string().trim().min(2, "Please enter your company").max(160),
  message: z.string().trim().max(4000).default(""),
});

/**
 * Buyer-side requests describe the fund; provider claims don't.
 * Kind: constant (Zod object schema). The fund's legal structure and size band (AuM = assets under management),
 * each chosen from a fixed list.
 */
const fundSchema = z.object({
  fundStructure: z.enum(FUND_STRUCTURES, { message: "Choose a fund structure" }),
  aumBand: z.enum(AUM_BANDS, { message: "Choose an AuM band" }),
});

/**
 * Kind: function that builds a Zod schema.
 * @param type  type `RequestType` — which form this is.
 * @returns     a Zod schema for "a list of at least one ticked option, each one allowed for this request type".
 */
function servicesSchema(type: RequestType) {
  // All options of all groups for this type, as one flat list of texts.
  const allowed = SERVICE_GROUPS[type].flatMap((g) => g.options);
  // `.refine(test)` = custom rule: each value must be in `allowed`. The message wording depends on the form.
  return z
    .array(z.string().refine((s) => allowed.includes(s)))
    .min(1, type === "rfi" || type === "advisory" ? "Select at least one service" : "Select at least one option");
}

/**
 * Kind: type alias (a union of three shapes, told apart by `status`):
 * - `{ status: "idle" }`: nothing submitted yet;
 * - `"error"`: a general `message`, per-field messages, and the submitted `values` so the form can be refilled;
 * - `"success"`: the reference number and, if the request was about one provider, its name.
 */
export type RequestFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Partial<Record<string, string>>; values: Record<string, unknown> }
  | { status: "success"; reference: string; providerName?: string };

/**
 * Kind: server action (async function).
 * @param _prev     type `RequestFormState` — previous form state, unused (the underscore says so).
 * @param formData  type `FormData` — the submitted form, including the hidden "requestType" field.
 * @returns         `Promise<RequestFormState>`: an error state or a success state with the reference number.
 */
export async function submitRequest(_prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  // Which form this is. If the hidden field is missing or unknown, treat it as a normal "rfi" request.
  const type = z.enum(REQUEST_TYPES).catch("rfi").parse(formData.get("requestType"));

  // Honeypot: real users never fill this hidden field.
  // (Robots get a fake success with reference "...-000000" and nothing is saved.)
  if (formData.get("website")) return { status: "success", reference: `${REFERENCE_PREFIX[type]}-000000` };
  // At most 10 requests per IP address per hour.
  if (!(await rateLimit(`request:${await clientIp()}`, 10, 60 * 60))) {
    return { status: "error", message: "Too many requests. Please try again later.", fieldErrors: {}, values: {} };
  }

  // Collect the fields into a plain object. `getAll` returns every ticked check box as a list.
  // `|| undefined` turns an empty provider field into "no value"; `?? ""` turns a missing message into "".
  const raw = {
    providerId: formData.get("providerId") || undefined,
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    company: formData.get("company"),
    fundStructure: formData.get("fundStructure"),
    aumBand: formData.get("aumBand"),
    servicesNeeded: formData.getAll("servicesNeeded"),
    message: formData.get("message") ?? "",
  };

  // Request types without fund questions use only the base rules plus services; the others also need
  // fund structure and AuM band.
  const noFund = NO_FUND_FIELDS.includes(type);
  const schema = noFund
      ? baseSchema.extend({ servicesNeeded: servicesSchema(type) })
      : baseSchema.merge(fundSchema).extend({ servicesNeeded: servicesSchema(type) });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // One message per field: the first problem Zod found for it.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values: raw };
  }

  const data = parsed.data;
  // Already validated above for buyer-side requests; re-parse for a precise type.
  // (`schema` is one of two shapes, so TypeScript cannot be sure `data.fundStructure` exists; parsing with
  // `fundSchema` again gives a value it knows has both fields.)
  const fund = noFund ? undefined : fundSchema.parse(raw);
  // If the form was about one provider, look it up (only published providers are found).
  const provider = data.providerId ? await getProviderById(data.providerId) : undefined;

  // The new database row. `NewRfiRequest` is the type of a row to insert, so TypeScript checks every column.
  // `provider?.id ?? null` = the provider's id, or null when there is none; same idea for the fund fields.
  const values: NewRfiRequest = {
    requestType: type,
    providerId: provider?.id ?? null,
    contactName: data.contactName,
    email: data.email,
    company: data.company,
    fundStructure: fund?.fundStructure ?? "",
    aumBand: fund?.aumBand ?? "",
    servicesNeeded: data.servicesNeeded,
    message: data.message,
  };

  // `try` = attempt this; if anything inside throws an error, jump to `catch` instead of crashing the page.
  try {
    // Save it and get the new id back.
    const [row] = await db.insert(rfiRequests).values(values).returning({ id: rfiRequests.id });

    // Reference number = prefix + id padded to 6 digits, e.g. "RFI-000042".
    return {
      status: "success",
      reference: `${REFERENCE_PREFIX[type]}-${String(row.id).padStart(6, "0")}`,
      providerName: provider?.name,
    };
  } catch (err) {
    // Log the technical details for us; show the visitor a friendly message and keep their input.
    console.error("Failed to store request", err);
    return {
      status: "error",
      message: "We couldn't submit your request right now. Please try again in a moment.",
      fieldErrors: {},
      values: raw,
    };
  }
}
