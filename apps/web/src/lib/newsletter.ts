"use server";
/**
 * FILE: apps/web/src/lib/newsletter.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Newsletter sign-up. `subscribe` is the server action behind the newsletter form on the site;
 *   `subscribeToListmonk` sends the email address to Listmonk, the self-hosted newsletter tool, which then
 *   emails the person a "please confirm" link (double opt-in) as required for consent under GDPR.
 * WHERE IT RUNS: on the server only (it reads secret settings and contacts Listmonk).
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line, must stay first) turns every exported async function here into a server
 *     action that browser forms can call; Next.js runs it on the server.
 *   - `fetch(url, options)` sends an HTTP request to another server and gives back its response.
 *   - Zod checks input: `z.string().email().safeParse(x)` returns `{ success, data }` without throwing.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - default parameter `name = ""`; `Promise<boolean>`; type alias with optional fields `{ ok?: string }`.
 *   - `.catch(() => …)` on a Promise = what to do if it fails; `!!x` = turn any value into true/false.
 *   - numeric separator `10_000` = 10000 (the underscore is only for readability).
 *   - regular expression `/\/$/` = "a slash at the very end of the text".
 */

// `import { a } from "b"` loads named things from module b. `z` is Zod, the validation library.
import { z } from "zod";
// `@fundhub/...` = our own shared package. Counts attempts per key in Postgres to slow down robots.
import { rateLimit } from "@fundhub/db/rate-limit";
// The visitor's IP address (used as the rate-limit key).
import { clientIp } from "./client-ip";

/**
 * Newsletter subscriptions live in Listmonk (open source, self-hosted). Its public
 * subscription API handles double opt-in and unsubscribe links for the configured list.
 *
 * Kind: async function (exported from a "use server" file, so technically also callable as a server action;
 * in practice it is called by `subscribe` below and by the sign-up action).
 * @param email  type `string` — the address to subscribe.
 * @param name   type `string`, default "" — the person's name; if empty, the part of the email before "@".
 * @returns      `Promise<boolean>`: true if Listmonk accepted the subscription, false otherwise.
 */
export async function subscribeToListmonk(email: string, name = ""): Promise<boolean> {
  // Where Listmonk lives and which mailing list to use, from environment variables.
  const url = process.env.LISTMONK_URL;
  const list = process.env.LISTMONK_LIST_UUID;
  // Not configured (e.g. on a developer's PC): report failure without trying.
  if (!url || !list) return false;
  // POST the subscription as JSON. `url.replace(/\/$/, "")` removes a trailing "/" so we never get "//api".
  const res = await fetch(`${url.replace(/\/$/, "")}/api/public/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `JSON.stringify` turns the object into JSON text. `split("@")[0]` = the part before the "@".
    body: JSON.stringify({ email, name: name || email.split("@")[0], list_uuids: [list] }),
    // Give up after 10 seconds so a slow Listmonk cannot hang the form.
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    // Network failure or timeout: log it for us and continue with `null` instead of crashing.
    console.error("Listmonk subscription failed", err);
    return null;
  });
  // Listmonk answered but with an error status (e.g. 400): log the status and its message text.
  if (res && !res.ok) console.error("Listmonk subscription failed", res.status, await res.text().catch(() => ""));
  // `res?.ok` = true/false, or undefined when res is null; `!!` turns that into a plain true/false.
  return !!res?.ok;
}

/**
 * Kind: type alias.
 * What the newsletter form shows after submitting: a success message (`ok`) or an `error`.
 */
export type NewsletterState = { ok?: string; error?: string };

/**
 * Kind: server action (async function), used by the newsletter form with React's `useActionState`.
 * @param _prev     type `NewsletterState` — the previous state; unused (the underscore says so).
 * @param formData  type `FormData` — the submitted fields: "email", plus the hidden trap field "website".
 * @returns         `Promise<NewsletterState>`: the message to show.
 */
export async function subscribe(_prev: NewsletterState, formData: FormData): Promise<NewsletterState> {
  // Honeypot: "website" is a field hidden from humans. Robots fill in every field, so if it has a value we
  // pretend success and do nothing.
  if (formData.get("website")) return { ok: "Thanks!" };
  // At most 5 attempts per IP address per hour (60 * 60 seconds).
  if (!(await rateLimit(`newsletter:${await clientIp()}`, 5, 60 * 60))) return { error: "Too many attempts. Try again later." };
  // Validate: text, trimmed, lower-case, a valid email format.
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email." };
  const ok = await subscribeToListmonk(email.data);
  // Ternary: success message if Listmonk accepted, otherwise an apology.
  return ok ? { ok: "Check your inbox to confirm your subscription." } : { error: "Subscription is unavailable right now. Please try later." };
}
