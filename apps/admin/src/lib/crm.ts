/**
 * FILE: apps/admin/src/lib/crm.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: A small client for Twenty, the open-source CRM (customer relationship management system)
 *   FundHub runs itself. From the Console's inbox a staff member can push an incoming request to the CRM:
 *   this file creates a "person" (the contact) and an "opportunity" (the potential deal) there.
 * WHERE IT RUNS: only on the server (Node.js), because it uses the secret TWENTY_API_KEY.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file.
 *   `fetch` is the standard built-in function for making HTTP requests (here to Twenty's REST API).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generics `<T>` (the caller chooses the result type), `unknown`, `Record<K, V>`, `as` type assertions.
 *   - union types (`string | null`, `string | undefined`), optional chaining `?.`, `!!`, ternary.
 *   - template strings, array destructuring with rest `const [first, ...rest] = arr`, spread `...obj`.
 *   - `typeof v === "object"` and `"id" in v` checks (runtime checks of a value's shape).
 */

// Server-only guard (see FRAMEWORK NOTES). This file has no other imports: it only uses built-in features.
import "server-only";

/**
 * Twenty CRM (open source, self-hosted) REST client. Records live under /rest/<object>,
 * authenticated with a workspace API key (Settings → Developers → API).
 * Only documented basics are sent; amounts and stages are set in Twenty.
 *
 * Kind: function (exported).
 * @returns `boolean`: true only if both the CRM address and the API key are set as environment variables.
 *          The Console uses it to hide or explain the "Send to CRM" button. `!!x` turns a value into true/false.
 */
export function crmConfigured(): boolean {
  return !!process.env.TWENTY_URL && !!process.env.TWENTY_API_KEY;
}

/**
 * Kind: function (exported).
 * @returns `string | null`: the CRM's base address without a trailing "/" (so we can add "/rest/…" safely),
 *          or `null` when it is not configured. The regular expression `/\/$/` means "a slash at the end".
 */
export function crmUrl(): string | null {
  return process.env.TWENTY_URL ? process.env.TWENTY_URL.replace(/\/$/, "") : null;
}

/**
 * Kind: async generic function (private).
 * Sends one POST request (create a record) to Twenty's REST API.
 * @param path  type `string` — the object type, e.g. "people" or "opportunities".
 * @param body  type `unknown` — the record's fields; turned into JSON text.
 * @returns `Promise<T>`: the parsed JSON reply, labelled with the type the caller asked for.
 * @throws an `Error` with the status and the start of the reply when Twenty answers with an error.
 */
async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${crmUrl()}/rest/${path}`, {
    method: "POST",
    // The API key goes in the standard "Authorization: Bearer <key>" header; we say we send JSON.
    headers: { Authorization: `Bearer ${process.env.TWENTY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Give up after 15 seconds (15_000 ms) so a slow CRM cannot hang the Console.
    signal: AbortSignal.timeout(15_000),
  });
  // Read the JSON reply; if it is not valid JSON, `.catch(() => ({}))` uses an empty object instead.
  // (The extra round brackets around `{}` make the arrow function return an object.)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // `res.ok` is true for HTTP status 200–299. Otherwise throw, including at most 300 characters of the reply.
  if (!res.ok) throw new Error(`CRM ${path}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json as T;
}

/**
 * Kind: function (private).
 * Twenty wraps created records as { data: { create<Object>: { id } } }; read the id defensively.
 * @param res  type `Record<string, unknown>` — Twenty's reply.
 * @returns `string | undefined`: the new record's id, or undefined if it cannot be found.
 */
function idOf(res: Record<string, unknown>): string | undefined {
  // Treat `res.data` as "an object whose values may have an id" (or missing).
  const data = res.data as Record<string, { id?: string }> | undefined;
  // `Object.values(data)` = the inner objects (we do not need to know the key name, e.g. "createPerson").
  // `.find(…)` picks the first one that is a real object with an "id" field; `?.id` reads it safely.
  return data ? Object.values(data).find((v) => v && typeof v === "object" && "id" in v)?.id : undefined;
}

/**
 * Kind: async function (exported).
 * Creates a contact and a linked opportunity in the CRM.
 * @param input  an object: `name`, `email`, `company`, `title` (all `string`); `title` becomes the opportunity's name.
 * @returns `Promise<{ personId?: string; opportunityId?: string }>`: the new ids (each may be missing).
 */
export async function createLead(input: { name: string; email: string; company: string; title: string }): Promise<{ personId?: string; opportunityId?: string }> {
  // Split the full name on spaces: the first word is the first name, the rest (`...rest`) the last name.
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const person = await call<Record<string, unknown>>("people", {
    name: { firstName: firstName ?? input.name, lastName: rest.join(" ") },
    emails: { primaryEmail: input.email },
  });
  const personId = idOf(person);
  // `...(cond ? { a } : {})` adds the field only when we have a person id (spreading `{}` adds nothing).
  const opportunity = await call<Record<string, unknown>>("opportunities", {
    name: input.title,
    ...(personId ? { pointOfContactId: personId } : {}),
  });
  return { personId, opportunityId: idOf(opportunity) };
}
