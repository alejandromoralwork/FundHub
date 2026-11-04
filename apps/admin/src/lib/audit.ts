/**
 * FILE: apps/admin/src/lib/audit.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Writes one row to the audit log every time a staff member changes something (who, what
 *   action, on which table and row, and optionally what changed). This gives FundHub a trail for security
 *   reviews, GDPR accountability and "who edited this provider?" questions.
 * WHERE IT RUNS: only on the server (Node.js), called from server actions and API routes.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - async functions and `Promise`, optional parameters (`entityId?:`), union types (`string | number | null`).
 *   - `Record<string, unknown>` (an object with any keys whose values must be checked before use).
 *   - `.catch(…)` on a Promise, `== null` (matches both null and undefined), ternary `c ? x : y`.
 */

// `import { a } from "b"` brings named things from another module into this file.
// Server-only guard (see above).
import "server-only";
// `@fundhub/…` = our shared packages: the database connection and the audit_log table definition.
import { db } from "@fundhub/db/client";
import { auditLog } from "@fundhub/db/schema";
// `import type` = only a type, erased when the code runs. `Staff` = the signed-in staff member (./auth.ts).
import type { Staff } from "./auth";

/**
 * Kind: async function (exported).
 * Records a staff write. Never throws: auditing must not block the action itself.
 * @param staff     type `Staff` — who did it (only `staff.id` is stored).
 * @param action    type `string` — a short verb, e.g. "change-password", "approve-review".
 * @param entity    type `string` — the table affected, e.g. "staff_users".
 * @param entityId  optional (`?`), type `string | number | null` — the affected row's id.
 * @param changes   optional, type `Record<string, unknown>` — details such as old/new values.
 * @returns `Promise<void>`: nothing.
 */
export async function audit(
  staff: Staff,
  action: string,
  entity: string,
  entityId?: string | number | null,
  changes?: Record<string, unknown>,
) {
  // SQL "INSERT INTO audit_log (…) VALUES (…)" via Drizzle ORM.
  // `entityId == null` (double equals) is true for both null and undefined; then we store null,
  // otherwise the id as text (`String(…)`), so numeric and text ids fit the same column.
  // `.catch(fn)` handles a failed insert by logging it to the server console instead of throwing:
  // the user's actual change should not fail just because the log could not be written.
  await db
    .insert(auditLog)
    .values({ staffUserId: staff.id, action, entity, entityId: entityId == null ? null : String(entityId), changes })
    .catch((err) => console.error("audit log failed", err));
}
