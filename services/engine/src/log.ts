/**
 * FILE: services/engine/src/log.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Structured logging — one JSON object per line ({"t":…,"level":…,"msg":…, …fields}), which
 *   Docker, Azure Monitor and any log tool can filter. LOG_FORMAT=pretty prints readable lines on a laptop.
 * WHERE IT RUNS: everywhere in the engine.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<string, unknown>`, a function type alias.
 */

type Level = "debug" | "info" | "warn" | "error";
/** Kind: type alias. A logging function: message + optional fields. */
export type LogFn = (msg: string, fields?: Record<string, unknown>) => void;

const pretty = process.env.LOG_FORMAT === "pretty" || (!process.env.LOG_FORMAT && process.stdout.isTTY);
const quiet = process.env.LOG_LEVEL === "warn";

/** Kind: function. Writes one log line. */
function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (quiet && (level === "debug" || level === "info")) return;
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (pretty) out.write(`${level.toUpperCase().padEnd(5)} ${msg}${fields ? " " + JSON.stringify(fields) : ""}\n`);
  else out.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }) + "\n");
}

/** Kind: constant. The engine logger. */
export const log = {
  debug: ((m, f) => write("debug", m, f)) as LogFn,
  info: ((m, f) => write("info", m, f)) as LogFn,
  warn: ((m, f) => write("warn", m, f)) as LogFn,
  error: ((m, f) => write("error", m, f)) as LogFn,
};
