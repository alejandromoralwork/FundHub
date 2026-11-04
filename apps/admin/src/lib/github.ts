/**
 * FILE: apps/admin/src/lib/github.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Asks GitHub to start the scraper's workflow now (a "workflow dispatch"), so staff can
 *   refresh provider data on demand instead of waiting for the scheduled daily run.
 * WHERE IT RUNS: only on the server (Node.js), because it uses a secret GitHub token.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file, so the
 *   token can never leak into the browser. `process.env.X` reads an environment variable: a setting
 *   (often a secret) given to the server outside the code, e.g. in the hosting dashboard.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async` function returning `Promise<boolean>` (true/false that arrives later).
 *   - `fetch(url, options)`: the built-in way to make an HTTP request.
 *   - template strings `` `…${repo}…` ``, `??` fallback, `.catch(() => "")` to swallow an error.
 */

// Side-effect import: the guard described above. It exports nothing.
import "server-only";

/**
 * Kind: async function.
 * Starts the data module's GitHub Actions workflow right away, instead of waiting for the
 * daily sweep. Needs GITHUB_DISPATCH_TOKEN (fine-grained token, Actions: read & write on
 * the repo) and GITHUB_REPO ("owner/name"). Returns false when not configured.
 * A fine-grained token limited to Actions on one repository is used so that, if it ever leaked, it could
 * not do much else.
 * @returns `Promise<boolean>` — `true` if GitHub accepted the request, `false` otherwise.
 */
export async function dispatchScrapeWorkflow(): Promise<boolean> {
  // Read the two settings. Each is `string | undefined` (undefined when not set).
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  // `||` = "or": if either is missing, give up quietly (the feature is simply not configured).
  if (!token || !repo) return false;
  // Call GitHub's REST API: POST to the "dispatches" endpoint of the workflow file scrape.yml.
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`, {
    method: "POST",
    // `Authorization: Bearer <token>` proves who we are; the other two headers are GitHub's recommended
    // response format and API version.
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    // The request body, as JSON text: which branch to run on (default "main") and the workflow's input
    // `command: "jobs"` (tells the scraper which task to perform).
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME ?? "main", inputs: { command: "jobs" } }),
  });
  // `res.ok` is true for success codes (200–299). On failure, log the status and GitHub's message;
  // `.catch(() => "")` means "if reading the message itself fails, use empty text" so logging never crashes.
  if (!res.ok) console.error("workflow dispatch failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}
