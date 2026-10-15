import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AiWebSource, ExtractionError, normalize, outputSchema } from "../src/sources/ai-web";
import { MockRcsClient, RcsSource } from "../src/sources/rcs";
import { runSource } from "../src/runner";
import type { Settings } from "../src/config";
import type { ProviderRef, Source } from "../src/types";

const settings: Settings = { model: "claude-opus-5-5", effort: "medium", maxPages: 3, maxChars: 10_000, userAgent: "test", rcsSource: "mock" };
const provider: ProviderRef = {
  id: 1,
  slug: "acme",
  name: "Acme Fund Services S.A.",
  website: "https://www.acme.lu/",
  rcsNumber: "B 1",
  headquarters: "Kirchberg, Luxembourg",
  foundedYear: 2009,
};
const pages = [{ url: "https://www.acme.lu/", title: "Acme", text: "We are Acme." }];
const f = (value: unknown, confidence = 0.9, source_url: string | null = "https://www.acme.lu/") => ({ value, confidence, source_url });

describe("outputSchema", () => {
  it("is a strict object whose list enums are the canonical taxonomy names", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = outputSchema() as { additionalProperties: boolean; required: string[]; properties: Record<string, any> };
    assert.equal(s.additionalProperties, false);
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
    assert.ok(s.properties.services.properties.value.items.enum.includes("Fund Accounting & NAV Calculation"));
  });
});

describe("normalize", () => {
  it("keeps valid facts and drops unknown names, zero confidence and implausible numbers", () => {
    const out = normalize(
      {
        services: f(["Fund Accounting & NAV Calculation", "Made-up Service"]),
        licences: f(["Specialised PSF"], 1.7),
        techStack: f(["eFront", "eFront", " "]),
        headcount: f(500000),
        foundedYear: f(2009, 0.8, "https://evil.example/"),
        description: f("Central administrator.", 0),
      },
      new Set(pages.map((p) => p.url)),
    );
    assert.deepEqual(out.services!.value, ["Fund Accounting & NAV Calculation"]);
    assert.equal(out.licences!.confidence, 1);
    assert.deepEqual(out.techStack!.value, ["eFront"]);
    assert.equal(out.headcount, undefined);
    assert.equal(out.foundedYear!.sourceUrl, null, "source URL not among crawled pages is dropped");
    assert.equal(out.description, undefined);
  });
});

function fakeClient(response: Record<string, unknown>, seen: Record<string, unknown>[] = []) {
  return {
    beta: { messages: { create: async (params: Record<string, unknown>) => (seen.push(params), response) } },
  } as never;
}

describe("AiWebSource", () => {
  it("sends a structured-output request with refusal fallback and parses the result", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seen: Record<string, any>[] = [];
    const client = fakeClient(
      {
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "text", text: JSON.stringify({ services: f(["Transfer Agency & Shareholder Register"]) }) }],
      },
      seen,
    );
    const ext = await new AiWebSource(settings, client, async () => pages).fetch(provider);
    assert.deepEqual(ext!.fields.services!.value, ["Transfer Agency & Shareholder Register"]);
    assert.equal(seen[0]!.model, "claude-opus-5-5");
    assert.equal(seen[0]!.fallbacks, "default");
    assert.deepEqual(seen[0]!.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(seen[0]!.output_config.format.type, "json_schema");
    assert.match(seen[0]!.system, /untrusted data/);
  });

  it("raises on refusal instead of storing anything", async () => {
    const client = fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [], usage: {} });
    await assert.rejects(new AiWebSource(settings, client, async () => pages).fetch(provider), ExtractionError);
  });

  it("skips providers without a website", async () => {
    assert.equal(await new AiWebSource(settings, fakeClient({}), async () => pages).fetch({ ...provider, website: null }), null);
  });
});

describe("RcsSource (mock)", () => {
  it("echoes known data with low confidence, flagged as mock", async () => {
    const ext = await new RcsSource(settings, new MockRcsClient()).fetch(provider);
    assert.equal(ext!.fields.rcsNumber!.value, "B 1");
    assert.equal(ext!.fields.rcsNumber!.confidence, 0.3);
    assert.equal(ext!.raw.mock, true);
  });
});

describe("runSource", () => {
  it("records successes and keeps going when one provider fails", async () => {
    const calls: string[] = [];
    const source: Source = {
      name: "ai_web",
      fetch: async (p) => {
        if (p.slug === "bad") throw new Error("boom");
        if (p.slug === "empty") return null;
        return { provider: p, sourceUrl: null, fields: { headcount: { value: 10, confidence: 1, sourceUrl: null } }, raw: {} };
      },
    };
    const store = {
      startRun: async () => (calls.push("start"), 7),
      saveRecord: async () => (calls.push("save"), 1),
      changedFields: async (ext: { fields: Record<string, unknown> }) => ext.fields,
      finishRun: async (_id: number, status: string) => void calls.push(`finish:${status}`),
    } as never;
    const { runId, stats } = await runSource(source, [provider, { ...provider, slug: "bad" }, { ...provider, slug: "empty" }], {
      trigger: "test",
      log: () => {},
      saveImpl: store,
    });
    assert.equal(runId, 7);
    assert.deepEqual(stats, { providers: 3, records: 1, unchanged: 0, empty: 1, failed: 1 });
    assert.deepEqual(calls, ["start", "save", "finish:succeeded"]);
  });
});
