import "server-only";
import { getTableColumns, getTableName, type Column } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as s from "@fundhub/db/schema";
import type { StaffRole } from "@fundhub/core/enums";
import { CAN } from "./auth";

/**
 * Tables exposed in the Database module. Every table is browsable; only those with
 * `write` roles are editable here (others are managed by their own module or by Stripe).
 * `hidden` columns never leave the server.
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

const EDIT = CAN.editData;
const READ_ONLY_TS = ["id", "createdAt", "updatedAt"];

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

export type ColumnMeta = {
  name: string;
  dbName: string;
  type: "number" | "text" | "boolean" | "json" | "date" | "enum";
  enumValues?: string[];
  nullable: boolean;
  editable: boolean;
  primary: boolean;
};

export function getResource(name: string): ResourceDef | undefined {
  return Object.prototype.hasOwnProperty.call(RESOURCES, name) ? RESOURCES[name] : undefined;
}

function kind(col: Column): ColumnMeta["type"] {
  if (col.enumValues?.length) return "enum";
  switch (col.dataType) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "json";
    case "date":
      return "date";
    default:
      return "text";
  }
}

export function columnsOf(def: ResourceDef): ColumnMeta[] {
  const hidden = new Set(def.hidden ?? []);
  const readOnly = new Set(def.readOnly ?? []);
  return Object.entries(getTableColumns(def.table))
    .filter(([name]) => !hidden.has(name))
    .map(([name, col]) => ({
      name,
      dbName: col.name,
      type: kind(col),
      enumValues: col.enumValues?.length ? [...col.enumValues] : undefined,
      nullable: !col.notNull,
      primary: col.primary,
      editable: !!def.write && !col.primary && !readOnly.has(name),
    }));
}

export function tableName(def: ResourceDef) {
  return getTableName(def.table);
}

/** Converts form/JSON input into the column's runtime type; throws on invalid values. */
export function coerce(meta: ColumnMeta, value: unknown): unknown {
  if (value === "" || value === undefined) return meta.nullable ? null : value;
  if (value === null) {
    if (!meta.nullable) throw new Error(`${meta.name} is required`);
    return null;
  }
  switch (meta.type) {
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${meta.name} must be a number`);
      return n;
    }
    case "boolean":
      return value === true || value === "true" || value === "on" || value === 1;
    case "json":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "date": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) throw new Error(`${meta.name} must be a date`);
      return d;
    }
    case "enum":
      if (!meta.enumValues?.includes(String(value))) throw new Error(`${meta.name} must be one of ${meta.enumValues?.join(", ")}`);
      return String(value);
    default:
      return String(value);
  }
}
