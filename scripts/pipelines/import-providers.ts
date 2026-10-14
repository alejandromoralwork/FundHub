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
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { db } from "@/db/index";
import { providerInputSchema, toNewProvider, upsertProviders } from "@/lib/provider-input";

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);

  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const publish = args.includes("--publish");
  const dryRun = args.includes("--dry-run");

  if (!file) {
    console.error("Usage: npm run pipeline:import -- <file.csv|file.json> [--publish] [--dry-run]");
    process.exit(1);
  }

  const path = resolve(file);
  const text = await readFile(path, "utf8");
  const records: unknown[] = extname(path).toLowerCase() === ".csv" ? parseCsv(text) : JSON.parse(text);

  const valid = [];
  const errors: string[] = [];
  for (const [i, r] of records.entries()) {
    const parsed = providerInputSchema.safeParse(r);
    if (parsed.success) valid.push(toNewProvider(parsed.data, publish ? "published" : "staged"));
    else
      errors.push(
        `  row ${i + 1}: ${parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
      );
  }

  console.log(`Read ${records.length} records from ${file}: ${valid.length} valid, ${errors.length} rejected`);
  if (errors.length) console.log(errors.join("\n"));

  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }

  const written = await upsertProviders(db, valid);
  console.log(`✔ Wrote ${written} providers as "${publish ? "published" : "staged"}"`);
  if (!publish && written) console.log("  Run `npm run pipeline:publish` to make them visible.");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
