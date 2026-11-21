/**
 * FILE: services/engine/test/sources.test.ts
 * PART: scraping engine (services/engine) — tests of the "website", "news" and "fundhub" sources (no network)
 * WHAT IT DOES: The website bundle parser (RCS verification, roles, social profiles, identifiers only when
 *   verified), the AI extraction with a fake model client, the feed parser (RSS and Atom), and the FundHub
 *   listing parser.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawCapture } from "../src/core/types";
import { parseFundhub, type ProviderRow } from "../src/sources/fundhub/adapter";
import { parseArticle, parseFeed } from "../src/sources/news/parse";
import { pageText } from "../src/sources/website/crawl";
import { extractFacts, normalizeExtraction, type MessagesClient } from "../src/sources/website/extract";
import { parseWebsite, platformOf, roleOf, statesRcs, type WebsiteBundle } from "../src/sources/website/parse";

const rawOf = (source: RawCapture["source"], externalId: string, body: unknown): RawCapture => ({ source, externalId, url: "https://x.test", httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(body)), ext: "json" });

const bundle = (rcsOnPage: string | null): WebsiteBundle => ({
  company: { id: "c1", name: "Acme Fund Services", rcsNumber: "B123456", website: "https://www.acme.lu" },
  fetchedAt: "2026-11-20T10:00:00.000Z",
  pages: [
    { url: "https://www.acme.lu", title: "Acme", text: "Independent central administrator.", footer: rcsOnPage ? `Acme S.A. – R.C.S. Luxembourg ${rcsOnPage}` : "© Acme", social: ["https://www.linkedin.com/company/acme-fs", "https://twitter.com/acmefs"] },
    { url: "https://www.acme.lu/team", title: "Our team", text: "Jane Roe, Chief Executive Officer" },
  ],
  fields: {
    description: { value: "Acme provides fund administration and transfer agency to alternative funds in Luxembourg.", confidence: 0.9, sourceUrl: "https://www.acme.lu" },
    headcount: { value: 120, confidence: 0.8, sourceUrl: "https://www.acme.lu" },
    people: { value: [{ name: "Jane Roe", title: "Chief Executive Officer" }, { name: "John Doe", title: "Board member" }], confidence: 0.7, sourceUrl: "https://www.acme.lu/team" },
    clients: { value: ["Silverline SICAV"], confidence: 0.6, sourceUrl: "https://www.acme.lu" },
  },
  model: "claude-test",
  usage: null,
});

test("website: verified by the RCS number in the footer → domain + RCS identifiers; otherwise none", () => {
  const ok = parseWebsite(rawOf("website", "acme.lu", bundle("B 123 456")));
  assert.equal(ok.externalId, "acme.lu");
  assert.equal(ok.targetCompanyId, "c1");
  assert.equal(ok.facts.websiteVerifiedAt, "2026-11-20T10:00:00.000Z");
  assert.deepEqual(ok.identifiers, [{ scheme: "domain", value: "acme.lu" }, { scheme: "rcs", value: "B123456" }]);
  assert.deepEqual(ok.people?.map((p) => p.role), ["executive", "board"]);
  assert.deepEqual(ok.webPresence?.map((w) => [w.platform, w.verified]), [["linkedin", true], ["x", true]]);
  assert.equal(ok.relations?.[0].objectName, "Silverline SICAV");
  assert.equal(ok.confidence, 0.75);
  assert.deepEqual(ok.pages?.map((p) => p.kind), ["home", "team"]);

  const other = parseWebsite(rawOf("website", "acme.lu", bundle("B 999 999")));
  assert.equal(other.facts.websiteVerifiedAt, null);
  assert.deepEqual(other.identifiers, [], "an unverified site never carries identifiers");
  assert.equal(statesRcs([{ url: "", title: "", text: "RCS B123456" }], "B123456"), true);
  assert.equal(statesRcs([{ url: "", title: "", text: "RCS B1234567" }], "B123456"), false);
  assert.equal(roleOf("Head of Compliance"), "manager");
  assert.equal(platformOf("https://www.instagram.com/acme"), "instagram");
});

test("website crawl: footer and social links are captured before the footer is dropped", () => {
  const p = pageText(`<html><title>T</title><body><main>Hello</main><footer>RCS B123456 <a href="https://www.linkedin.com/company/x">in</a><a href="/privacy">p</a></footer></body></html>`);
  assert.equal(p.text, "Hello");
  assert.match(p.footer, /RCS B123456/);
  assert.deepEqual(p.social, ["https://www.linkedin.com/company/x"]);
});

test("website extraction: fake client, strict normalization (unknown enum values, bad years, empty people dropped)", async () => {
  const output = {
    services: { value: ["Fund Accounting & NAV Calculation", "Teleportation"], confidence: 0.9, source_url: "https://www.acme.lu" },
    foundedYear: { value: 1600, confidence: 0.9, source_url: null },
    email: { value: "info@acme.lu", confidence: 0.8, source_url: "https://evil.example" },
    people: { value: [{ name: " ", title: "x" }, { name: "Jane Roe", title: "CEO" }], confidence: 0.7, source_url: null },
  };
  const n = normalizeExtraction(output, new Set(["https://www.acme.lu"]));
  assert.ok(!((n.services?.value as string[] | undefined) ?? []).includes("Teleportation"), "only canonical service names survive");
  assert.equal(n.foundedYear, undefined);
  assert.equal(n.email.sourceUrl, null, "source URLs must be one of the crawled pages");
  assert.deepEqual(n.people.value, [{ name: "Jane Roe", title: "CEO" }]);

  const fake = { beta: { messages: { create: async () => ({ model: "m", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(output) }] }) } } } as unknown as MessagesClient;
  const r = await extractFacts(fake, { model: "m", effort: "low" }, { name: "Acme", website: "https://www.acme.lu" }, [{ url: "https://www.acme.lu", title: "A", text: "t" }]);
  assert.equal(r.model, "m");
  assert.ok(r.fields.email);
});

test("news: RSS and Atom feeds, article record", () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title>Arendt &amp; Medernach advises</title><link>https://news.example/a</link><pubDate>Thu, 19 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;A deal in &lt;b&gt;Luxembourg&lt;/b&gt;&lt;/p&gt;</description><source url="https://paperjam.lu">Paperjam</source></item></channel></rss>`;
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>CSSF warning</title><link rel="alternate" href="https://cssf.example/w"/><updated>2026-11-18T08:00:00Z</updated><summary>Text</summary></entry></feed>`;
  const [a] = parseFeed(rss);
  assert.deepEqual([a.title, a.link, a.publishedAt, a.summary, a.publisher], ["Arendt & Medernach advises", "https://news.example/a", "2026-11-19T10:00:00.000Z", "A deal in Luxembourg", "Paperjam"]);
  const [b] = parseFeed(atom);
  assert.equal(b.link, "https://cssf.example/w");
  const rec = parseArticle(rawOf("news", a.link, { item: a, feed: { id: null, name: "search", language: "en" }, targetCompanyId: "c9" }));
  assert.equal(rec.scope, "search");
  assert.equal(rec.targetCompanyId, "c9");
  assert.match(rec.article!.matchText, /Arendt & Medernach advises/);
});

test("fundhub: listing → self-declared facts + provider and RCS identifiers; unpublished → not_found", () => {
  const p: ProviderRow = {
    id: 7, slug: "acme", name: "Acme Fund Services", category: "fund-administration", provider_type: null, headcount: 120, services: ["Fund Accounting & NAV Calculation"], licences: [], asset_classes: [], certifications: [], regulatory_scope: [], tech_stack: ["eFront"], footprint: ["Luxembourg"], top_clients: ["Silverline SICAV"], rcs_number: "b 123456", founded_year: 2001, headquarters: "1 rue X, L-1111 Luxembourg", website: "https://acme.lu", description: "Acme provides fund administration.", verified: true, status: "published", claimed: true, last_self_edit_at: null, updated_at: null,
  };
  const rec = parseFundhub(rawOf("fundhub", "provider:7", { kind: "provider", provider: p }));
  assert.deepEqual(rec.identifiers, [{ scheme: "fundhub_provider", value: "7" }, { scheme: "rcs", value: "B123456" }]);
  assert.equal(rec.facts.address?.postcode, "1111");
  assert.equal(rec.facts.accountClaimed, true);
  assert.equal(parseFundhub(rawOf("fundhub", "provider:7", { kind: "provider", provider: { ...p, status: "hidden" } })).state, "not_found");
  const claim = parseFundhub(rawOf("fundhub", "claim:3", { kind: "claim", claim: { id: 3, proposed_name: "Newco SARL", proposed_category: null, proposed_website: "newco.lu", reviewed_at: null } }));
  assert.equal(claim.facts.name, "Newco SARL");
});
