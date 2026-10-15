/**
 * Local development database: a real Postgres server run from npm (no Docker needed).
 * Data persists in packages/db/.pg-data. Stop with Ctrl+C.
 *
 *   npm run db:local        (then, in another terminal: npm run db:setup)
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const dataDir = fileURLToPath(new URL("../.pg-data", import.meta.url));
const port = 5433;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  onLog: () => {},
});

async function main() {
  const fresh = !existsSync(dataDir);
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("fundhub");
  console.log(`✔ Postgres running on postgres://postgres:postgres@localhost:${port}/fundhub`);
  console.log(fresh ? "  New database created. Run `npm run db:setup` in another terminal." : "  Existing data reused.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
