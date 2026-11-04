/**
 * FILE: packages/db/drizzle.config.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Settings for "drizzle-kit", the command-line tool that compares our table definitions in
 *   src/schema.ts with the real database and writes SQL "migration" files into the drizzle/ folder.
 *   A migration is a numbered SQL script that changes the database structure step by step (add a table,
 *   add a column…), so every copy of the database (local, production) can be brought to the same shape.
 * WHERE IT RUNS: only on a developer's machine or a build server (Node.js), when someone runs a
 *   drizzle-kit command such as `drizzle-kit generate`. It is never part of the website itself.
 * FRAMEWORK NOTES: drizzle-kit looks for a file called drizzle.config.ts in the package folder and reads
 *   its default export. That is why the file name and the `export default` matter.
 * TYPESCRIPT YOU WILL SEE HERE: `import` statements, `export default` (the file's one main value),
 *   object literals `{ key: value }`.
 */

// `import x from "y"` pulls code from another file or library into this one.
// `import "dotenv/config"` (no name) just runs that library: it reads the local .env file and copies its
// lines (e.g. DATABASE_URL=…) into `process.env`, so secrets do not have to be typed into the code.
import "dotenv/config";
// `{ defineConfig }` = take only the item called defineConfig from the drizzle-kit library (installed
// from npm). It is a helper that checks our settings object has the right shape.
import { defineConfig } from "drizzle-kit";
// "./src/env" = a file in this package (the ./ means "relative to this file"). migrationUrl() returns the
// database address to use for structure changes (see src/env.ts).
import { migrationUrl } from "./src/env";

// `export default` hands this settings object to drizzle-kit.
export default defineConfig({
  // Where our TypeScript table definitions live.
  schema: "./src/schema.ts",
  // Folder where generated .sql migration files (and drizzle/meta bookkeeping files) are written.
  out: "./drizzle",
  // Which SQL dialect to generate: Postgres.
  dialect: "postgresql",
  // How to connect to the database when drizzle-kit needs to look at it.
  dbCredentials: { url: migrationUrl() },
});
