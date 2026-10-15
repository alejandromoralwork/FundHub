/** Applies pending migrations from ./drizzle. Run by the admin app's build on Vercel. */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { migrationUrl } from "../src/env";

async function main() {
  const pool = new Pool({ connectionString: migrationUrl(), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  await pool.end();
  console.log("✔ Migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
