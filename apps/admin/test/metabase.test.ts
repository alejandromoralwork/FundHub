/**
 * FILE: apps/admin/test/metabase.test.ts
 * WHAT IT TESTS: src/lib/metabase.ts — the signed embed address and the dashboard listing (Metabase API mocked).
 * RUN: npm test -w @fundhub/admin
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { COLLECTIONS, EMBED_TTL_SECONDS, embedUrl, kindOf, listDashboards, signEmbedToken } from "../src/lib/metabase";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

test("signEmbedToken: HS256 JWT with resource, params and a 10-minute expiry", () => {
  const t = signEmbedToken({ resource: { dashboard: 7 }, params: { year: 2026 } }, "s3cret", 1_000_000);
  const [h, p, sig] = t.split(".");
  assert.deepEqual(decode(h), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(decode(p), { resource: { dashboard: 7 }, params: { year: 2026 }, exp: 1_000_000 + EMBED_TTL_SECONDS });
  assert.equal(sig, createHmac("sha256", "s3cret").update(`${h}.${p}`).digest("base64url"));
});

test("embedUrl: needs the secret, points at /embed/dashboard on the site URL", () => {
  delete process.env.METABASE_EMBED_SECRET;
  assert.throws(() => embedUrl(1), /METABASE_EMBED_SECRET/);
  process.env.METABASE_EMBED_SECRET = "abc";
  process.env.METABASE_SITE_URL = "https://vm.example/bi/";
  const url = embedUrl(3);
  assert.match(url, /^https:\/\/vm\.example\/bi\/embed\/dashboard\/[\w-]+\.[\w-]+\.[\w-]+#bordered=false&titled=false$/);
  assert.equal(decode(url.split("/").pop()!.split("#")[0].split(".")[1]).resource.dashboard, 3);
});

test("kindOf: repo collections vs team", () => {
  assert.equal(kindOf(COLLECTIONS.system), "system");
  assert.equal(kindOf(COLLECTIONS.restricted), "restricted");
  assert.equal(kindOf("Team reports"), "team");
  assert.equal(kindOf("Somebody's folder"), "team");
});

test("listDashboards: only embeddable, not archived, system → restricted → team, sends the API key", async () => {
  process.env.METABASE_API_KEY = "key-1";
  process.env.METABASE_SITE_URL = "https://vm.example/bi";
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push(`${url} ${(init.headers as Record<string, string>)["X-Api-Key"]}`);
    const body = url.endsWith("/dashboard/embeddable")
      ? [{ id: 1, name: "Zeta team" }, { id: 2, name: "Finance" }, { id: 3, name: "Pipeline health" }, { id: 4, name: "Old" }]
      : { data: [
          { id: 1, name: "Zeta team", description: null, collection: { name: "Team reports" } },
          { id: 2, name: "Finance", description: "money", collection: { name: COLLECTIONS.restricted } },
          { id: 3, name: "Pipeline health", description: "runs", collection: { name: COLLECTIONS.system } },
          { id: 4, name: "Old", description: null, collection: { name: COLLECTIONS.system }, archived: true },
          { id: 9, name: "Not embeddable", description: null, collection: { name: COLLECTIONS.system } },
        ] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const list = await listDashboards();
  assert.deepEqual(list.map((d) => [d.id, d.kind]), [[3, "system"], [2, "restricted"], [1, "team"]]);
  assert.ok(seen.every((s) => s.startsWith("https://vm.example/bi/api/") && s.endsWith(" key-1")));
});
