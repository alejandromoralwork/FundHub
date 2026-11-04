/**
 * FILE: apps/admin/src/app/api/webhooks/resend/route.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Receives delivery notifications ("webhooks") from Resend, our email-sending service. When
 *   Resend tells us an email was sent, delivered, bounced or marked as spam, this updates that email's status
 *   in our email log. It first checks the message's cryptographic signature so nobody can fake these calls.
 * WHERE IT RUNS: on the server (Node.js) only. Resend's servers call /admin/api/webhooks/resend directly;
 *   there is no logged-in user, which is why the signature check is the security gate.
 * FRAMEWORK NOTES: route.ts = an API endpoint; the exported POST function answers HTTP POST requests.
 *   A "webhook" is simply another service calling our URL to tell us something happened.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<string, A | B>` (an object whose values are one of a few fixed words),
 *   string literal union types, `Buffer` (raw bytes in Node.js), regular expressions, template strings,
 *   `.some(...)`, `??`, `?.`, `as` assertions, end-of-line comments.
 */

// `import { a } from "b"` loads named exports from module "b".
// "node:crypto" = Node.js's built-in cryptography. createHmac computes a keyed fingerprint (signature);
// timingSafeEqual compares two byte sequences in constant time, so attackers cannot learn from timing.
import { createHmac, timingSafeEqual } from "node:crypto";
// Drizzle ORM helper: `eq(a, b)` = SQL "a = b".
import { eq } from "drizzle-orm";
// `NextResponse` builds HTTP responses.
import { NextResponse } from "next/server";
// `@fundhub/…` = our shared packages. Database connection and the email log table.
import { db } from "@fundhub/db/client";
import { emailMessages } from "@fundhub/db/schema";

/**
 * Kind: constant (lookup table).
 * Maps Resend's event names to our own status words. Its type `Record<string, "delivered" | …>` means
 * "an object with text keys, each value being exactly one of these four words" (a union of literal types).
 * Events not listed here (e.g. opens/clicks) map to undefined and are ignored.
 */
const STATUS: Record<string, "delivered" | "bounced" | "complained" | "sent"> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/**
 * Kind: function (private to this file).
 * Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_".
 * @param req   type `Request` — the incoming request (we read its svix-* headers).
 * @param body  type `string` — the raw request body exactly as received (the signature covers these bytes).
 * @returns     `boolean`: true only if one of the supplied signatures matches and the message is recent.
 */
function verify(req: Request, body: string): boolean {
  // Our shared secret (server setting) and the three signature headers Resend sends.
  // `headers.get(name)` returns the header text, or null if it is missing.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigs = req.headers.get("svix-signature");
  // Anything missing: reject. `||` = "or".
  if (!secret || !id || !ts || !sigs) return false;
  // Reject messages older or newer than 5 minutes, so a captured message cannot be re-sent later.
  // `Date.now()` is in milliseconds, so /1000 gives seconds like the timestamp header.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false; // replay window
  // The secret looks like "whsec_<base64>": strip the prefix (`/^whsec_/` = "whsec_" at the start) and
  // decode the base64 text into raw bytes.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  // Compute the signature we expect: HMAC-SHA256 of "id.timestamp.body" using the key.
  // `` `${id}.${ts}.${body}` `` is a template string that joins the three values with dots.
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  // The header may hold several signatures separated by spaces, each like "v1,<base64>".
  // `.some(fn)` returns true if fn returns true for at least one of them.
  return sigs.split(" ").some((s) => {
    // Take the part after the comma (or "" if missing) and decode it to bytes.
    const sig = Buffer.from(s.split(",")[1] ?? "", "base64");
    // Lengths must match first (timingSafeEqual throws on different lengths), then compare safely.
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  });
}

/**
 * Kind: async function — the HTTP POST handler Resend calls.
 * @param req  type `Request` — the webhook call.
 * @returns    `Promise<Response>`: `{ received: true }`, or 401 if the signature is wrong.
 */
export async function POST(req: Request) {
  // Read the body as raw text (not parsed JSON), because the signature is computed over the exact text.
  const body = await req.text();
  if (!verify(req, body)) return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
  // Now it is safe to parse. `as { type: string; data?: { email_id?: string } }` describes the fields we
  // use; `?` marks fields that might be missing.
  const event = JSON.parse(body) as { type: string; data?: { email_id?: string } };
  // Our status word for this event, or undefined if we do not track it.
  const status = STATUS[event.type];
  // `event.data?.email_id` = the email's id, read only if `data` exists.
  if (status && event.data?.email_id) {
    // UPDATE email_messages SET status = … WHERE provider_message_id = <Resend's email id>.
    await db.update(emailMessages).set({ status }).where(eq(emailMessages.providerMessageId, event.data.email_id));
  }
  // Always answer 200 with a small JSON so Resend does not keep retrying.
  return NextResponse.json({ received: true });
}
