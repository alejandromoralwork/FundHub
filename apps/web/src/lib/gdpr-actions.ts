"use server";
/**
 * FILE: apps/web/src/lib/gdpr-actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The server action behind the privacy-request form, where anyone can ask FundHub for a copy of
 *   their data, its deletion, its correction, or object to its processing (rights under the EU's GDPR). It
 *   checks the form, saves the request with a due date one month later, and emails the person a confirmation
 *   with a reference number. Staff then handle the request in the console.
 * WHERE IT RUNS: on the server (it writes to the database and sends email).
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line, must stay first): every exported async function here is a server action that
 *     a browser form can call; Next.js runs it on the server.
 *   - The form uses React's `useActionState`, so the action receives `(previousState, formData)` and returns
 *     the new state for the form to display.
 *   - Zod (`z`) describes the expected form data; `.safeParse` checks it and reports problems per field.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias with optional fields; `Record<K, V>` = an object with keys of type K and values of type V.
 *   - `(typeof GDPR_REQUEST_TYPES)[number]` = "any one item of that list", i.e. "access" | "deletion" | ….
 *   - spread `{ ...d, dueAt }` = all fields of d plus dueAt; `for … of` loops; `??=`; template strings.
 */

// `import { a } from "b"` loads named things from module b. `z` = Zod, the validation library.
import { z } from "zod";
// `@fundhub/...` = our shared packages. COMPANY holds FundHub's own details (e.g. the privacy email address).
import { COMPANY } from "@fundhub/core/company";
// The allowed request kinds: ["access", "deletion", "rectification", "objection"].
import { GDPR_REQUEST_TYPES } from "@fundhub/core/enums";
// Database connection, attempt counter (anti-spam) and the `gdpr_requests` table.
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
import { gdprRequests } from "@fundhub/db/schema";
// Renders one of our email templates and sends it.
import { sendEmail } from "@fundhub/email/send";
// The visitor's IP address, used for the rate limit.
import { clientIp } from "./client-ip";

/**
 * Kind: type alias. What the form shows after submitting: `ok` (success), `error` (whole form), or
 * `fieldErrors` (one message per field, e.g. `{ email: "Enter the email…" }`). All optional.
 */
export type GdprState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };

/**
 * Kind: constant (Zod object schema). The rules for the form:
 * - `name`: optional text up to 120 characters (`.default("")` when missing);
 * - `email`: required, trimmed, lower-cased, valid format (the message is shown otherwise);
 * - `type`: one of GDPR_REQUEST_TYPES; `details`: optional free text up to 4000 characters.
 */
const schema = z.object({
  name: z.string().trim().max(120).default(""),
  email: z.string().trim().toLowerCase().email("Enter the email address the request is about"),
  type: z.enum(GDPR_REQUEST_TYPES, { message: "Choose a request type" }),
  details: z.string().trim().max(4000).default(""),
});

/**
 * Kind: constant (lookup table). Plain-English wording of each request type, used inside the email.
 * The type `Record<(one of the request types), string>` forces an entry for every type: adding a new type to
 * GDPR_REQUEST_TYPES without adding its wording here would be a TypeScript error.
 */
const TYPE_LABEL: Record<(typeof GDPR_REQUEST_TYPES)[number], string> = {
  access: "a copy of your data",
  deletion: "deletion of your data",
  rectification: "correction of your data",
  objection: "objection to processing",
};

/**
 * Kind: server action (async function).
 * @param _prev     type `GdprState` — the previous form state; unused (the underscore says so).
 * @param formData  type `FormData` — the submitted fields name, email, type, details, plus the trap "website".
 * @returns         `Promise<GdprState>`: the success message or the errors to show.
 */
export async function submitGdprRequest(_prev: GdprState, formData: FormData): Promise<GdprState> {
  // (A honeypot is a field hidden from humans: robots fill it in, so we pretend success and do nothing.)
  if (formData.get("website")) return { ok: "Request received." }; // honeypot
  // At most 5 requests per IP address per hour (60 * 60 seconds).
  if (!(await rateLimit(`gdpr:${await clientIp()}`, 5, 60 * 60))) return { error: "Too many requests. Please try again later." };
  // `Object.fromEntries(formData)` turns the form fields into a plain object for Zod to check.
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    // Collect the first message for each field (`i.path[0]` = the field name; `??=` keeps only the first).
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  // `d` = the validated, cleaned-up data.
  const d = parsed.data;
  // GDPR Art. 12(3): answer within one month.
  // Start from today and move one month ahead. `const` is fine even though the date changes: the name
  // always points to the same Date object, and `setMonth` changes that object in place.
  const dueAt = new Date();
  dueAt.setMonth(dueAt.getMonth() + 1);
  // Save the request and get its new id back; the id doubles as the reference number "GDPR-<id>".
  const [row] = await db.insert(gdprRequests).values({ ...d, dueAt }).returning({ id: gdprRequests.id });
  // Confirmation email using the generic "message" template. `d.name || undefined` = no name if left blank.
  // `\n\n` inside the text = a blank line. `toLocaleDateString("en-GB")` writes the date as day/month/year.
  // `related` links the email to this request in the console's email log.
  await sendEmail({
    to: d.email,
    toName: d.name || undefined,
    template: "message",
    props: {
      subject: `Your data request (ref. GDPR-${row.id})`,
      name: d.name || undefined,
      body: `We received your request for ${TYPE_LABEL[d.type]} (reference GDPR-${row.id}).\n\nTo protect your data, we will first confirm that this email address belongs to you, then answer within one month, by ${dueAt.toLocaleDateString("en-GB")}.\n\nIf you did not make this request, reply to ${COMPANY.privacyEmail}.`,
    },
    related: { entity: "gdpr_requests", id: row.id },
  });
  return { ok: `Request received (reference GDPR-${row.id}). We've sent a confirmation to ${d.email} and will answer within one month.` };
}
