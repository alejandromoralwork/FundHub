/**
 * FILE: packages/engine-db/drizzle.config.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Settings for drizzle-kit, which compares src/schema.ts with the engine database and writes
 *   numbered SQL migration files into drizzle/. Same idea as packages/db/drizzle.config.ts, but for the
 *   Scraping Engine's separate database.
 * WHERE IT RUNS: on a developer's machine, when someone runs `npm run db:generate -w @fundhub/engine-db`.
 * TYPESCRIPT YOU WILL SEE HERE: imports, `export default`.
 */

import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { engineDirectUrl } from "./src/env";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: engineDirectUrl() },
});
