/**
 * FILE: services/engine/test/db.integration.test.ts
 * PART: scraping engine (services/engine) — integration tests (need the engine database)
 * WHAT IT DOES: Checks change recording against a real engine database: a staff edit overrides the register
 *   value, is recorded in observations / change_events (with the actor) / row_history (via the trigger), and
 *   clearing it hands the field back to the register. Everything runs in ONE transaction that is rolled back,
 *   so the database is left untouched. Skipped when no engine database is reachable.
 *   Run: `npm run engine:db:local` (or set ENGINE_DATABASE_URL), then `npm test -w @fundhub/engine`.
 * TYPESCRIPT YOU WILL SEE HERE: node:test `skip`, a sentinel error to force a rollback.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@fundhub/engine-db/client";
import { applyManualEdit, endRelation, recomputeEntity, setManualRelation, withActor } from "@fundhub/engine-db/core/entity";
import { changeEvents, entities, observations, rowHistory, sourceRecords } from "@fundhub/engine-db/schema";

/** Kind: async function. True when the engine database answers and has migration 0002 (row_history). */
async function dbReady() {
  try {
    const r = await pool.query("select to_regclass('public.row_history') as t");
    return r.rows[0].t !== null;
  } catch {
    return false;
  }
}

const ready = await dbReady();
class Rollback extends Error {}

test("manual edit overrides, is recorded everywhere, and clearing it restores the register value", { skip: !ready && "engine database not reachable" }, async () => {
  try {
    await db.transaction(async (tx) => {
      await withActor(tx, "staff:test@fundhub.lu");
      // A register entity: one RCS record saying the name is "Testco SA".
      const [e] = await tx.insert(entities).values({ canonicalName: "Testco SA", normalizedName: "testco" }).returning({ id: entities.id });
      const [rec] = await tx.insert(sourceRecords).values({ source: "rcs", externalId: `B-TEST-${Date.now()}`, entityId: e.id }).returning({ id: sourceRecords.id });
      await tx.insert(observations).values([
        { entityId: e.id, sourceRecordId: rec.id, source: "rcs", attribute: "name", value: "Testco SA" },
        { entityId: e.id, sourceRecordId: rec.id, source: "rcs", attribute: "status", value: "active" },
      ]);
      await recomputeEntity(tx, e.id);

      // 1. Staff override.
      const r1 = await applyManualEdit(tx, e.id, { name: "Testco Fund Services S.A.", website: "https://testco.lu", operatingCountries: ["Luxembourg", "Ireland"] }, undefined, "staff:test@fundhub.lu");
      assert.deepEqual(r1.changed.sort(), ["name", "operatingCountries", "website"]);
      let [g] = await tx.select().from(entities).where(eq(entities.id, e.id));
      assert.equal(g.canonicalName, "Testco Fund Services S.A.");
      assert.equal(g.website, "https://testco.lu");
      assert.deepEqual(g.operatingCountries, ["IE", "LU"]);

      const events = await tx.select().from(changeEvents).where(and(eq(changeEvents.entityId, e.id), eq(changeEvents.source, "manual")));
      assert.equal(events.length, 3);
      assert.ok(events.every((ev) => ev.actor === "staff:test@fundhub.lu"));
      assert.equal(events.find((ev) => ev.attribute === "name")!.oldValue, "Testco SA");

      const hist = await tx.select().from(rowHistory).where(and(eq(rowHistory.tableName, "entities"), eq(rowHistory.rowId, e.id)));
      assert.ok(hist.some((h) => h.op === "UPDATE" && h.actor === "staff:test@fundhub.lu" && (h.newRow as { canonical_name: string }).canonical_name === "Testco Fund Services S.A."));

      // 2. Same value again = no change, no new event.
      const r2 = await applyManualEdit(tx, e.id, { name: "Testco Fund Services S.A." }, undefined, "staff:test@fundhub.lu");
      assert.deepEqual(r2.changed, []);

      // 3. Clear the override → the register value is back; the override stays in history (closed).
      await applyManualEdit(tx, e.id, { name: null }, undefined, "staff:test@fundhub.lu");
      [g] = await tx.select().from(entities).where(eq(entities.id, e.id));
      assert.equal(g.canonicalName, "Testco SA");
      const closed = await tx.select().from(observations).where(and(eq(observations.entityId, e.id), eq(observations.source, "manual"), eq(observations.attribute, "name")));
      assert.equal(closed.length, 1);
      assert.ok(closed[0].validTo);

      // 4. Manual classification sticks through a recompute; "rules" hands it back.
      await applyManualEdit(tx, e.id, {}, { isServiceProvider: true, entityKind: "service_provider", activityCategoryId: null, activitySubcategoryId: null, tier: 2 }, "staff:test@fundhub.lu");
      await recomputeEntity(tx, e.id);
      [g] = await tx.select().from(entities).where(eq(entities.id, e.id));
      assert.equal(g.isServiceProvider, true);
      assert.equal(g.classificationSource, "manual");
      await applyManualEdit(tx, e.id, {}, "rules", "staff:test@fundhub.lu");
      [g] = await tx.select().from(entities).where(eq(entities.id, e.id));
      assert.equal(g.classificationSource, "rule");
      assert.equal(g.isServiceProvider, false);

      // 5. Clients: add, then end (kept as history).
      const relId = await setManualRelation(tx, e.id, { kind: "client", objectName: "Silverline SICAV" }, "staff:test@fundhub.lu");
      assert.equal(await endRelation(tx, relId, "staff:test@fundhub.lu"), true);
      assert.equal(await endRelation(tx, relId, "staff:test@fundhub.lu"), false);
      const relHist = await tx.execute<{ n: number }>(sql`select count(*)::int as n from row_history where table_name = 'entity_relations' and row_id = ${String(relId)}`);
      assert.equal(relHist.rows[0].n, 2); // INSERT + UPDATE(valid_to)

      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
});

test.after(() => pool.end());
