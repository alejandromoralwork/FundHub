import { sql } from "drizzle-orm";
import { db } from "./client";

/**
 * Fixed-window rate limit stored in Postgres (no extra service).
 * Returns true when the call is allowed.
 *
 *   if (!(await rateLimit(`login:${ip}`, 10, 15 * 60))) return { error: "Too many attempts" };
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count`);
  return Number(rows[0]?.count ?? 0) <= limit;
}
