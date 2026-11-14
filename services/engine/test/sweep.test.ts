/**
 * FILE: services/engine/test/sweep.test.ts
 * PART: scraping engine (services/engine) — integration test (needs the engine database)
 * WHAT IT DOES: Checks the LBR search sweep (word searches) against a real engine database, inside ONE transaction
 *   that is rolled back: seeding words from known names, booking a results page (word done, capped flag, new
 *   companies counted, their words added to the queue), a search outside the plan, RCS-like searches ignored,
 *   skip / reset. Uses made-up words ("zqxfoo…"). Skipped when no engine database is reachable.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { db, pool } from "@fundhub/engine-db/client";
import { nextSweepItems, planSweep, recordSearch, resetSkippedSweep, skipSweepTerm } from "@fundhub/engine-db/core/sweep";
import { entities } from "@fundhub/engine-db/schema";

async function dbReady() {
  try {
    const r = await pool.query("select to_regclass('public.lbr_search_words') as t");
    return r.rows[0].t !== null;
  } catch {
    return false;
  }
}
const ready = await dbReady();
class Rollback extends Error {}

test("search sweep: seed words, book a page, snowball new names' words, skip/reset", { skip: !ready && "engine database not reachable (or migration 0006 not applied)" }, async () => {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(entities).values([
        { canonicalName: "Zqxfoo Zqxbar S.à r.l.", normalizedName: "zqxfoo zqxbar" },
        { canonicalName: "Zqxfoo Invest", normalizedName: "zqxfoo invest" },
      ]);
      const out = await planSweep(tx);
      assert.ok(out.words > 0);
      const w = (await tx.execute<{ term: string; seen: number; status: string }>(sql`select term, seen, status from lbr_search_words where term like 'zqx%' and length(term) > 3 order by term`)).rows;
      assert.deepEqual(w.map((r) => [r.term, r.seen, r.status]), [["zqxbar", 1, "pending"], ["zqxfoo", 2, "pending"]]);

      // A page for "Zqxfoo": two companies, one new to the engine → its words join the queue.
      const page = [
        { rcs: "B9999901", name: "Zqxfoo Zqxbar S.à r.l." },
        { rcs: "B9999902", name: "Zqxfoo Zqxnew Holding" },
      ];
      const r = await recordSearch("Zqxfoo", 2, page, new Set(["B9999902"]), tx);
      assert.deepEqual({ ...r, addedWords: undefined }, { term: "zqxfoo", total: 2, rows: 2, newNumbers: 1, capped: false, addedWords: undefined, planned: true });
      assert.ok((r?.addedWords ?? 0) >= 1);
      const nw = (await tx.execute<{ status: string; origin: string }>(sql`select status, origin from lbr_search_words where term = 'zqxnew'`)).rows[0];
      assert.deepEqual({ ...nw }, { status: "pending", origin: "results" });
      assert.equal((await tx.execute<{ status: string }>(sql`select status from lbr_search_words where term = 'zqxfoo'`)).rows[0].status, "done");

      // A full list is "capped"; a search outside the plan is recorded as done; an RCS number is ignored.
      const full = await recordSearch("zqxother", 199, page, new Set(), tx);
      assert.equal(full?.capped, true);
      assert.equal(full?.planned, false);
      assert.equal(await recordSearch("B145917", 1, page, new Set(), tx), null);

      // Skip + reset.
      assert.ok(await skipSweepTerm("ZQXBAR", tx));
      assert.ok(!(await nextSweepItems(100000, tx)).some((t) => t.term === "zqxbar"));
      assert.ok((await resetSkippedSweep(tx)) >= 1);
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  } finally {
    await pool.end();
  }
});
