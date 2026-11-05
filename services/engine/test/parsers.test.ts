/**
 * FILE: services/engine/test/parsers.test.ts
 * PART: scraping engine (services/engine) — tests
 * WHAT IT DOES: Checks the three parsers against real saved responses (test/fixtures):
 *   CSSF ARENDT INVESTOR SERVICES S.A. (entity 7013419) and a UCI with compartments, the GLEIF record of the
 *   same company, and its RCS page B145917. Run: `npm test -w @fundhub/engine`.
 * TYPESCRIPT YOU WILL SEE HERE: node:test (`test`, `assert`), `readFileSync`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCssf } from "../src/sources/cssf/parse";
import { parseGleif } from "../src/sources/gleif/parse";
import { parseRcsSearchList, parseRcsText, rcsFromUrl } from "../src/sources/rcs/parse";
import { parseCsv, parseLbrRow, resolveColumns } from "../src/sources/lbr-bulk/parse";
import type { RawCapture } from "../src/core/types";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const raw = (source: RawCapture["source"], externalId: string, file: string): RawCapture => ({
  source,
  externalId,
  url: file,
  httpStatus: 200,
  contentType: "application/json",
  body: fixture(file),
  ext: "json",
});

test("CSSF: Arendt Investor Services — identity, statuses, name history", () => {
  const r = parseCssf(raw("cssf", "7013419", "cssf-7013419.json"));
  assert.equal(r.state, "found");
  assert.equal(r.scope, "SPP");
  assert.equal(r.facts.name, "ARENDT INVESTOR SERVICES S.A.");
  assert.equal(r.facts.cssfTypeLabel, "Specialised PFS");
  assert.equal(r.facts.cssfCode, "P00000348");
  assert.equal(r.facts.lei, "222100IVSOG87C1WWJ84");
  assert.equal(r.facts.cssfValidFrom, "2009-04-30");
  assert.equal(r.facts.status, "active");
  assert.deepEqual(r.facts.address, { street: "9, rue de Bitbourg", postcode: "1273", city: "Luxembourg", country: "LU", raw: "9, rue de Bitbourg L-1273 Luxembourg" });

  assert.deepEqual(
    r.identifiers.map((i) => `${i.scheme}:${i.value}`),
    ["cssf_id:7013419", "cssf_code:P00000348", "lei:222100IVSOG87C1WWJ84"],
  );

  // The page shows 4 authorised statuses and 2 other statuses.
  const authorised = r.cssfDetails!.filter((d) => d.kind === "authorised");
  const other = r.cssfDetails!.filter((d) => d.kind === "other");
  assert.deepEqual(authorised.map((d) => d.code).sort(), ["ACT_SPP_ATR", "ACT_SPP_DEPAAIF", "ACT_SPP_DOM", "ACT_SPP_PCG"]);
  assert.deepEqual(other.map((d) => d.code).sort(), ["OST_SPP_AA", "OST_SPP_ACC"]);
  const dom = authorised.find((d) => d.code === "ACT_SPP_DOM")!;
  assert.equal(dom.label, "Corporate domiciliation agents");
  assert.equal(dom.startDate, "2011-07-18");
  assert.equal(dom.endDate, null);

  // Name history: current legal name since 2024-01-02, former name since 2009-04-01.
  assert.deepEqual(r.names, [
    { name: "ARENDT INVESTOR SERVICES S.A.", kind: "legal", validFrom: "2024-01-02" },
    { name: "ARENDT SERVICES S.A.", kind: "former", validFrom: "2009-04-01" },
  ]);
});

test("CSSF: UCI compartments keep their own LEI", () => {
  const r = parseCssf(raw("cssf", "6940004", "cssf-opc-6940004.json"));
  assert.equal(r.scope, "OPC");
  const comps = r.cssfDetails!.filter((d) => d.kind === "compartment");
  assert.equal(comps.length, 3);
  assert.ok(comps.every((c) => c.label && !c.label.includes("_")));
  assert.ok(comps.some((c) => c.lei === "5493007NCPZXUXEPET36"));
});

test("CSSF: 404 is a not-found record", () => {
  const r = parseCssf({ ...raw("cssf", "1", "cssf-7013419.json"), httpStatus: 404, body: Buffer.alloc(0) });
  assert.equal(r.state, "not_found");
});

test("GLEIF: LEI record bridges to the RCS number", () => {
  const r = parseGleif(raw("gleif", "222100IVSOG87C1WWJ84", "gleif-222100IVSOG87C1WWJ84.json"));
  assert.equal(r.facts.rcsNumber, "B145917");
  // GLEIF says 2009-05-03T21:00Z (still 3 May in Luxembourg); the RCS says 04/05/2009 and wins in the golden record.
  assert.equal(r.facts.registrationDate, "2009-05-03");
  assert.equal(r.facts.status, "active");
  assert.equal((r.facts.address as { postcode: string }).postcode, "1273");
  assert.deepEqual(r.identifiers, [
    { scheme: "lei", value: "222100IVSOG87C1WWJ84" },
    { scheme: "rcs", value: "B145917" },
  ]);
  assert.ok(r.names.some((n) => n.kind === "former" && n.name === "ARENDT SERVICES S.A."));
});

test("RCS: company page text — profile and filings", () => {
  const text = fixture("rcs-B145917.txt").toString("utf8");
  const r = parseRcsText(text, "B145917");
  assert.equal(r.state, "found");
  assert.equal(r.facts.name, "Arendt Investor Services SA");
  assert.equal(r.facts.rcsNumber, "B145917");
  assert.equal(r.facts.registrationDate, "2009-05-04");
  assert.equal(r.facts.legalForm, "Public limited company");
  assert.equal(r.facts.status, "active");
  assert.equal(r.facts.rcsLastFilingDate, "2026-09-21");
  assert.deepEqual(r.facts.address, { street: "9, Rue de Bitbourg", postcode: "1273", city: "Luxembourg", country: "LU", raw: "9, Rue de Bitbourg, 1273 Luxembourg" });

  // Every complete block is a filing; the truncated last one (L210013018, no date) is skipped.
  const blocks = text.split(/\r?\n/).filter((l) => /^L\d{9}$/.test(l.trim())).length;
  assert.equal(r.rcsFilings!.length, blocks - 1);
  assert.ok(!r.rcsFilings!.some((f) => f.filingNumber === "L210013018"));

  const first = r.rcsFilings![0];
  assert.deepEqual(first, { filingNumber: "L260377560", filingDate: "2026-09-21", type: "Authorized signature list", details: [], corrects: null, correctedBy: null, hasDocuments: true });

  const correction = r.rcsFilings!.find((f) => f.filingNumber === "L260045422")!;
  assert.equal(correction.corrects, "L250446350");
  assert.equal(r.rcsFilings!.find((f) => f.filingNumber === "L250446350")!.correctedBy, "L260045422");

  const mixed = r.rcsFilings!.find((f) => f.filingNumber === "L230229129")!;
  assert.equal(mixed.corrects, "L230198597");
  assert.deepEqual(mixed.details, ["Administrator(s)/Manager(s)"]);

  const noDocs = r.rcsFilings!.find((f) => f.filingNumber === "L240267217")!;
  assert.equal(noDocs.hasDocuments, false);
  assert.equal(noDocs.details.length, 3);

  const accounts = r.rcsFilings!.find((f) => f.filingNumber === "L260093654")!;
  assert.equal(accounts.type, "Annual accounts (eCDF)");
  assert.deepEqual(accounts.details, ["Financial year from 01/01/2025 to 12/31/2025"]);
});

test("LBR bulk extract: CSV with quotes and French headers → RCS-keyed records", () => {
  const csv = '﻿Numéro RCS;Dénomination;Forme juridique;Siège social;Date d\'immatriculation;Statut\r\n' +
    'B145917;"Arendt Investor Services SA";Société anonyme;"9, Rue de Bitbourg, L-1273 Luxembourg";04/05/2009;Inscrite\r\n' +
    'B 1234;"Old ""Quoted"" Co; Sàrl";Société à responsabilité limitée;;01/01/1990;Radiée\r\n' +
    'not-a-number;Bad row;;;;\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 4);
  const cols = resolveColumns(rows[0]);
  const a = parseLbrRow(rows[1], cols)!;
  assert.equal(a.externalId, "B145917");
  assert.equal(a.facts.name, "Arendt Investor Services SA");
  assert.equal(a.facts.registrationDate, "2009-05-04");
  assert.equal((a.facts.address as { postcode: string }).postcode, "1273");
  assert.equal(a.facts.status, "active"); // "Inscrite" = registered
  const b = parseLbrRow(rows[2], cols)!;
  assert.equal(b.externalId, "B1234");
  assert.equal(b.facts.name, 'Old "Quoted" Co; Sàrl');
  assert.equal(b.facts.status, "struck_off");
  assert.equal(parseLbrRow(rows[3], cols), null);
  assert.throws(() => resolveColumns(["Name", "City"]));
  assert.equal(resolveColumns(["Company", "RCS-Nr"], { rcs: "RCS-Nr" }).rcs, 1);
});

test("RCS live page (LBR 2026): company header, address, filings — not fooled by 'Registered office' in a filing", () => {
  const text = fixture("lbr-company-B100554.txt").toString("utf8");
  const r = parseRcsText(text, rcsFromUrl("https://www.lbr.lu/mjrcs-web-front/consult-company/B100554?tab=deposit")!);
  assert.equal(r.state, "found");
  assert.equal(r.externalId, "B100554");
  assert.equal(r.facts.name, "SOPRA STERIA PSF LUXEMBOURG S.A.");
  assert.equal(r.facts.legalForm, "Société anonyme");
  assert.equal(r.facts.registrationDate, "2004-05-07");
  assert.equal(r.facts.rcsLastFilingDate, "2026-10-16");
  assert.equal(r.facts.status, "active");
  assert.equal((r.facts.address as { postcode: string; city: string }).postcode, "3364");
  assert.equal((r.facts.address as { postcode: string; city: string }).city, "Leudelange");
  assert.ok(r.rcsFilings!.length >= 60);
  assert.deepEqual(r.rcsFilings![0], { filingNumber: "L260403335", filingDate: "2026-10-16", type: "Annual accounts (eCDF)", details: ["Financial year from 01/01/2025 to 31/12/2025"], corrects: null, correctedBy: null, hasDocuments: true });
  assert.equal(r.rcsFilings!.find((f) => f.filingNumber === "L210139264")!.corrects, "L210116926");
  assert.equal(r.rcsFilings!.at(-1)!.type, "Registration");
});

test("RCS search-results page: companies with struck-off flag, sole traders (A…) dropped", () => {
  const list = parseRcsSearchList(fixture("lbr-search-arendt.txt").toString("utf8"))!;
  assert.equal(list.total, 199);
  assert.ok(list.items.length > 10);
  assert.ok(list.items.every((i) => !i.rcs.startsWith("A")));
  assert.deepEqual(list.items[0], { rcs: "B145917", name: "Arendt Investor Services SA", struckOff: false });
  assert.deepEqual(list.items.find((i) => i.rcs === "B171349"), { rcs: "B171349", name: "RBC Investor Services Limited", struckOff: true });
  assert.ok(list.items.some((i) => i.rcs === "E7998"));
  assert.equal(parseRcsSearchList(fixture("lbr-company-B100554.txt").toString("utf8")), null);
});

test("RCS: unknown page shapes fail loudly, 'no result' pages are not_found", () => {
  assert.equal(parseRcsText("Search\nNo result found for B999999", "B999999").state, "not_found");
  assert.throws(() => parseRcsText("Please log in with LuxTrust", "B1"));
});
