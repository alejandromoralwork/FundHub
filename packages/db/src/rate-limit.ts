/**
 * FILE: packages/db/src/rate-limit.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: A "rate limit" caps how often something may happen (e.g. at most 10 login attempts per
 *   15 minutes from one IP address), to slow down password guessing and spam. The counters are kept in a
 *   Postgres table called rate_limits, so no extra service (like Redis) is needed.
 * WHERE IT RUNS: on the server only (Node.js), inside login forms, contact forms and similar actions.
 * FRAMEWORK NOTES: Drizzle's `sql`…`` tag lets us write raw SQL while still passing values safely:
 *   every `${value}` becomes a numbered placeholder ($1, $2…) filled by the driver, never pasted as text,
 *   which prevents SQL injection.
 * TYPESCRIPT YOU WILL SEE HERE: tagged template strings (sql`…`), generics `execute<{ count: number }>`,
 *   `async`/`await`, `Promise<boolean>`, optional chaining `a?.b`, `??`.
 */

// `import { a } from "b"`: bring named items from another module.
// `sql` (from the drizzle-orm library on npm) builds a raw SQL query with safe placeholders.
import { sql } from "drizzle-orm";
// The shared database object from client.ts in this package.
import { db } from "./client";

/**
 * Fixed-window rate limit stored in Postgres (no extra service).
 * Returns true when the call is allowed.
 *
 *   if (!(await rateLimit(`login:${ip}`, 10, 15 * 60))) return { error: "Too many attempts" };
 *
 * Kind: async function.
 * "Fixed window" = we count calls from the moment the first one arrives; once the window (e.g. 15 minutes)
 * has passed, the count starts again from 1.
 * @param key            type `string` — what is being limited, e.g. "login:203.0.113.5" (action + IP address).
 * @param limit          type `number` — the most calls allowed within one window.
 * @param windowSeconds  type `number` — the window length in seconds (15 * 60 = 15 minutes).
 * @returns `Promise<boolean>`: arrives later (database round trip); `true` = allowed, `false` = too many.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  // One SQL statement does the whole job atomically (no two requests can interleave and miscount):
  // - "insert … values (key, now(), 1)": first call for this key creates a row with count 1.
  // - "on conflict (key) do update": if a row for this key already exists (key is the table's primary key,
  //   i.e. unique), update it instead ("upsert" = update or insert):
  //     * if the window started longer ago than windowSeconds (make_interval turns seconds into a time span),
  //       reset count to 1 and window_start to now;
  //     * otherwise add 1 to the count and keep the window start.
  //   "case when X then A else B end" is SQL's if/else.
  // - "returning count" sends back the new count.
  // `execute<{ count: number }>` tells TypeScript each returned row has a numeric `count`.
  // `const { rows } = …` takes just the `rows` array out of the result object.
  const { rows } = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count`);
  // `rows[0]?.count`: the first row's count, or undefined if there is no row (`?.` stops safely instead of
  // crashing). `?? 0` uses 0 then. Number(...) makes sure it is a number (the driver may return text).
  // Allowed while the count is at or below the limit.
  return Number(rows[0]?.count ?? 0) <= limit;
}
