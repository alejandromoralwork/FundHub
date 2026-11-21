/**
 * FILE: apps/admin/src/lib/engine-boot.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Development convenience: when a Scraping Engine page opens and the engine database is down,
 *   start it ("kick" it) instead of only showing "not reachable". If ENGINE_DATABASE_URL points at the local
 *   embedded Postgres (port 5434), it runs `npm run engine:db:local` in the background; for another local
 *   server (e.g. the system Postgres on 5432) it tries `sudo -n systemctl start postgresql`. Once the server
 *   answers and the engine tables are missing, it runs `npm run engine:db:setup` (migrations + seed).
 * WHERE IT RUNS: server only, and only when NODE_ENV !== "production" and the database host is local.
 *   In production nothing happens: managed databases are never started from the Console.
 */

import "server-only";
import { execFile, spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pool } from "@fundhub/engine-db/client";
import { engineDatabaseUrl, LOCAL_ENGINE_DATABASE_URL } from "@fundhub/engine-db/env";

const run = promisify(execFile);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Kind: function. True when something accepts TCP connections on host:port. */
function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.end(); done(true); });
    socket.once("timeout", () => { socket.destroy(); done(false); });
    socket.once("error", () => done(false));
  });
}

/** Kind: async function. Polls the port until it opens or `ms` elapses. */
async function waitForPort(host: string, port: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await portOpen(host, port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Kind: function. The monorepo root (the folder that contains packages/engine-db), walking up from cwd. */
function repoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "packages", "engine-db", "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/** Kind: async function. Starts the database server behind `url` if it is local and down. */
async function startServer(url: URL, root: string): Promise<void> {
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  const port = Number(url.port || 5432);
  if (await portOpen(host, port)) return;

  const isEmbedded = port === Number(new URL(LOCAL_ENGINE_DATABASE_URL).port);
  if (isEmbedded) {
    // Detached so it outlives Next.js hot reloads; output goes to a log file for troubleshooting.
    const log = openSync(path.join(tmpdir(), "fundhub-engine-db.log"), "a");
    const child = spawn("npm", ["run", "engine:db:local"], { cwd: root, detached: true, stdio: ["ignore", log, log] });
    child.unref();
    console.log(`[engine-boot] starting embedded engine Postgres on :${port} (log: ${path.join(tmpdir(), "fundhub-engine-db.log")})`);
  } else {
    // System Postgres: only works without a password prompt (-n); otherwise the page shows the usual error.
    console.log(`[engine-boot] engine Postgres on :${port} is down, trying systemctl start postgresql`);
    await run("sudo", ["-n", "systemctl", "start", "postgresql"]).catch(() => {});
  }
  await waitForPort(host, port, 60_000);
}

/** Kind: async function. Runs migrations + seed when the engine tables do not exist yet. */
async function setupSchemaIfMissing(url: string, root: string): Promise<void> {
  const { rows } = await pool.query<{ t: string | null }>("select to_regclass('public.census_snapshots')::text as t");
  if (rows[0]?.t) return;
  console.log("[engine-boot] engine tables missing, running npm run engine:db:setup");
  await run("npm", ["run", "engine:db:setup"], {
    cwd: root,
    env: { ...process.env, ENGINE_DATABASE_URL: url },
    timeout: 180_000,
  });
}

/** Kind: async function. The full check: start the server if needed, then create the schema if needed. */
async function boot(): Promise<void> {
  const raw = engineDatabaseUrl();
  const url = new URL(raw);
  if (!LOCAL_HOSTS.has(url.hostname)) return;
  const root = repoRoot();
  if (!root) return;
  await startServer(url, root);
  await setupSchemaIfMissing(raw, root);
}

let inFlight: Promise<void> | null = null;

/**
 * Kind: async function. Call before engine queries. No-op in production and for remote databases.
 * Never throws: if the kick fails, the caller's own query fails and shows the usual "unavailable" message.
 */
export async function ensureEngineDb(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  inFlight ??= boot()
    .catch((err) => console.error("[engine-boot]", err))
    .finally(() => { inFlight = null; });
  return inFlight;
}
