/**
 * FILE: services/engine/test/rounds.test.ts
 * PART: scraping engine (services/engine) — integration tests (need the engine database)
 * WHAT IT DOES: Checks capture rounds against a real engine database, inside ONE transaction that is rolled back:
 *   initial round snapshot, recording visits (captured / unchanged), skip + reset ("clean the cycle"), update
 *   round over captured companies, only one active round, and the register totals. Uses fake RCS numbers
 *   B99999xx. Skipped when no engine database is reachable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { db, pool } from "@fundhub/engine-db/client";
import { activeRound, closeRound, listRounds, nextItems, recordDocument, recordVisit, resetSkipped, roundStats, skipItem, startRound } from "@fundhub/engine-db/core/rounds";
import { captureRounds, entities, entityIdentifiers, sourceRecords } from "@fundhub/engine-db/schema";

async function dbReady() {
  try {
    const r = await pool.query("select to_regclass('public.capture_rounds') as t");
    return r.rows[0].t !== null;
  } catch {
    return false;
  }
}
const ready = await dbReady();
class Rollback extends Error {}

test("capture rounds: initial snapshot, visits, skip/reset, update round, one active, register", { skip: !ready && "engine database not reachable" }, async () => {
  try {
    await db.transaction(async (tx) => {
      // Two fake companies known from another source, the first one a service provider.
      const [a] = await tx.insert(entities).values({ canonicalName: "Roundtest Alpha SA", normalizedName: "roundtest alpha", isServiceProvider: true, entityKind: "service_provider", tier: 2 }).returning({ id: entities.id });
      const [b] = await tx.insert(entities).values({ canonicalName: "Roundtest Beta SARL", normalizedName: "roundtest beta" }).returning({ id: entities.id });
      await tx.insert(entityIdentifiers).values([
        { entityId: a.id, scheme: "rcs", value: "B9999901", source: "gleif" },
        { entityId: b.id, scheme: "rcs", value: "B9999902", source: "gleif" },
      ]);

      // 1. Initial round limited to these numbers: both, service provider first.
      const r1 = await startRound({ kind: "initial", scope: { filter: "text", text: "B99999" }, name: "test initial", actor: "test" }, tx);
      assert.equal(r1.items, 2);
      assert.deepEqual((await nextItems(5, tx)).map((i) => i.rcs), ["B9999901", "B9999902"]);
      assert.equal((await activeRound(tx))!.id, r1.round.id);

      // 2. Visit the first: captured, 3 new filings, 2 documents; it leaves the queue.
      await recordVisit("B9999901", { status: "new", filingsAfter: 3, newFilings: 3 }, tx);
      await recordDocument("B9999901", tx);
      await recordDocument("B9999901", tx);
      assert.deepEqual((await nextItems(5, tx)).map((i) => i.rcs), ["B9999902"]);

      // 3. Skip the second, then "clean the cycle": it is pending again.
      assert.equal(await skipItem("B9999902", tx), true);
      assert.equal((await nextItems(5, tx)).length, 0);
      assert.equal(await resetSkipped(tx), 1);
      assert.deepEqual((await nextItems(5, tx)).map((i) => i.rcs), ["B9999902"]);

      let s = await roundStats(r1.round.id, tx);
      assert.deepEqual([s.total, s.done, s.captured, s.pending, s.new_filings, s.new_documents], [2, 1, 1, 1, 3, 2]);

      // 4. Only one active round (database rule).
      await assert.rejects(tx.transaction((sp) => sp.insert(captureRounds).values({ name: "second active", kind: "initial", scope: { filter: "all" } })));

      // 5. Update round: only companies already captured from the RCS (here: the first one).
      await tx.insert(sourceRecords).values({ source: "rcs", externalId: "B9999901", entityId: a.id, state: "found" });
      const r2 = await startRound({ kind: "update", scope: { filter: "text", text: "B99999" }, actor: "test" }, tx);
      assert.equal(r2.items, 1);
      assert.equal((await activeRound(tx))!.id, r2.round.id);
      await recordVisit("B9999901", { status: "unchanged", filingsAfter: 3, newFilings: 0 }, tx);
      s = await roundStats(r2.round.id, tx);
      assert.deepEqual([s.total, s.unchanged, s.new_filings, s.pending], [1, 1, 0, 0]);

      // 6. Visiting a company that is not in the round changes nothing in it.
      await recordVisit("B9999902", { status: "new" }, tx);
      assert.equal((await roundStats(r2.round.id, tx)).total, 1);

      // 7. Register: both rounds, the first one closed.
      await closeRound(tx);
      const reg = (await listRounds(tx)).filter((r) => r.id === r1.round.id || r.id === r2.round.id);
      assert.deepEqual(reg.map((r) => r.status), ["closed", "closed"]);
      assert.equal(await activeRound(tx), null);

      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
});

test.after(() => pool.end());
