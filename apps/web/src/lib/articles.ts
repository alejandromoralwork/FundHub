/**
 * FILE: apps/web/src/lib/articles.ts
 * PART: website (apps/web)
 * WHAT IT DOES: One tiny helper that builds the web address (URL path) of an article. FundHub has two kinds
 *   of article: news items, shown under /news, and guides, shown under /learn.
 * WHERE IT RUNS: both — it is plain code with no server-only or browser-only parts, so any page or component
 *   can use it.
 * FRAMEWORK NOTES: none; this is ordinary TypeScript.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `export` = makes the constant usable from other files (they `import` it).
 *   - arrow functions `(a, b) => result` = a short way to write a function.
 *   - parameter types `kind: string` = the value must be text.
 *   - template strings `` `/${x}` `` = text with values inserted where `${…}` appears.
 *   - ternary `cond ? a : b` = "if cond then a, otherwise b".
 */

/**
 * News live under /news, guides under /learn.
 * Kind: constant holding an arrow function.
 * @param kind  type `string` — the article kind stored in the database, e.g. "news" or "learn".
 * @param slug  type `string` — the article's URL-friendly name, e.g. "new-cssf-circular".
 * @returns     `string` (TypeScript works this out itself): the path, e.g. "/learn/new-cssf-circular".
 * Why: keeping the rule in one place means every link to an article is built the same way. Any kind other
 * than "learn" falls back to "/news", so an unexpected value still produces a working link.
 */
export const articleHref = (kind: string, slug: string) => `/${kind === "learn" ? "learn" : "news"}/${slug}`;
