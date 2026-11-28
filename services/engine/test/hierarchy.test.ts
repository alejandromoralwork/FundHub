/**
 * FILE: services/engine/test/hierarchy.test.ts
 * PART: scraping engine (services/engine) — tests (no database)
 * WHAT IT DOES: The data-validity rules:
 *   - precedence RCS > CSSF > GLEIF on conflicting fields, GLEIF owns the LEI, non-conflicting fields of every
 *     source are kept, and disagreements are recorded as conflicts;
 *   - the existence rule (registry_status: only LBR verifies a company; sub-funds are compartments);
 *   - the PDF document scope (CSSF non-funds by default, the legacy rule on request);
 *   - the %PDF check of the capture server.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { consolidate, type Claim } from "@fundhub/engine-db/core/golden";
import { registryStatus } from "@fundhub/engine-db/core/registry";
import { documentScopeMode, documentScopeSql, filingWantsDocument, wantsDocuments } from "@fundhub/engine-db/core/document-scope";
import { isPdf } from "../src/capture-server";

const addr = (postcode: string) => ({ raw: `1 rue X, L-${postcode} Luxembourg`, postcode });

test("precedence: RCS wins conflicts, CSSF beats GLEIF, GLEIF owns the LEI, other fields are kept", () => {
  const claims: Claim[] = [
    { source: "rcs", attribute: "name", value: "Alpha Management S.A." },
    { source: "cssf", attribute: "name", value: "ALPHA MANAGEMENT" },
    { source: "gleif", attribute: "name", value: "Alpha Mgmt SA" },
    // legal form: RCS says SA, GLEIF says SARL → RCS wins, conflict recorded.
    { source: "rcs", attribute: "legalForm", value: "Société anonyme" },
    { source: "gleif", attribute: "legalForm", value: "Société à responsabilité limitée" },
    // status: RCS silent; CSSF and GLEIF disagree → CSSF wins.
    { source: "cssf", attribute: "status", value: "in_liquidation" },
    { source: "gleif", attribute: "status", value: "active" },
    // website: no RCS; CSSF and GLEIF disagree → CSSF wins.
    { source: "cssf", attribute: "website", value: "https://alpha-cssf.lu" },
    { source: "gleif", attribute: "website", value: "https://alpha-gleif.com" },
    // LEI: only GLEIF and CSSF state it; GLEIF is authoritative.
    { source: "gleif", attribute: "lei", value: "529900AAAAAAAAAAAA01" },
    { source: "cssf", attribute: "lei", value: "529900BBBBBBBBBBBB02" },
    // Non-conflicting, source-specific: only GLEIF states the registration date → kept.
    { source: "gleif", attribute: "registrationDate", value: "2015-03-02" },
    // Address: RCS wins over CSSF.
    { source: "rcs", attribute: "address", value: addr("1855") },
    { source: "cssf", attribute: "address", value: addr("2453") },
  ];
  const { golden, conflicts, lineage } = consolidate(claims);
  assert.equal(golden.canonicalName, "Alpha Management S.A.");
  assert.equal(golden.legalForm, "Société anonyme");
  assert.equal(golden.status, "in_liquidation");
  assert.equal(golden.website, "https://alpha-cssf.lu");
  assert.equal(golden.lei, "529900AAAAAAAAAAAA01");
  assert.equal(golden.registrationDate, "2015-03-02");
  assert.equal(golden.registeredAddress?.postcode, "1855");
  const winner = Object.fromEntries(conflicts.map((c) => [c.attribute, c.winner]));
  assert.deepEqual(winner, { legalForm: "rcs", status: "cssf", website: "cssf", lei: "gleif" });
  // Name / address follow precedence without opening a conflict, but the disagreement shows in the lineage.
  const nameLineage = lineage.find((l) => l.attribute === "name")!;
  assert.equal(nameLineage.source, "rcs");
  assert.equal(nameLineage.sourcesTotal, 3);
});

test("registry status: only LBR verifies; sub-funds are compartments; RCS numbers from GLEIF are pending", () => {
  const base = { lbrStates: [], hasRcsIdentifier: false, fundRole: null, legalVehicle: null };
  assert.equal(registryStatus({ ...base, lbrStates: ["found"], hasRcsIdentifier: true }), "verified");
  assert.equal(registryStatus({ ...base, lbrStates: ["not_found", "found"], hasRcsIdentifier: true }), "verified");
  assert.equal(registryStatus({ ...base, lbrStates: ["not_found"], hasRcsIdentifier: true }), "rcs_not_found");
  assert.equal(registryStatus({ ...base, hasRcsIdentifier: true }), "pending");
  assert.equal(registryStatus({ ...base, fundRole: "sub_fund", legalVehicle: "sub_fund" }), "compartment");
  assert.equal(registryStatus({ ...base, legalVehicle: "sub_fund" }), "compartment");
  assert.equal(registryStatus({ ...base, hasCompartmentIdentifier: true }), "compartment");
  assert.equal(registryStatus(base), "unregistered");
  // An RCS-registered fund (SICAV, FCP section K) is never a compartment, even with a fund role.
  assert.equal(registryStatus({ ...base, hasRcsIdentifier: true, fundRole: "umbrella_fund" }), "pending");
});

test("document scope: CSSF non-funds by default; the legacy rule on request", () => {
  const manco = { isServiceProvider: false, fundRole: null, companyKind: "asset_manager", hasCssf: true };
  const cssfFund = { isServiceProvider: false, fundRole: "umbrella_fund", companyKind: "fund", hasCssf: true };
  const selfManagedSicav = { isServiceProvider: false, fundRole: "standalone_fund", companyKind: "asset_manager", hasCssf: true };
  const cssfGp = { isServiceProvider: false, fundRole: "general_partner", companyKind: "asset_manager", hasCssf: true };
  const lawFirm = { isServiceProvider: true, fundRole: null, companyKind: "service_provider", hasCssf: false };
  const plainGp = { isServiceProvider: false, fundRole: "general_partner", companyKind: "corporate", hasCssf: false };

  assert.equal(wantsDocuments(manco, "cssf"), true);
  assert.equal(wantsDocuments(cssfGp, "cssf"), true);
  assert.equal(wantsDocuments(cssfFund, "cssf"), false);
  assert.equal(wantsDocuments(selfManagedSicav, "cssf"), false);
  assert.equal(wantsDocuments(lawFirm, "cssf"), false);
  assert.equal(wantsDocuments(plainGp, "cssf"), false);

  assert.equal(wantsDocuments(lawFirm, "legacy"), true);
  assert.equal(wantsDocuments(plainGp, "legacy"), true);
  assert.equal(wantsDocuments(manco, "legacy"), false);
});

test("document scope: DOCUMENT_SCOPE selects the rule (default cssf, unknown values fall back to cssf)", () => {
  const before = process.env.DOCUMENT_SCOPE;
  try {
    delete process.env.DOCUMENT_SCOPE;
    assert.equal(documentScopeMode(), "cssf");
    process.env.DOCUMENT_SCOPE = "LEGACY";
    assert.equal(documentScopeMode(), "legacy");
    process.env.DOCUMENT_SCOPE = "everything";
    assert.equal(documentScopeMode(), "cssf");
    // Both modes render SQL that never yields null (the extension checks `=== false`).
    assert.ok(documentScopeSql("e", "cssf"));
    assert.ok(documentScopeSql("e", "legacy"));
  } finally {
    if (before === undefined) delete process.env.DOCUMENT_SCOPE;
    else process.env.DOCUMENT_SCOPE = before;
  }
});

test("capture server: only real PDFs are accepted", () => {
  assert.equal(isPdf(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj")), true);
  assert.equal(isPdf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("%PDF-1.4")])), true);
  assert.equal(isPdf(Buffer.from("<!doctype html><html>login</html>")), false);
  assert.equal(isPdf(Buffer.alloc(0)), false);
});

test("document filings: only the useful filing types keep their PDF", () => {
  const keep = (type: string, details: string[] = []) => filingWantsDocument(type, details, "selected");
  assert.equal(keep("Annual accounts"), true);
  assert.equal(keep("Annual accounts (eCDF)"), true);
  assert.equal(keep("Annual accounts (eCDF) - Article 71 of the law of 19 December 2002"), true);
  assert.equal(keep("Coordinated articles of association"), true);
  assert.equal(keep("Registration"), true);
  assert.equal(keep("Modification", ["Registered office"]), true);
  assert.equal(keep("Modification", ["Administrator(s)/Manager(s)", "Trade name(s)"]), true);
  assert.equal(keep("Modification", ["Person(s) in charge of checking the accounts"]), true);
  assert.equal(keep("Modification", ["Administrator(s)/Manager(s)", "Daily Management delegate(s)"]), false);
  assert.equal(keep("Modification relating solely to authorized representatives", ["Administrator(s)/Manager(s)"]), false);
  assert.equal(keep("Modification - Change of legal form", ["Legal form"]), false);
  assert.equal(keep("Authorized signature list"), false);
  assert.equal(keep("Consolidated accounts"), true);
  assert.equal(keep("Resignation"), false);
  assert.equal(keep("NACE code update"), false);
  assert.equal(filingWantsDocument("Resignation", [], "all"), true);
});
