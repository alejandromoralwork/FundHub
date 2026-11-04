/**
 * Import providers from a JSON or CSV file into the database as "staged".
 * Staged providers are not visible on the site until published.
 *
 *   npm run pipeline:import -- data/import/sample-providers.csv
 *   npm run pipeline:import -- path/to/file.json --publish   (skip staging)
 *   npm run pipeline:import -- file.csv --dry-run            (validate only)
 *
 * CSV: header row with the field names from data/providers.json.
 * List fields (secondaryCategories, techStack, topClients, regulatoryScope, services, assetClasses,
 * licences, certifications, footprint, tags) use "|" as separator. `category` is a taxonomy slug and
 * `services` must use the canonical names from src/lib/taxonomy.ts.
 */
/**
 * FILE: packages/db/scripts/pipelines/import-providers.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Reads a file of service providers (CSV spreadsheet export or JSON), checks every record
 *   against the rules in src/provider-input.ts, reports the bad rows, and writes the good ones to the
 *   providers table. Existing providers with the same slug (URL name) are updated rather than duplicated.
 * WHERE IT RUNS: from a developer's terminal (Node.js). Not part of the website.
 * FRAMEWORK NOTES: `process.argv` is the list of words typed on the command line; the first two are the
 *   Node program and this script, so `.slice(2)` keeps only the user's arguments. Zod (inside
 *   providerInputSchema) is a validation library: `.safeParse(x)` checks x and says success or failure.
 * TYPESCRIPT YOU WILL SEE HERE: return types like `Record<string, string>[]` (an array of objects with text
 *   keys and text values), `string[][]` (array of arrays of text), `let` vs `const`, `for` loops, array
 *   methods `.find/.includes/.some/.map/.push/.join`, rest destructuring `[header, ...body]`, `unknown[]`,
 *   template strings, ternary `c ? a : b`.
 */

// `import { a } from "b"`: bring named items from another module. "node:…" = built into Node.js.
// Loads .env into process.env so DATABASE_URL etc. are available.
import "dotenv/config";
// readFile reads a whole file; the "promises" version returns a Promise you can `await`.
import { readFile } from "node:fs/promises";
// extname("a/b.csv") -> ".csv"; resolve(x) turns a relative path into a full one.
import { extname, resolve } from "node:path";
// The shared Drizzle database object.
import { db } from "../../src/client";
// Validation rules, conversion to a database row, and the insert-or-update helper (all in provider-input.ts).
import { providerInputSchema, toNewProvider, upsertProviders } from "../../src/provider-input";

/**
 * Kind: function.
 * A small CSV reader. CSV = "comma-separated values": one record per line, fields separated by commas;
 * a field containing commas or line breaks is wrapped in double quotes, and a quote inside such a field
 * is written twice ("").
 * @param text  type `string` — the whole file content.
 * @returns `Record<string, string>[]`: one object per data row, keyed by the header row's column names,
 *          e.g. [{ name: "Acme", category: "fund-administration", … }].
 */
function parseCsv(text: string): Record<string, string>[] {
  // All rows found so far; each row is an array of field texts.
  const rows: string[][] = [];
  // The row being built, the field being built, and whether we are inside "quotes".
  // `let` because these values change as we read.
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Walk through the text one character at a time. `i++` adds 1 to i after each step.
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      // Inside quotes: "" means a literal quote character; skip the second one with i++.
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false; // a single quote ends the quoted part
      else field += c; // anything else (even commas or newlines) is part of the field
    } else if (c === '"') quoted = true; // start of a quoted part
    else if (c === ",") {
      // A comma ends the current field.
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // A line break ends the row. Windows files use "\r\n" (two characters): skip the "\n" too.
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      // `.some(f => f.trim())` = "is at least one field non-blank?"; skip completely empty lines.
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  // The last line may not end with a line break: keep what was collected.
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);

  // Rest destructuring: `header` = first row, `body` = an array of all the other rows.
  const [header, ...body] = rows;
  if (!header) return [];
  // Column names with spaces trimmed.
  const keys = header.map((h) => h.trim());
  // For each data row, pair each column name with the field at the same position (or "" if the row is short)
  // and turn the pairs into an object with Object.fromEntries.
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

/**
 * Kind: async function.
 * Reads the command-line options, loads and validates the file, then writes valid rows unless --dry-run.
 * @returns `Promise<void>`.
 */
async function main() {
  const args = process.argv.slice(2);
  // `.find(...)` returns the first item matching the test (here: the first argument not starting with "--"),
  // or undefined if none.
  const file = args.find((a) => !a.startsWith("--"));
  // `.includes(x)` = true when the array contains x.
  const publish = args.includes("--publish");
  const dryRun = args.includes("--dry-run");

  if (!file) {
    console.error("Usage: npm run pipeline:import -- <file.csv|file.json> [--publish] [--dry-run]");
    process.exit(1);
  }

  const path = resolve(file);
  const text = await readFile(path, "utf8");
  // `unknown[]` = an array of values whose shape we have not checked yet. CSV files go through parseCsv;
  // anything else is treated as JSON (JSON.parse turns JSON text into JavaScript values).
  const records: unknown[] = extname(path).toLowerCase() === ".csv" ? parseCsv(text) : JSON.parse(text);

  // Good rows ready for the database, and human-readable error lines for bad ones.
  const valid = [];
  const errors: string[] = [];
  // `records.entries()` yields [index, record] pairs; `[i, r]` unpacks them.
  for (const [i, r] of records.entries()) {
    // safeParse never throws: it returns { success: true, data } or { success: false, error }.
    const parsed = providerInputSchema.safeParse(r);
    // Valid: convert to a database row with status "published" (if --publish) or "staged" (hidden).
    if (parsed.success) valid.push(toNewProvider(parsed.data, publish ? "published" : "staged"));
    else
      // Invalid: one line listing every problem, e.g. "row 3: priceMin: Expected number".
      // e.path is the list of field names leading to the problem; i + 1 because people count rows from 1.
      errors.push(
        `  row ${i + 1}: ${parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      );
  }

  console.log(`Read ${records.length} records from ${file}: ${valid.length} valid, ${errors.length} rejected`);
  // An empty array has length 0, which counts as "false" in an `if`.
  if (errors.length) console.log(errors.join("\n"));

  // --dry-run: only check the file, write nothing. `return` leaves main() early.
  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  // Insert new providers or update existing ones with the same slug, in one SQL statement.
  const written = await upsertProviders(db, valid);
  console.log(`✔ Wrote ${written} providers as "${publish ? "published" : "staged"}"`);
  if (!publish && written) console.log("  Run `npm run pipeline:publish` to make them visible.");
}

// `.then(onSuccess, onFailure)`: exit with code 0 on success. Exiting explicitly is needed because the open
// database pool would otherwise keep Node.js running. On failure print the error and exit with 1.
main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
