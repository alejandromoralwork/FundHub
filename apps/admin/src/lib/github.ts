import "server-only";

/**
 * Starts the data module's GitHub Actions workflow right away, instead of waiting for the
 * daily sweep. Needs GITHUB_DISPATCH_TOKEN (fine-grained token, Actions: read & write on
 * the repo) and GITHUB_REPO ("owner/name"). Returns false when not configured.
 */
export async function dispatchScrapeWorkflow(): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: process.env.GITHUB_REF_NAME ?? "main", inputs: { command: "jobs" } }),
  });
  if (!res.ok) console.error("workflow dispatch failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}
