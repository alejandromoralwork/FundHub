/**
 * FILE: services/engine/src/pipeline/clean.ts
 * PART: scraping engine (services/engine) — pipeline stage "clean" (pure)
 * WHAT IT DOES: Validates and normalizes a parsed record before anything is written to clean / core:
 *   names trimmed, RCS numbers and LEIs checked, URLs canonicalized (https, lower-case host, no tracking),
 *   e-mails checked (and personal-looking ones dropped: only generic company addresses are kept), phones to
 *   E.164 (+352 by default), Luxembourg postcodes to "L-1234", dates to ISO, numbers within sane ranges,
 *   countries to ISO codes. A value that fails is REMOVED from the record and returned as a reject (written to
 *   clean.rejects), so bad data never reaches the golden record but is never silently lost either.
 * WHERE IT RUNS: anywhere — no I/O (tested in test/core.test.ts).
 */

import { normalizeCountries, normalizeLei, normalizeRcs } from "../core/normalize";
import type { Facts, ParsedRecord, PersonRow, WebPresenceRow } from "../core/types";

/** Kind: type alias. One value the clean stage refused. */
export type CleanReject = { attribute: string; value: unknown; reason: string };
/** Kind: type alias. The cleaned record and what was refused. */
export type CleanResult = { record: ParsedRecord; rejects: CleanReject[] };

const TRACKING = /^(utm_|fbclid|gclid|mc_|_hs)/i;
/** Lower-case particles allowed inside a person's name ("Jean de la Fontaine", "Ludwig van Beethoven"). */
const NAME_PARTICLES = new Set(["de", "del", "della", "der", "den", "di", "da", "du", "des", "la", "le", "van", "von", "zu", "y", "e", "bin", "al"]);
/** Words that show a heading or label, not a person ("Our team", "Contact us", "Board of Directors"). */
const NOT_A_PERSON = /\b(team|our|contact|about|services|board|directors|management|partners|news|careers|equipe|équipe|unser|notre|nos|office|group|company|luxembourg)\b/i;
/** Words that make an e-mail local part look generic (a company inbox), not a person's. */
const GENERIC_EMAIL = /^(info|contact|office|hello|mail|admin|enquiries|inquiries|sales|support|secretariat|reception|lux|luxembourg|general|team|accueil|bonjour)([._-].*)?$/i;

/**
 * Kind: function. Canonical form of a web address: https unless http is explicit, lower-case host, no
 * fragment, no tracking parameters, no trailing slash on the root. Returns null when it is not a usable URL.
 */
export function canonicalUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".") || /\s/.test(u.hostname)) return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    const out = u.toString();
    return u.pathname === "/" && !u.search ? out.replace(/\/$/, "") : out;
  } catch {
    return null;
  }
}

/** Kind: function. The registrable host of a URL without "www." (used as the "domain" identifier). */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Kind: function. A phone number in E.164 ("+352 (0) 26 12 34 56" → "+35226123456"); +352 when no country code. */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!s.startsWith("+")) s = `+352${s.replace(/^0+/, "")}`;
  const digits = s.slice(1);
  return /^\d{6,15}$/.test(digits) ? `+${digits}` : null;
}

/** Kind: function. A Luxembourg postcode as "L-1234"; other countries' postcodes are returned trimmed. */
export function normalizePostcode(v: unknown, country?: string | null): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim().toUpperCase();
  const lu = t.match(/^(?:L[-\s]?)?(\d{4})$/);
  if (lu && (!country || country === "LU")) return `L-${lu[1]}`;
  return t;
}

/** Kind: function. An ISO date (YYYY-MM-DD) or null; accepts ISO timestamps too. */
export function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Kind: function. The clean stage for one record.
 * @returns the cleaned record (a copy) and the rejected values.
 */
export function cleanRecord(input: ParsedRecord): CleanResult {
  const rejects: CleanReject[] = [];
  const rec: ParsedRecord = structuredClone(input);
  if (rec.state !== "found") return { record: rec, rejects };
  const f: Facts = rec.facts;
  const reject = (attribute: string, reason: string) => {
    rejects.push({ attribute, value: f[attribute], reason });
    delete f[attribute];
  };

  if (f.name !== undefined) {
    const n = typeof f.name === "string" ? f.name.replace(/\s+/g, " ").trim() : "";
    if (n.length < 2 || n.length > 300) reject("name", "name missing or longer than 300 characters");
    else f.name = n;
  }
  if (f.rcsNumber !== undefined && f.rcsNumber !== null) {
    const r = normalizeRcs(f.rcsNumber);
    if (!r) reject("rcsNumber", "not an RCS number (letter + up to 7 digits)");
    else f.rcsNumber = r;
  }
  if (f.lei !== undefined && f.lei !== null) {
    const l = normalizeLei(f.lei);
    if (!l) reject("lei", "not a 20-character LEI");
    else f.lei = l;
  }
  if (f.website !== undefined && f.website !== null) {
    const u = canonicalUrl(f.website);
    if (!u) reject("website", "not a usable web address");
    else f.website = u;
  }
  if (f.email !== undefined && f.email !== null) {
    const e = typeof f.email === "string" ? f.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e)) reject("email", "not an e-mail address");
    else if (!GENERIC_EMAIL.test(e.split("@")[0])) reject("email", "looks like a person's address (only generic company inboxes are kept)");
    else f.email = e;
  }
  if (f.phone !== undefined && f.phone !== null) {
    const p = normalizePhone(f.phone);
    if (!p) reject("phone", "not a phone number");
    else f.phone = p;
  }
  if (f.address) {
    const a = f.address;
    if (!a.raw || typeof a.raw !== "string") reject("address", "address without text");
    else {
      const country = a.country ? (normalizeCountries([a.country])[0] ?? a.country) : a.country;
      f.address = { ...a, country: country ?? null, postcode: normalizePostcode(a.postcode, country) };
    }
  }
  for (const key of ["registrationDate"] as const) {
    if (f[key] !== undefined && f[key] !== null) {
      const d = isoDate(f[key]);
      if (!d || d > new Date().toISOString().slice(0, 10)) reject(key, "not a past calendar date");
      else f[key] = d;
    }
  }
  if (f.headcount !== undefined && f.headcount !== null) {
    const n = Number(f.headcount);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) reject("headcount", "headcount must be a whole number between 1 and 1,000,000");
    else f.headcount = n;
  }
  if (f.foundedYear !== undefined && f.foundedYear !== null) {
    const y = Number(f.foundedYear);
    if (!Number.isInteger(y) || y < 1700 || y > new Date().getFullYear()) reject("foundedYear", "not a plausible year");
    else f.foundedYear = y;
  }
  if (f.description !== undefined && f.description !== null) {
    const d = typeof f.description === "string" ? f.description.trim() : "";
    if (d.length < 20) reject("description", "description shorter than 20 characters");
    else f.description = d.slice(0, 4000);
  }
  if (Array.isArray(f.operatingCountries)) f.operatingCountries = normalizeCountries(f.operatingCountries);
  if (Array.isArray(f.services)) f.services = [...new Set(f.services.filter((s): s is string => typeof s === "string" && s.trim().length > 1).map((s) => s.trim()))];

  // Lists: drop invalid rows with a reject each.
  if (rec.webPresence) {
    rec.webPresence = rec.webPresence.flatMap((w): WebPresenceRow[] => {
      const url = canonicalUrl(w.url);
      if (!url) {
        rejects.push({ attribute: `webPresence.${w.platform}`, value: w.url, reason: "not a usable web address" });
        return [];
      }
      return [{ ...w, url }];
    });
  }
  if (rec.people) {
    rec.people = rec.people.flatMap((p): PersonRow[] => {
      const fullName = p.fullName?.replace(/\s+/g, " ").trim() ?? "";
      // A person: at least two capitalized words of letters (first + last name), no digits / e-mail, no label words.
      const words = fullName.split(" ");
      const named = words.filter((w) => /^\p{Lu}[\p{L}'’.-]+$/u.test(w));
      const ok = named.length >= 2 && words.every((w) => named.includes(w) || NAME_PARTICLES.has(w.toLowerCase())) && !NOT_A_PERSON.test(fullName) && !/[@\d]/.test(fullName) && fullName.length <= 120;
      if (!ok) {
        rejects.push({ attribute: "people", value: p.fullName, reason: "not a person's full name" });
        return [];
      }
      return [{ ...p, fullName, title: (p.title ?? "").trim().slice(0, 200), profileUrl: canonicalUrl(p.profileUrl), evidenceUrl: canonicalUrl(p.evidenceUrl) }];
    });
  }
  return { record: rec, rejects };
}
