import "server-only";
import { db } from "@fundhub/db/client";
import { auditLog } from "@fundhub/db/schema";
import type { Staff } from "./auth";

/** Records a staff write. Never throws: auditing must not block the action itself. */
export async function audit(
  staff: Staff,
  action: string,
  entity: string,
  entityId?: string | number | null,
  changes?: Record<string, unknown>,
) {
  await db
    .insert(auditLog)
    .values({ staffUserId: staff.id, action, entity, entityId: entityId == null ? null : String(entityId), changes })
    .catch((err) => console.error("audit log failed", err));
}
