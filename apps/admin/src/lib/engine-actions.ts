"use server";
/**
 * FILE: apps/admin/src/lib/engine-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's write actions on the Scraping Engine:
 *   - jobs: start a job, switch a schedule on/off, edit the RCS number space, pause/resume the RCS session;
 *   - registry: edit an entity (stored as a "manual" source — overrides with full history, removable),
 *     add/end clients, accept/reject match candidates (accept = merge the two entities).
 *   Pattern (same as lib/pipeline-actions.ts): check the role (`requireStaff(CAN.x)`), validate input (zod),
 *   write in an engine transaction tagged with the staff member (`withActor` → row_history), log to the
 *   Console's audit log, refresh the page, return `{ ok }` or `{ error }` for `useAction()`.
 * WHERE IT RUNS: server only ("use server" = Next.js server actions, callable from client components).
 * TYPESCRIPT YOU WILL SEE HERE: zod schemas, `z.infer`, try/catch returning result objects.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db as engineDb } from "@fundhub/engine-db/client";
import { applyManualEdit, endRelation, mergeEntities, setManualRelation, withActor } from "@fundhub/engine-db/core/entity";
import { parseLuAddress } from "@fundhub/engine-db/core/normalize";
import { DISABLED_SCHEDULES_KEY, JOB_CATALOG, isJobName, type JobInfo } from "@fundhub/engine-db/jobs-catalog";
import { ENTITY_KINDS, ENTITY_STATUSES, RELATION_KINDS, engineSettings, matchCandidates, rcsNumberSpace, sessionHealth, sourceRecords } from "@fundhub/engine-db/schema";
import { audit } from "./audit";
import { CAN, requireStaff, type Staff } from "./auth";
import { engineBoss, sendEngineJob } from "./engine-queue";

export type ActionResult = { ok?: string; error?: string };

/** Kind: function. Who, as stored in the engine (change_events.actor, row_history.actor). */
const actorOf = (staff: Staff) => `staff:${staff.email}`;
/** Kind: function. Error → message for the toast. */
const fail = (err: unknown): ActionResult => ({ error: err instanceof Error ? err.message : String(err) });

// ------------------------------------------------------------------ jobs

/**
 * Kind: server action. Puts a job on the engine queue. Parameters are converted per the catalog
 * (number / boolean / comma list); empty values are dropped.
 */
export async function enqueueEngineJob(name: string, params: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  if (!isJobName(name)) return { error: `Unknown job ${name}` };
  const info: JobInfo = JOB_CATALOG[name];
  const data: Record<string, unknown> = {};
  try {
    for (const p of info.params) {
      const v = params[p.name];
      if (v === undefined || v === null || v === "" || v === false) {
        if (p.required) throw new Error(`${p.label} is required`);
        continue;
      }
      if (p.kind === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`${p.label} must be a number`);
        data[p.name] = n;
      } else if (p.kind === "boolean") data[p.name] = v === true || v === "true";
      else if (p.kind === "list") data[p.name] = String(v).split(",").map((x) => x.trim()).filter(Boolean);
      else data[p.name] = String(v).trim();
    }
    const id = await sendEngineJob(name, data);
    await audit(staff, "queue", "engine-job", null, { name, data });
    revalidatePath("/engine/jobs");
    return { ok: id ? `Queued ${info.title}. A worker serving "${info.group}" will run it.` : `${info.title} is already queued.` };
  } catch (err) {
    return fail(err);
  }
}

/** Kind: server action. Switches a job's cron schedule on or off (persisted for the scheduler, applied live). */
export async function setScheduleEnabled(name: string, enabled: boolean): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  if (!isJobName(name)) return { error: `Unknown job ${name}` };
  const info: JobInfo = JOB_CATALOG[name];
  if (!info.schedule) return { error: `${info.title} has no schedule` };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      const [row] = await tx.select().from(engineSettings).where(eq(engineSettings.key, DISABLED_SCHEDULES_KEY));
      const set = new Set((row?.value as string[] | undefined) ?? []);
      if (enabled) set.delete(name);
      else set.add(name);
      const value = [...set].sort();
      await tx
        .insert(engineSettings)
        .values({ key: DISABLED_SCHEDULES_KEY, value, updatedBy: staff.email })
        .onConflictDoUpdate({ target: engineSettings.key, set: { value, updatedBy: staff.email, updatedAt: new Date() } });
    });
    const boss = await engineBoss();
    if (enabled) {
      if (!(await boss.getQueue(name))) await boss.createQueue(name);
      await boss.schedule(name, info.schedule.cron, info.schedule.data ?? {}, { tz: process.env.ENGINE_TZ ?? "Europe/Luxembourg" });
    } else await boss.unschedule(name);
    await audit(staff, enabled ? "schedule-on" : "schedule-off", "engine-job", null, { name });
    revalidatePath("/engine/jobs");
    return { ok: `${info.title}: schedule ${enabled ? "on" : "off"}` };
  } catch (err) {
    return fail(err);
  }
}

const numberSpaceInput = z.object({ prefix: z.string().regex(/^[A-Z]$/), enabled: z.boolean(), maxKnown: z.number().int().min(0), sweptTo: z.number().int().min(0) });

/** Kind: server action. Edits one RCS prefix (enable, frontier, sweep progress). */
export async function updateNumberSpace(input: z.infer<typeof numberSpaceInput>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  const v = numberSpaceInput.safeParse(input);
  if (!v.success) return { error: v.error.issues[0]?.message ?? "Invalid values" };
  await engineDb.transaction(async (tx) => {
    await withActor(tx, actorOf(staff));
    await tx.update(rcsNumberSpace).set({ enabled: v.data.enabled, maxKnown: v.data.maxKnown, sweptTo: v.data.sweptTo, updatedAt: new Date() }).where(eq(rcsNumberSpace.prefix, v.data.prefix));
  });
  await audit(staff, "update", "engine-rcs_number_space", null, v.data);
  revalidatePath("/engine/jobs");
  return { ok: `Prefix ${v.data.prefix} saved` };
}

/**
 * Kind: server action. Pauses RCS work ("blocked") or marks the session OK again after you checked it in the
 * browser (e.g. after an LBR access-limitation page expired). A first login still needs `engine rcs:login`.
 */
export async function setRcsSession(state: "ok" | "blocked"): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  const message = state === "ok" ? `resumed by ${staff.email}` : `paused by ${staff.email}`;
  await engineDb
    .insert(sessionHealth)
    .values({ source: "rcs", state, message })
    .onConflictDoUpdate({ target: sessionHealth.source, set: { state, message, checkedAt: new Date() } });
  await audit(staff, state === "ok" ? "rcs-resume" : "rcs-pause", "engine-session", null, {});
  revalidatePath("/engine");
  revalidatePath("/engine/jobs");
  return { ok: state === "ok" ? "RCS work resumed" : "RCS work paused" };
}

// ------------------------------------------------------------------ registry edits

const addressInput = z.object({ raw: z.string().min(1), street: z.string().nullish(), postcode: z.string().nullish(), city: z.string().nullish(), country: z.string().nullish() });
const editInput = z.object({
  name: z.string().trim().min(1).nullable().optional(),
  legalForm: z.string().trim().nullable().optional(),
  status: z.enum(ENTITY_STATUSES).nullable().optional(),
  address: addressInput.nullable().optional(),
  registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  website: z.url().nullable().optional(),
  operatingCountries: z.array(z.string()).nullable().optional(),
});
const classificationInput = z.union([
  z.literal("rules"),
  z.object({
    isServiceProvider: z.boolean(),
    entityKind: z.enum(ENTITY_KINDS),
    activityCategoryId: z.number().int().nullable(),
    activitySubcategoryId: z.number().int().nullable(),
    tier: z.number().int().min(0).max(2),
  }),
]);

/**
 * Kind: server action. Saves a staff edit of an entity. Each field: a value = override (wins over the
 * registers), `null` = remove the override (the registers take over). Fields not sent are untouched.
 */
export async function saveEntityEdit(entityId: string, edit: unknown, classification?: unknown): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const e = editInput.safeParse(edit);
  if (!e.success) return { error: `${e.error.issues[0]?.path.join(".")}: ${e.error.issues[0]?.message}` };
  const c = classification === undefined ? undefined : classificationInput.safeParse(classification);
  if (c && !c.success) return { error: `classification: ${c.error.issues[0]?.message}` };
  // An address typed as one line is split into street / postcode / city like the registers' addresses.
  if (e.data.address && !e.data.address.postcode) e.data.address = parseLuAddress(e.data.address.raw);
  try {
    const { changed } = await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      return applyManualEdit(tx, entityId, e.data, c?.data, actorOf(staff));
    });
    if (changed.length) await audit(staff, "update", "engine-entity", entityId, { changed, edit: e.data, classification: c?.data });
    revalidatePath(`/engine/registry/${entityId}`);
    return { ok: changed.length ? `Saved: ${changed.join(", ")}` : "Nothing changed" };
  } catch (err) {
    return fail(err);
  }
}

const relationInput = z.object({ kind: z.enum(RELATION_KINDS), objectName: z.string().trim().min(1), objectEntityId: z.uuid().nullish(), evidenceUrl: z.url().nullish() });

/** Kind: server action. Adds a client (or other relation) to an entity. */
export async function addRelation(entityId: string, input: unknown): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const r = relationInput.safeParse(input);
  if (!r.success) return { error: `${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}` };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await setManualRelation(tx, entityId, r.data, actorOf(staff));
    });
    await audit(staff, "create", "engine-relation", entityId, r.data);
    revalidatePath(`/engine/registry/${entityId}`);
    return { ok: `Added ${r.data.objectName}` };
  } catch (err) {
    return fail(err);
  }
}

/** Kind: server action. Ends a relation (kept as history). */
export async function endRelationAction(entityId: string, relationId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const done = await engineDb.transaction(async (tx) => {
    await withActor(tx, actorOf(staff));
    return endRelation(tx, relationId, actorOf(staff));
  });
  if (done) await audit(staff, "end", "engine-relation", relationId, { entityId });
  revalidatePath(`/engine/registry/${entityId}`);
  return done ? { ok: "Relation ended (kept in history)" } : { error: "Already ended" };
}

// ------------------------------------------------------------------ matches

/**
 * Kind: server action. Decides a match candidate. Accept = the source record's current entity and the
 * candidate entity are the same company → merge them (into the candidate). Reject = keep them apart.
 */
export async function decideMatch(candidateId: number, accept: boolean): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  try {
    const msg = await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      const [m] = await tx.select().from(matchCandidates).where(and(eq(matchCandidates.id, candidateId), eq(matchCandidates.decision, "pending")));
      if (!m) throw new Error("Already decided");
      await tx.update(matchCandidates).set({ decision: accept ? "accepted" : "rejected", decidedBy: staff.email, decidedAt: new Date() }).where(eq(matchCandidates.id, candidateId));
      if (!accept) return "Kept apart";
      const [rec] = await tx.select({ entityId: sourceRecords.entityId }).from(sourceRecords).where(eq(sourceRecords.id, m.sourceRecordId));
      if (rec?.entityId && rec.entityId !== m.entityId) await mergeEntities(tx, m.entityId, rec.entityId, "manual");
      else await tx.update(sourceRecords).set({ entityId: m.entityId }).where(eq(sourceRecords.id, m.sourceRecordId));
      return "Merged into one entity";
    });
    await audit(staff, accept ? "accept-match" : "reject-match", "engine-match", candidateId, {});
    revalidatePath("/engine/matches");
    return { ok: msg };
  } catch (err) {
    return fail(err);
  }
}
