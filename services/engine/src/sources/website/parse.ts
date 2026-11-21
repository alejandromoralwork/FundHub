/**
 * FILE: services/engine/src/sources/website/parse.ts
 * PART: scraping engine (services/engine) — source "website": bundle → ParsedRecord (pure)
 * WHAT IT DOES: The raw content of a website capture is a JSON BUNDLE: the company it was crawled for, the
 *   pages (text, footer, social links) and the validated AI extraction. This parser turns it into the record
 *   the pipeline understands:
 *   - facts: description, services, headcount, founded year, office countries, generic e-mail, phone,
 *     address, and website + websiteVerifiedAt when a page states the company's own RCS number;
 *   - people (leadership with a role guessed from the title), clients (relations), social profiles;
 *   - identifiers: the website domain and RCS number, only when the site is VERIFIED (so an unverified site
 *     can never merge two companies);
 *   - confidence: the mean confidence of the extracted fields (the approval gate holds low ones).
 * WHERE IT RUNS: anywhere — no I/O (re-runnable on old bundles after a parser fix).
 */

import type { Platform, PositionRole } from "@fundhub/engine-db/schema";
import { normalizeRcs, parseLuAddress } from "../../core/normalize";
import type { ParsedRecord, PersonRow, RawCapture, WebPresenceRow } from "../../core/types";
import type { Page } from "./crawl";
import type { ExtractedField } from "./extract";

export const WEBSITE_PARSER_VERSION = 1;

/** Kind: type alias. What the adapter stores in raw for one crawl. */
export type WebsiteBundle = {
  company: { id: string; name: string; rcsNumber: string | null; website: string };
  fetchedAt: string;
  pages: Page[];
  fields: Record<string, ExtractedField>;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
};

/** Kind: function. The host of a URL without "www." (the record's external id). */
export const siteKey = (url: string) => new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();

/** Kind: function. Does any page (text or footer) state this RCS number? Accepts "B 123 456", "B-123456". */
export function statesRcs(pages: Page[], rcs: string | null): boolean {
  if (!rcs) return false;
  const [letter, digits] = [rcs[0], rcs.slice(1)];
  const re = new RegExp(`\\b${letter}[\\s.-]?${digits.split("").join("[\\s.]?")}\\b`, "i");
  return pages.some((p) => re.test(p.text) || re.test(p.footer ?? ""));
}

/** Kind: function. A position role from a job title (EN / FR / DE). */
export function roleOf(title: string): PositionRole {
  const t = title.toLowerCase();
  if (/\b(board|chair|chairman|chairwoman|président du conseil|non-executive|administrateur|verwaltungsrat)\b/.test(t)) return "board";
  if (/\b(ceo|cfo|coo|cto|cio|chief|managing director|managing partner|general manager|directeur général|geschäftsführer|conducting officer|dirigeant)\b/.test(t)) return "executive";
  if (/\b(partner|director|head|manager|directeur|responsable|leiter)\b/.test(t)) return "manager";
  return "employee";
}

/** Kind: function. Platform of a social link (null when not one we track). */
export function platformOf(url: string): Platform | null {
  const h = url.toLowerCase();
  if (h.includes("linkedin.com/company")) return "linkedin";
  if (h.includes("instagram.com")) return "instagram";
  if (h.includes("facebook.com")) return "facebook";
  if (h.includes("x.com/") || h.includes("twitter.com/")) return "x";
  if (h.includes("youtube.com")) return "youtube";
  if (h.includes("glassdoor.")) return "glassdoor";
  return null;
}

const v = <T>(fields: Record<string, ExtractedField>, key: string) => fields[key]?.value as T | undefined;

/** Kind: function. Bundle → ParsedRecord. */
export function parseWebsite(raw: RawCapture): ParsedRecord {
  const b = JSON.parse(raw.body.toString("utf8")) as WebsiteBundle;
  const f = b.fields;
  const home = b.pages[0]?.url ?? b.company.website;
  const stated = normalizeRcs(v<string>(f, "rcsNumber") ?? null);
  // Verified = the site states OUR RCS number (in the AI output or anywhere in the text / footers).
  const verified = !!b.company.rcsNumber && (stated === b.company.rcsNumber || statesRcs(b.pages, b.company.rcsNumber));
  const address = v<string>(f, "headquarters");

  const social = new Map<string, WebPresenceRow>();
  for (const p of b.pages) {
    for (const url of p.social ?? []) {
      const platform = platformOf(url);
      if (platform && !social.has(url)) social.set(url, { platform, url, verified });
    }
  }
  const people: PersonRow[] = (v<{ name: string; title: string }[]>(f, "people") ?? []).map((p) => ({ fullName: p.name, title: p.title, role: roleOf(p.title), evidenceUrl: f.people?.sourceUrl ?? home }));
  const confidences = Object.values(f).map((x) => x.confidence);
  const domain = siteKey(home);

  return {
    source: "website",
    externalId: domain,
    state: "found",
    scope: null,
    targetCompanyId: b.company.id,
    confidence: confidences.length ? Math.round((confidences.reduce((a, c) => a + c, 0) / confidences.length) * 100) / 100 : 0,
    facts: {
      website: home,
      websiteVerifiedAt: verified ? b.fetchedAt : null,
      description: v<string>(f, "description") ?? null,
      services: v<string[]>(f, "services") ?? [],
      headcount: v<number>(f, "headcount") ?? null,
      foundedYear: v<number>(f, "foundedYear") ?? null,
      operatingCountries: v<string[]>(f, "footprint") ?? [],
      email: v<string>(f, "email") ?? null,
      phone: v<string>(f, "phone") ?? null,
      address: address ? parseLuAddress(address) : null,
      // Source-specific claims (kept with provenance; not golden fields).
      statedRcsNumber: stated,
      claimedLicences: v<string[]>(f, "licences") ?? [],
      assetClasses: v<string[]>(f, "assetClasses") ?? [],
      certifications: v<string[]>(f, "certifications") ?? [],
      regulatoryScope: v<string[]>(f, "regulatoryScope") ?? [],
      techStack: v<string[]>(f, "techStack") ?? [],
    },
    identifiers: verified ? [{ scheme: "domain", value: domain }, ...(b.company.rcsNumber ? [{ scheme: "rcs" as const, value: b.company.rcsNumber }] : [])] : [],
    names: [],
    relations: (v<string[]>(f, "clients") ?? []).map((name) => ({ kind: "client" as const, objectName: name, evidenceUrl: f.clients?.sourceUrl ?? home, confidence: f.clients?.confidence ?? 0.5 })),
    people,
    webPresence: [...social.values()],
    pages: b.pages.map((p) => ({ url: p.url, kind: pageKind(p), title: p.title || null, textBlobKey: null })),
  };
}

/** Kind: function. What a crawled page is, from its URL and title. */
export function pageKind(p: Page) {
  if (/^https?:\/\/[^/]+\/?(index\.\w+)?$/i.test(p.url)) return "home" as const;
  const s = `${p.url} ${p.title}`.toLowerCase();
  if (/legal|mentions|imprint|impressum|disclaimer/.test(s)) return "legal" as const;
  if (/team|people|leadership|management|board/.test(s)) return "team" as const;
  if (/about|who-we-are|company|history/.test(s)) return "about" as const;
  if (/contact|locations|offices/.test(s)) return "contact" as const;
  if (/services|solutions|expertise/.test(s)) return "services" as const;
  if (/clients|case-stud/.test(s)) return "clients" as const;
  return "other" as const;
}
