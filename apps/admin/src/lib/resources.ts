/**
 * FILE: apps/admin/src/lib/resources.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The configuration behind the Console's generic "Database" module, which lets staff browse
 *   (and for some tables edit) raw database tables. It lists which tables appear, how they are grouped, which
 *   columns are searchable, hidden or read-only, and who may edit them. It also describes each column for the
 *   UI and converts typed-in values into the right type before saving.
 * WHERE IT RUNS: only on the server (Node.js). The UI only receives the safe description from `columnsOf`.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file, so the
 *   table definitions (and the guarantee that hidden columns stay hidden) remain on the server.
 *   Drizzle ORM describes every table in TypeScript (`pgTable` in packages/db); here we read those
 *   descriptions at run time with `getTableColumns` and `getTableName`.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type { … }`: imports only a type (used for checking, removed from the running code).
 *   - `import * as s from "…"`: imports everything from a module as one object `s`.
 *   - type aliases with optional properties `?`, string-literal unions `"Catalogue" | "Accounts" | …`.
 *   - indexed access types `ColumnMeta["type"]` (the type of one property of another type).
 *   - `switch` statements, `throw new Error(…)`, `Set`, `Object.entries`, `!!x` (turn into true/false).
 */

// Side-effect import: the server-only guard (exports nothing).
import "server-only";
// From Drizzle ORM: read a table's columns and its SQL name; `type Column` is the type of one column object.
import { getTableColumns, getTableName, type Column } from "drizzle-orm";
// The type of any Postgres table defined with Drizzle (type-only import).
import type { PgTable } from "drizzle-orm/pg-core";
// All table definitions from our database package, reachable as `s.providers`, `s.users`, etc.
import * as s from "@fundhub/db/schema";
// The union of staff role names, e.g. "owner" | "operations" | … (type-only import).
import type { StaffRole } from "@fundhub/core/enums";
// The role table: which roles may perform which kind of action.
import { CAN } from "./auth";

/**
 * Kind: type alias.
 * Tables exposed in the Database module. Every table is browsable; only those with
 * `write` roles are editable here (others are managed by their own module or by Stripe).
 * `hidden` columns never leave the server.
 * Fields:
 *  - `table`: the Drizzle table object; `label`: its display name; `group`: the menu section (one of six exact texts).
 *  - `search?`: columns the search box looks in; `hidden?`: secret columns (e.g. password hashes) never sent out;
 *  - `readOnly?`: columns shown but not editable; `write?`: roles allowed to edit (no `write` = read-only table);
 *  - `canCreate?` / `canDelete?`: whether new rows may be added or rows removed; `defaultSort?`: initial sort column.
 */
type ResourceDef = {
  table: PgTable;
  label: string;
  group: "Catalogue" | "Accounts" | "Requests & reviews" | "Platform" | "Billing" | "Data pipeline";
  search?: string[];
  hidden?: string[];
  readOnly?: string[];
  write?: readonly StaffRole[];
  canCreate?: boolean;
  canDelete?: boolean;
  defaultSort?: string;
};

/** Kind: constant. Shorthand for the roles allowed to edit data (owner, operations). */
const EDIT = CAN.editData;
/** Kind: constant. Columns the database manages itself (id and timestamps), so nobody edits them by hand. */
const READ_ONLY_TS = ["id", "createdAt", "updatedAt"];

/**
 * Kind: constant (exported), `Record<string, ResourceDef>` = an object whose keys are URL names and whose values
 * follow `ResourceDef`. One entry per table. Security notes on the entries:
 *  - `hidden: ["passwordHash"]` / `["passwordHash", "totpSecret"]`: login secrets are never shown, even to staff.
 *  - `hidden: ["pdf"]`: the PDF bytes are large, so they are not loaded into the table view.
 *  - billing tables have no `write`: they mirror Stripe, which is the source of truth.
 *  - audit_log has no `write`: the audit trail must not be editable.
 *  - staff_users can only be edited by the owner (`CAN.staff`).
 * `[...READ_ONLY_TS, "fileSize"]` (spread) makes a new array with the shared items plus extra ones.
 */
export const RESOURCES: Record<string, ResourceDef> = {
  providers: { table: s.providers, label: "Providers", group: "Catalogue", search: ["name", "slug", "rcsNumber"], readOnly: READ_ONLY_TS, write: EDIT, canCreate: true, canDelete: true, defaultSort: "name" },
  reports: { table: s.reports, label: "Uploaded reports", group: "Catalogue", search: ["title", "period"], hidden: ["pdf"], readOnly: [...READ_ONLY_TS, "fileSize", "slug"], write: EDIT, canDelete: true },
  report_downloads: { table: s.reportDownloads, label: "Report downloads", group: "Catalogue", search: ["reportSlug"] },
  users: { table: s.users, label: "Website accounts", group: "Accounts", search: ["email", "name", "company"], hidden: ["passwordHash"], readOnly: READ_ONLY_TS, write: EDIT, canDelete: true },
  saved_providers: { table: s.savedProviders, label: "Saved providers", group: "Accounts" },
  provider_claims: { table: s.providerClaims, label: "Company claims", group: "Accounts", search: ["proposedName", "jobTitle"], readOnly: READ_ONLY_TS, write: EDIT },
  profile_edits: { table: s.profileEdits, label: "Provider self-edits", group: "Accounts" },
  rfi_requests: { table: s.rfiRequests, label: "Form submissions", group: "Requests & reviews", search: ["contactName", "email", "company"], readOnly: READ_ONLY_TS, write: EDIT, canDelete: true },
  reviews: { table: s.reviews, label: "Client reviews", group: "Requests & reviews", search: ["reviewerName", "reviewerEmail", "title"], readOnly: READ_ONLY_TS, write: EDIT, canDelete: true },
  email_messages: { table: s.emailMessages, label: "Emails sent", group: "Platform", search: ["toEmail", "subject"] },
  staff_users: { table: s.staffUsers, label: "Staff", group: "Platform", search: ["email", "name"], hidden: ["passwordHash", "totpSecret"], readOnly: [...READ_ONLY_TS, "totpEnabled", "lastLoginAt"], write: CAN.staff },
  audit_log: { table: s.auditLog, label: "Audit log", group: "Platform", search: ["action", "entity", "entityId"] },
  billing_customers: { table: s.billingCustomers, label: "Billing customers", group: "Billing", search: ["name", "email", "stripeCustomerId"] },
  subscriptions: { table: s.subscriptions, label: "Subscriptions", group: "Billing", search: ["stripeSubscriptionId", "status"] },
  invoices: { table: s.invoices, label: "Invoices", group: "Billing", search: ["number", "description", "status"] },
  ingest_runs: { table: s.ingestRuns, label: "Ingest runs", group: "Data pipeline" },
  ingest_jobs: { table: s.ingestJobs, label: "Ingest jobs", group: "Data pipeline" },
  ingest_records: { table: s.ingestRecords, label: "Ingest records", group: "Data pipeline", search: ["sourceUrl"] },
};

/**
 * Kind: type alias (exported).
 * What the UI is told about one column: its code name and database name, a simple type (one of six), the allowed
 * values for an enum (a fixed list column), and whether it may be empty, may be edited, or is the primary key.
 */
export type ColumnMeta = {
  name: string;
  dbName: string;
  type: "number" | "text" | "boolean" | "json" | "date" | "enum";
  enumValues?: string[];
  nullable: boolean;
  editable: boolean;
  primary: boolean;
};

/**
 * Kind: function.
 * Looks up a table configuration by its name from the URL.
 * @param name  `string` — e.g. "providers".
 * @returns     `ResourceDef | undefined` — the configuration, or `undefined` if there is no such table.
 * Security: `hasOwnProperty.call(RESOURCES, name)` checks the name is one of OUR keys. A plain `RESOURCES[name]`
 * would also find built-in object properties such as "constructor" or "toString", which a crafted URL could use.
 */
export function getResource(name: string): ResourceDef | undefined {
  return Object.prototype.hasOwnProperty.call(RESOURCES, name) ? RESOURCES[name] : undefined;
}

/**
 * Kind: function (private).
 * Maps Drizzle's description of a column to one of our six simple types.
 * @param col  `Column` — a Drizzle column object.
 * @returns    `ColumnMeta["type"]` — i.e. "number" | "text" | "boolean" | "json" | "date" | "enum".
 */
function kind(col: Column): ColumnMeta["type"] {
  // A column with a fixed list of allowed values is an enum. `?.length` is undefined if there is no list.
  if (col.enumValues?.length) return "enum";
  // `switch` compares one value against several `case`s; `return` leaves the function immediately.
  switch (col.dataType) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "json";
    case "date":
      return "date";
    // Anything else (text, ids stored as text, …) is treated as text.
    default:
      return "text";
  }
}

/**
 * Kind: function (exported).
 * Describes a table's visible columns for the UI.
 * @param def  `ResourceDef` — the table configuration.
 * @returns    `ColumnMeta[]` — one description per column, with hidden columns left out entirely.
 */
export function columnsOf(def: ResourceDef): ColumnMeta[] {
  // Sets for quick "is this column in the list?" checks; `?? []` uses an empty list when none is configured.
  const hidden = new Set(def.hidden ?? []);
  const readOnly = new Set(def.readOnly ?? []);
  // `getTableColumns` gives an object { columnName: Column, … }; `Object.entries` turns it into [name, col] pairs.
  return Object.entries(getTableColumns(def.table))
    // `([name]) =>` destructures the pair and keeps only its first item. Drop hidden columns.
    .filter(([name]) => !hidden.has(name))
    // Turn each remaining pair into a `ColumnMeta` object (the `({ … })` brackets return an object literal).
    .map(([name, col]) => ({
      name,
      dbName: col.name,
      type: kind(col),
      // Copy the allowed values into a new array (spread `[...list]`), or leave undefined.
      enumValues: col.enumValues?.length ? [...col.enumValues] : undefined,
      nullable: !col.notNull,
      primary: col.primary,
      // Editable only if the table has editors (`!!` turns the roles list into true/false), the column is not the
      // primary key, and it is not marked read-only.
      editable: !!def.write && !col.primary && !readOnly.has(name),
    }));
}

/**
 * Kind: function (exported).
 * @param def  `ResourceDef`.
 * @returns    `string` — the table's real name in Postgres, e.g. "rfi_requests" (return type inferred).
 */
export function tableName(def: ResourceDef) {
  return getTableName(def.table);
}

/**
 * Kind: function (exported).
 * Converts form/JSON input into the column's runtime type; throws on invalid values.
 * Form fields always arrive as text, so e.g. "42" must become the number 42 before the database accepts it.
 * @param meta   `ColumnMeta` — the column being written.
 * @param value  `unknown` — the raw value; `unknown` forces us to check it before using it.
 * @returns      `unknown` — the converted value (number, boolean, Date, object, text or null).
 */
export function coerce(meta: ColumnMeta, value: unknown): unknown {
  // Empty field: store `null` (no value) if the column allows it; otherwise pass it on unchanged.
  if (value === "" || value === undefined) return meta.nullable ? null : value;
  if (value === null) {
    // `throw new Error(...)` stops the function and reports a problem to whoever called it.
    if (!meta.nullable) throw new Error(`${meta.name} is required`);
    return null;
  }
  switch (meta.type) {
    // The `{ … }` after a case gives it its own block, so `n` exists only inside it.
    case "number": {
      const n = Number(value);
      // `Number.isFinite` is false for NaN ("not a number", e.g. from "abc") and for Infinity.
      if (!Number.isFinite(n)) throw new Error(`${meta.name} must be a number`);
      return n;
    }
    case "boolean":
      // Accept the usual ways a form or JSON says "yes": true, "true", "on" (a ticked checkbox) or 1.
      return value === true || value === "true" || value === "on" || value === 1;
    case "json":
      // `typeof value === "string"` checks the value's type at run time. Text is parsed as JSON (throws if invalid).
      return typeof value === "string" ? JSON.parse(value) : value;
    case "date": {
      const d = new Date(String(value));
      // An invalid date has a time of NaN.
      if (Number.isNaN(d.getTime())) throw new Error(`${meta.name} must be a date`);
      return d;
    }
    case "enum":
      // Must be one of the allowed values.
      if (!meta.enumValues?.includes(String(value))) throw new Error(`${meta.name} must be one of ${meta.enumValues?.join(", ")}`);
      return String(value);
    default:
      return String(value);
  }
}
