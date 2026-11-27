"use server";
/**
 * FILE: apps/admin/src/lib/engine-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's write actions on the Intelligence pipeline:
 *   - jobs: start a job, switch a schedule on/off, edit the RCS number space, pause/resume the RCS session;
 *   - companies: edit a company (stored as a "manual" source — overrides with full history, removable),
 *     add/end clients, accept/reject match candidates (accept = merge the two companies);
 *   - review: approve / edit-and-approve / reject versions held at the STAGING APPROVAL GATE (approval queues
 *     the `staging_release` job, which runs clean → match → core), resolve or ignore cross-source conflicts,
 *     accept / reject uncertain news mentions;
 *   - sources: enable / disable a source, edit its staging review policy.
 *   Pattern (same as lib/pipeline-actions.ts): check the role (`requireStaff(CAN.x)`), validate input (zod),
 *   write in an engine transaction tagged with the staff member (`withActor` → core.row_history), log to the
 *   Console's audit log, refresh the page, return `{ ok }` or `{ error }` for `useAction()`.
 * WHERE IT RUNS: server only ("use server" = Next.js server actions, callable from client components).
 * TYPESCRIPT YOU WILL SEE HERE: zod schemas, `z.infer`, try/catch returning result objects.
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db as engineDb } from "@fundhub/engine-db/client";
import { applyManualEdit, endRelation, mergeCompanies, setManualRelation, withActor } from "@fundhub/engine-db/core/entity";
import { parseLuAddress } from "@fundhub/engine-db/core/normalize";
import { closeRound, resetSkipped, startRound } from "@fundhub/engine-db/core/rounds";
import { DISABLED_SCHEDULES_KEY, JOB_CATALOG, isJobName, type JobInfo } from "@fundhub/engine-db/jobs-catalog";
import { COMPANY_KINDS, COMPANY_STATUSES, ENGINE_SOURCES, FUND_LAWS, FUND_REGIMES, FUND_ROLES, GROUP_KINDS, GROUP_LAYERS, GROUP_ROLES, LEGAL_VEHICLES, MANAGER_TYPES, REVIEW_MODES, RELATION_KINDS, companies, companyGroupMembers, companyGroups, mandateRoles, mandates, MANDATE_ROLES, DATE_PRECISIONS, settings, candidates, changes, conflicts, lbrNumberSpace, newsMentions, parsedRecords, reviewPolicies, sessionHealth, sourceRecords, sources } from "@fundhub/engine-db/schema";
import { audit } from "./audit";
import { CAN, requireStaff, type Staff } from "./auth";
import { engineBoss, sendEngineJob } from "./engine-queue";

export type ActionResult = { ok?: string; error?: string };

/** Kind: function. Who, as stored in the engine (core.changes.actor, core.row_history.actor). */
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
      const [row] = await tx.select().from(settings).where(eq(settings.key, DISABLED_SCHEDULES_KEY));
      const set = new Set((row?.value as string[] | undefined) ?? []);
      if (enabled) set.delete(name);
      else set.add(name);
      const value = [...set].sort();
      await tx
        .insert(settings)
        .values({ key: DISABLED_SCHEDULES_KEY, value, updatedBy: staff.email })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: staff.email, updatedAt: new Date() } });
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
    await tx.update(lbrNumberSpace).set({ enabled: v.data.enabled, maxKnown: v.data.maxKnown, sweptTo: v.data.sweptTo, updatedAt: new Date() }).where(eq(lbrNumberSpace.prefix, v.data.prefix));
  });
  await audit(staff, "update", "engine-ops.lbr_number_space", null, v.data);
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
  status: z.enum(COMPANY_STATUSES).nullable().optional(),
  address: addressInput.nullable().optional(),
  registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  website: z.url().nullable().optional(),
  operatingCountries: z.array(z.string()).nullable().optional(),
});
const classificationInput = z.union([
  z.literal("rules"),
  z.object({
    isServiceProvider: z.boolean(),
    companyKind: z.enum(COMPANY_KINDS),
    activityCategoryId: z.number().int().nullable(),
    activitySubcategoryId: z.number().int().nullable(),
    tier: z.number().int().min(0).max(2),
    fundRegime: z.enum(FUND_REGIMES).nullish(),
    fundLaw: z.enum(FUND_LAWS).nullish(),
    legalVehicle: z.enum(LEGAL_VEHICLES).nullish(),
    fundRole: z.enum(FUND_ROLES).nullish(),
    managerType: z.enum(MANAGER_TYPES).nullish(),
  }),
]);

/**
 * Kind: server action. Saves a staff edit of an entity. Each field: a value = override (wins over the
 * registers), `null` = remove the override (the registers take over). Fields not sent are untouched.
 */
export async function saveEntityEdit(companyId: string, edit: unknown, classification?: unknown): Promise<ActionResult> {
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
      return applyManualEdit(tx, companyId, e.data, c?.data, actorOf(staff));
    });
    if (changed.length) await audit(staff, "update", "engine-entity", companyId, { changed, edit: e.data, classification: c?.data });
    revalidatePath(`/engine/companies/${companyId}`);
    return { ok: changed.length ? `Saved: ${changed.join(", ")}` : "Nothing changed" };
  } catch (err) {
    return fail(err);
  }
}

const relationInput = z.object({ kind: z.enum(RELATION_KINDS), objectName: z.string().trim().min(1), objectCompanyId: z.uuid().nullish(), evidenceUrl: z.url().nullish() });

/** Kind: server action. Adds a client (or other relation) to an entity. */
export async function addRelation(companyId: string, input: unknown): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const r = relationInput.safeParse(input);
  if (!r.success) return { error: `${r.error.issues[0]?.path.join(".")}: ${r.error.issues[0]?.message}` };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await setManualRelation(tx, companyId, r.data, actorOf(staff));
    });
    await audit(staff, "create", "engine-relation", companyId, r.data);
    revalidatePath(`/engine/companies/${companyId}`);
    return { ok: `Added ${r.data.objectName}` };
  } catch (err) {
    return fail(err);
  }
}

/** Kind: server action. Ends a relation (kept as history). */
export async function endRelationAction(companyId: string, relationId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const done = await engineDb.transaction(async (tx) => {
    await withActor(tx, actorOf(staff));
    return endRelation(tx, relationId, actorOf(staff));
  });
  if (done) await audit(staff, "end", "engine-relation", relationId, { companyId });
  revalidatePath(`/engine/companies/${companyId}`);
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
      const [m] = await tx.select().from(candidates).where(and(eq(candidates.id, candidateId), eq(candidates.decision, "pending")));
      if (!m) throw new Error("Already decided");
      await tx.update(candidates).set({ decision: accept ? "accepted" : "rejected", decidedBy: staff.email, decidedAt: new Date() }).where(eq(candidates.id, candidateId));
      if (!accept) return "Kept apart";
      const [rec] = await tx.select({ companyId: sourceRecords.companyId }).from(sourceRecords).where(eq(sourceRecords.id, m.sourceRecordId));
      if (rec?.companyId && rec.companyId !== m.companyId) await mergeCompanies(tx, m.companyId, rec.companyId, "manual");
      else await tx.update(sourceRecords).set({ companyId: m.companyId }).where(eq(sourceRecords.id, m.sourceRecordId));
      return "Merged into one company";
    });
    await audit(staff, accept ? "accept-match" : "reject-match", "engine-match", candidateId, {});
    revalidatePath("/engine/review");
    return { ok: msg };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ capture rounds

const roundInput = z.object({
  kind: z.enum(["initial", "update"]),
  filter: z.enum(["all", "sp", "am", "text"]),
  text: z.string().trim().optional(),
  skipDays: z.number().int().min(0).max(365).optional(),
  name: z.string().trim().max(80).optional(),
});

/** Kind: server action. Starts a capture round (closes the active one, which stays in the register). */
export async function startCaptureRound(input: z.infer<typeof roundInput>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  const v = roundInput.safeParse(input);
  if (!v.success) return { error: v.error.issues[0]?.message ?? "Invalid values" };
  if (v.data.filter === "text" && !v.data.text) return { error: "Enter a name or B-number for the scope" };
  const scope = { filter: v.data.filter, ...(v.data.text ? { text: v.data.text } : {}), ...(v.data.skipDays ? { skipCapturedWithinDays: v.data.skipDays } : {}) };
  const out = await engineDb.transaction(async (tx) => {
    await withActor(tx, actorOf(staff));
    return startRound({ kind: v.data.kind, scope, name: v.data.name || undefined, actor: actorOf(staff) }, tx);
  });
  await audit(staff, "start", "engine-round", out.round.id, { ...v.data, items: out.items });
  revalidatePath("/engine/rounds");
  return { ok: `Round "${out.round.name}" started with ${out.items.toLocaleString()} companies` };
}

/** Kind: server action. Closes the active capture round. */
export async function closeCaptureRound(): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  const r = await engineDb.transaction(async (tx) => {
    await withActor(tx, actorOf(staff));
    return closeRound(tx);
  });
  if (r) await audit(staff, "close", "engine-round", r.id, {});
  revalidatePath("/engine/rounds");
  return r ? { ok: `Round "${r.name}" closed` } : { error: "No active round" };
}

/** Kind: server action. Puts skipped / failed companies of the active round back in the queue. */
export async function resetCaptureRoundSkipped(): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  const n = await resetSkipped(engineDb);
  await audit(staff, "reset-skipped", "engine-round", null, { n });
  revalidatePath("/engine/rounds");
  return { ok: `${n} companies back in the queue` };
}

// ------------------------------------------------------------------ staging approval gate

const stagingDecision = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Kind: server action. Approves or rejects one or more versions held at the staging gate. Approval queues
 * `staging_release` per version (a worker of the "maintenance" group runs clean → match → core).
 */
export async function decideStaging(input: z.infer<typeof stagingDecision>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const parsed = stagingDecision.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { ids, decision, note } = parsed.data;
  try {
    const done = await engineDb
      .update(parsedRecords)
      .set({ reviewStatus: decision === "approve" ? "approved" : "rejected", reviewedBy: staff.email, reviewedAt: new Date(), reviewNote: note ?? null })
      .where(and(inArray(parsedRecords.id, ids), eq(parsedRecords.reviewStatus, "pending")))
      .returning({ id: parsedRecords.id });
    if (decision === "approve") for (const d of done) await sendEngineJob("staging_release", { parsedId: d.id });
    await audit(staff, decision === "approve" ? "approve-staging" : "reject-staging", "engine-staging", null, { ids: done.map((d) => d.id), note });
    revalidatePath("/engine/review");
    revalidatePath("/engine");
    const n = done.length;
    return { ok: decision === "approve" ? `${n} approved — released by the next maintenance worker run.` : `${n} rejected (kept in staging for audit).` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Kind: server action. Approves a held version WITH corrections: `facts` replaces the parsed facts (changed golden
 * attributes become staff claims that win and can be cleared later); lists are taken from the edited version.
 */
export async function editAndApproveStaging(id: number, edited: Record<string, unknown>, note?: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  if (!edited || typeof edited !== "object" || typeof edited.facts !== "object") return { error: "The edited version must be a record with a 'facts' object." };
  try {
    const [p] = await engineDb.select({ payload: parsedRecords.payload }).from(parsedRecords).where(and(eq(parsedRecords.id, id), eq(parsedRecords.reviewStatus, "pending")));
    if (!p) return { error: "Already decided" };
    // Identity fields cannot be changed here (they decide which record / company this is).
    const merged = { ...p.payload, ...edited, source: p.payload.source, externalId: p.payload.externalId, state: p.payload.state, identifiers: p.payload.identifiers };
    await engineDb.update(parsedRecords).set({ reviewStatus: "edited", editedPayload: merged, reviewedBy: staff.email, reviewedAt: new Date(), reviewNote: note ?? null }).where(eq(parsedRecords.id, id));
    await sendEngineJob("staging_release", { parsedId: id });
    await audit(staff, "edit-approve-staging", "engine-staging", id, { note });
    revalidatePath("/engine/review");
    return { ok: "Approved with corrections — released by the next maintenance worker run." };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ conflicts & mentions

/** Kind: server action. Marks a cross-source conflict resolved (checked; the golden value is right) or ignored. */
export async function decideConflict(id: number, status: "resolved" | "ignored", note?: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  try {
    const [c] = await engineDb.update(conflicts).set({ status, resolvedBy: staff.email, resolvedAt: new Date(), updatedAt: new Date(), note: note ?? null }).where(and(eq(conflicts.id, id), eq(conflicts.status, "open"))).returning();
    if (!c) return { error: "Already decided" };
    await audit(staff, `conflict-${status}`, "engine-conflict", id, { attribute: c.attribute });
    revalidatePath("/engine/review");
    return { ok: status === "resolved" ? "Marked resolved. Correct the value on the company page if the winner is wrong." : "Ignored: it will not be raised again." };
  } catch (err) {
    return fail(err);
  }
}

/** Kind: server action. Accepts or rejects an uncertain news mention. */
export async function decideMention(id: number, accept: boolean): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  try {
    const [m] = await engineDb.update(newsMentions).set({ decision: accept ? "accepted" : "rejected", decidedBy: staff.email, decidedAt: new Date() }).where(and(eq(newsMentions.id, id), eq(newsMentions.decision, "pending"))).returning();
    if (!m) return { error: "Already decided" };
    if (accept) await engineDb.insert(changes).values({ companyId: m.companyId, source: "news", kind: "news_mention", newValue: { articleId: m.articleId, confidence: m.confidence }, actor: actorOf(staff) });
    await audit(staff, accept ? "accept-mention" : "reject-mention", "engine-mention", id, {});
    revalidatePath("/engine/review");
    return { ok: accept ? "Linked to the company." : "Not about this company." };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ sources & review policies

/** Kind: server action. Enables or disables a source (its jobs skip records of a disabled source). */
export async function setSourceEnabled(code: string, enabled: boolean): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineJobs);
  if (!(ENGINE_SOURCES as readonly string[]).includes(code)) return { error: "Unknown source" };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await tx.update(sources).set({ enabled, updatedBy: staff.email, updatedAt: new Date() }).where(eq(sources.code, code as (typeof ENGINE_SOURCES)[number]));
    });
    await audit(staff, enabled ? "enable-source" : "disable-source", "engine-source", null, { code });
    revalidatePath("/engine/sources");
    return { ok: `${code} ${enabled ? "enabled" : "disabled"}.` };
  } catch (err) {
    return fail(err);
  }
}

const policyInput = z.object({
  source: z.string().refine((s) => s === "*" || (ENGINE_SOURCES as readonly string[]).includes(s), "Unknown source"),
  scope: z.string().trim().min(1).max(60).default("*"),
  mode: z.enum(REVIEW_MODES),
  newRecord: z.boolean().optional(),
  newCompany: z.boolean().optional(),
  parserChanged: z.boolean().optional(),
  protectedAttributes: z.array(z.string().trim().min(1)).max(30).optional(),
  minConfidence: z.number().min(0).max(1).nullable().optional(),
  sampleRate: z.number().min(0).max(1).default(0),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(300).optional(),
});

/** Kind: server action. Creates or updates the staging review policy of a source (and scope). Applies within a minute. */
export async function savePolicy(input: z.input<typeof policyInput>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const parsed = policyInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const p = parsed.data;
  const conditions = {
    ...(p.newRecord ? { newRecord: true } : {}),
    ...(p.newCompany ? { newCompany: true } : {}),
    ...(p.parserChanged ? { parserChanged: true } : {}),
    ...(p.protectedAttributes?.length ? { protectedAttributes: p.protectedAttributes } : {}),
    ...(typeof p.minConfidence === "number" ? { minConfidence: p.minConfidence } : {}),
  };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      const row = { mode: p.mode, conditions, sampleRate: p.sampleRate, enabled: p.enabled, note: p.note ?? null, updatedBy: staff.email, updatedAt: new Date() };
      await tx.insert(reviewPolicies).values({ source: p.source, scope: p.scope, ...row }).onConflictDoUpdate({ target: [reviewPolicies.source, reviewPolicies.scope], set: row });
    });
    await audit(staff, "save-review-policy", "engine-policy", null, { ...p });
    revalidatePath("/engine/sources");
    return { ok: `Policy for ${p.source}${p.scope !== "*" ? ` / ${p.scope}` : ""} saved (applies within a minute).` };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ company groups (staff edits = source "manual")

const groupInput = z.object({
  name: z.string().trim().min(2).max(200),
  layer: z.enum(GROUP_LAYERS),
  kind: z.enum(GROUP_KINDS),
  parentGroupId: z.number().int().positive().nullish(),
  description: z.string().trim().max(1000).nullish(),
});

/** Kind: function. A group may not become its own ancestor. */
async function wouldLoop(groupId: number, parentId: number | null | undefined) {
  for (let id = parentId ?? null, n = 0; id && n < 20; n++) {
    if (id === groupId) return true;
    const [g] = await engineDb.select({ parent: companyGroups.parentGroupId }).from(companyGroups).where(eq(companyGroups.id, id));
    id = g?.parent ?? null;
  }
  return false;
}

/** Kind: server action. Creates a staff group (never changed by the builder). @returns its id in `ok`. */
export async function createGroup(input: unknown): Promise<ActionResult & { id?: number }> {
  const staff = await requireStaff(CAN.engineEdit);
  const g = groupInput.safeParse(input);
  if (!g.success) return { error: `${g.error.issues[0]?.path.join(".")}: ${g.error.issues[0]?.message}` };
  try {
    const [row] = await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      return tx.insert(companyGroups).values({ key: `manual:${crypto.randomUUID()}`, source: "manual", name: g.data.name, layer: g.data.layer, kind: g.data.kind, parentGroupId: g.data.parentGroupId ?? null, description: g.data.description ?? null }).returning({ id: companyGroups.id });
    });
    await audit(staff, "create", "engine-group", row.id, g.data);
    revalidatePath("/engine/groups");
    return { ok: "Group created", id: row.id };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Kind: server action. Renames / re-parents / describes a group. Editing a generated group turns it into a
 * staff group (source "manual"), so the builder keeps the edit.
 */
export async function updateGroup(groupId: number, input: unknown): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const g = groupInput.partial().safeParse(input);
  if (!g.success) return { error: `${g.error.issues[0]?.path.join(".")}: ${g.error.issues[0]?.message}` };
  if (g.data.parentGroupId !== undefined && (await wouldLoop(groupId, g.data.parentGroupId))) return { error: "A group cannot sit under itself or its own sub-group." };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await tx.update(companyGroups).set({ ...g.data, source: "manual", updatedAt: new Date() }).where(eq(companyGroups.id, groupId));
    });
    await audit(staff, "update", "engine-group", groupId, g.data);
    revalidatePath(`/engine/groups/${groupId}`);
    return { ok: "Group saved" };
  } catch (err) {
    return fail(err);
  }
}

/** Kind: server action. Deletes a staff group (generated groups are rebuilt; they cannot be deleted here). */
export async function deleteGroup(groupId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const [g] = await engineDb.select({ source: companyGroups.source, name: companyGroups.name }).from(companyGroups).where(eq(companyGroups.id, groupId));
  if (!g) return { error: "Group not found" };
  if (g.source !== "manual") return { error: "Only staff groups can be deleted. Generated groups follow GLEIF / CSSF; remove members instead." };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await tx.delete(companyGroups).where(eq(companyGroups.id, groupId));
    });
    await audit(staff, "delete", "engine-group", groupId, { name: g.name });
    revalidatePath("/engine/groups");
    return { ok: "Group deleted" };
  } catch (err) {
    return fail(err);
  }
}

const memberInput = z.object({ companyId: z.uuid(), role: z.enum(GROUP_ROLES), evidence: z.string().trim().max(500).nullish() });

/** Kind: function. Keeps a group's member count right after a staff change. */
async function recount(groupId: number) {
  await engineDb.execute(sql`update core.company_groups set member_count = (select count(*) from core.company_group_members where group_id = ${groupId} and valid_to is null) where id = ${groupId}`);
}

/** Kind: server action. Adds a company to a group (or changes its role), as a staff membership. */
export async function addGroupMember(groupId: number, input: unknown): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const m = memberInput.safeParse(input);
  if (!m.success) return { error: `${m.error.issues[0]?.path.join(".")}: ${m.error.issues[0]?.message}` };
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await tx
        .insert(companyGroupMembers)
        .values({ groupId, companyId: m.data.companyId, role: m.data.role, source: "manual", evidence: m.data.evidence ?? `added by ${staff.email}` })
        .onConflictDoUpdate({ target: [companyGroupMembers.groupId, companyGroupMembers.companyId], set: { role: m.data.role, source: "manual", confidence: 1, validTo: null, evidence: m.data.evidence ?? `set by ${staff.email}` } });
    });
    await recount(groupId);
    await audit(staff, "update", "engine-group", groupId, { add: m.data });
    revalidatePath(`/engine/groups/${groupId}`);
    revalidatePath(`/engine/companies/${m.data.companyId}`);
    return { ok: "Member saved (the company's fund profile updates at the next reclassify)" };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Kind: server action. Removes a company from a group. The row is kept, ended and marked "manual", so the
 * builder does not put it back.
 */
export async function removeGroupMember(groupId: number, companyId: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      await tx
        .update(companyGroupMembers)
        .set({ validTo: new Date(), source: "manual", evidence: `removed by ${staff.email}` })
        .where(and(eq(companyGroupMembers.groupId, groupId), eq(companyGroupMembers.companyId, companyId)));
    });
    await recount(groupId);
    await audit(staff, "update", "engine-group", groupId, { remove: companyId });
    revalidatePath(`/engine/groups/${groupId}`);
    return { ok: "Removed from the group" };
  } catch (err) {
    return fail(err);
  }
}

/** Kind: server action. Company picker: companies whose name, RCS number or LEI matches. */
export async function findCompanies(q: string) {
  await requireStaff(CAN.engine);
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return engineDb
    .select({ id: companies.id, name: companies.canonicalName, rcsNumber: companies.rcsNumber, kind: companies.companyKind })
    .from(companies)
    .where(sql`${companies.canonicalName} ilike ${like} or ${companies.rcsNumber} ilike ${like} or ${companies.lei} ilike ${like}`)
    .orderBy(companies.canonicalName)
    .limit(20);
}

/** Kind: server action. Group picker. */
export async function findGroups(q: string) {
  await requireStaff(CAN.engine);
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return engineDb
    .select({ id: companyGroups.id, name: companyGroups.name, layer: companyGroups.layer, kind: companyGroups.kind, memberCount: companyGroups.memberCount })
    .from(companyGroups)
    .where(sql`${companyGroups.name} ilike ${like}`)
    .orderBy(sql`${companyGroups.memberCount} desc`)
    .limit(20);
}

// ------------------------------------------------------------------ service mandates (staff edits win over sources)

const mandateInput = z.object({
  role: z.enum(MANDATE_ROLES),
  providerCompanyId: z.uuid().nullish(),
  providerName: z.string().trim().min(2).max(300),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  validFromPrecision: z.enum(DATE_PRECISIONS).default("day"),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().trim().max(500).nullish(),
});

/**
 * Kind: server action. Records a service mandate by hand (e.g. "depositary: X since 2021-03"). For a role that is
 * exclusive (one provider at a time), the current episode of that role ends where the new one starts.
 */
export async function addMandate(clientCompanyId: string, input: unknown): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  const m = mandateInput.safeParse(input);
  if (!m.success) return { error: `${m.error.issues[0]?.path.join(".")}: ${m.error.issues[0]?.message}` };
  const d = m.data;
  try {
    await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      const [role] = await tx.select().from(mandateRoles).where(eq(mandateRoles.code, d.role));
      const exclusive = role?.exclusive ?? false;
      if (exclusive && !d.validTo) {
        const open = await tx.select().from(mandates).where(and(eq(mandates.clientCompanyId, clientCompanyId), eq(mandates.role, d.role), eq(mandates.status, "current")));
        for (const o of open) {
          const end = d.validFrom ?? new Date().toISOString().slice(0, 10);
          await tx.update(mandates).set({ status: "ended", validTo: end, validToPrecision: d.validFrom ? d.validFromPrecision : "month", lastSeenAt: new Date() }).where(eq(mandates.id, o.id));
        }
      }
      await tx.insert(mandates).values({
        clientCompanyId, role: d.role, exclusive, providerCompanyId: d.providerCompanyId ?? null, providerName: d.providerName,
        validFrom: d.validFrom ?? null, validFromPrecision: d.validFrom ? d.validFromPrecision : "unknown", validTo: d.validTo ?? null, validToPrecision: d.validTo ? "day" : null,
        status: d.validTo ? "ended" : "current", decidedBy: actorOf(staff),
      });
      await tx.insert(changes).values({ companyId: clientCompanyId, source: "manual", kind: "mandate_started", attribute: d.role, newValue: d.providerName, actor: actorOf(staff) });
    });
    await audit(staff, "create", "engine-mandate", clientCompanyId, d);
    revalidatePath(`/engine/companies/${clientCompanyId}`);
    return { ok: "Mandate saved" };
  } catch (err) {
    const msg = fail(err).error ?? "";
    return { error: /mandates_no_overlap/.test(msg) ? "This overlaps another episode of the same role: adjust the dates." : msg };
  }
}

/** Kind: server action. Ends a current mandate on a date (staff: the builders keep it ended). */
export async function endMandate(mandateId: number, validTo: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.engineEdit);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validTo)) return { error: "Date as YYYY-MM-DD" };
  try {
    const [m] = await engineDb.transaction(async (tx) => {
      await withActor(tx, actorOf(staff));
      const rows = await tx.update(mandates).set({ status: "ended", validTo, validToPrecision: "day", decidedBy: actorOf(staff), lastSeenAt: new Date() }).where(eq(mandates.id, mandateId)).returning();
      if (rows[0]) await tx.insert(changes).values({ companyId: rows[0].clientCompanyId, source: "manual", kind: "mandate_ended", attribute: rows[0].role, oldValue: rows[0].providerName, actor: actorOf(staff) });
      return rows;
    });
    if (!m) return { error: "Mandate not found" };
    await audit(staff, "update", "engine-mandate", mandateId, { validTo });
    revalidatePath(`/engine/companies/${m.clientCompanyId}`);
    return { ok: "Mandate ended" };
  } catch (err) {
    const msg = fail(err).error ?? "";
    return { error: /mandates_no_overlap/.test(msg) ? "That end date overlaps the next episode." : msg };
  }
}
