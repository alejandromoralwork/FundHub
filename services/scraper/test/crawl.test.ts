import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crawl, pageText, rankLinks } from "../src/crawl";

const home = readFileSync(new URL("./fixtures/home.html", import.meta.url), "utf8");

describe("pageText", () => {
  it("keeps visible content and drops scripts, nav and footer", () => {
    const { title, text } = pageText(home);
    assert.equal(title, "Acme Fund Services");
    assert.match(text, /Independent central administrator/);
    assert.doesNotMatch(text, /var x/);
    assert.doesNotMatch(text, /Login/);
    assert.doesNotMatch(text, /\(c\) Acme/);
  });
});

describe("rankLinks", () => {
  it("returns informative same-site pages, best first, skipping files and other hosts", () => {
    const links = rankLinks("https://www.acme.lu/", home, 10);
    assert.deepEqual(
      links.slice(0, 2).sort(),
      ["https://www.acme.lu/about-us", "https://www.acme.lu/services/fund-administration"].sort(),
    );
    assert.ok(links.includes("https://www.acme.lu/contact"));
    assert.ok(!links.some((l) => l.includes("other.example.org")));
    assert.ok(!links.some((l) => l.endsWith(".pdf")));
    assert.ok(!links.some((l) => l.includes("/news")));
  });
});

describe("crawl", () => {
  it("respects robots.txt and stays within the page budget", async () => {
    const requested: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /contact\n", { status: 200 });
      const body = url.endsWith("/") ? home : `<html><title>${url}</title><body><p>Page ${url}</p></body></html>`;
      const res = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as typeof fetch;

    const pages = await crawl("https://www.acme.lu/", { userAgent: "test", maxPages: 3, delayMs: 0, fetchImpl: fakeFetch });
    assert.equal(pages.length, 3);
    assert.ok(!requested.some((u) => u.endsWith("/contact")), "disallowed page was fetched");
    assert.equal(pages[0]!.title, "Acme Fund Services");
  });
});
