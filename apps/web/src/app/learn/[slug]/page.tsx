/**
 * FILE: apps/web/src/app/learn/[slug]/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shows one "Learn" guide, e.g. /learn/how-to-read-a-fee-proposal. All the real work
 *   (loading the article from the database, drawing it, 404 if missing) is done by the shared ArticlePage
 *   component, which is also used for news articles.
 * WHERE IT RUNS: on the server (Node.js), as a React server component, so it can read the database.
 * FRAMEWORK NOTES: In the Next.js App Router a file called page.tsx is a web page and its folder path is the
 *   URL. A folder name in square brackets, like [slug], is a "dynamic segment": it matches any value, and
 *   Next.js hands that value to the page as `params.slug`. So this one file serves every guide.
 *   `export const dynamic = "force-dynamic"` tells Next.js to build the page fresh on every visit instead of
 *   once at build time, so newly published guides appear immediately.
 *   `export const generateMetadata` is the Next.js hook for a page title/description that depends on data.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - object types `{ slug: string }`: an object with a text property called slug.
 *   - `Promise<T>`: a value of type T that arrives later (Next.js gives `params` as a Promise).
 *   - spread `{...props}`: pass every property of `props` on to another component.
 */

// `import { a, b } from "x"` loads named exports from a module; "@/..." is this app's src folder.
// ArticlePage draws an article; articleMetadata works out its <title> and description.
import { ArticlePage, articleMetadata } from "@/components/article-page";

/** Kind: constant (Next.js setting). Render on every request, never cache a pre-built copy. */
export const dynamic = "force-dynamic";
/**
 * Kind: constant pointing at a function (Next.js metadata hook).
 * Re-uses the shared articleMetadata function so the tab title is the article's own title.
 */
export const generateMetadata = articleMetadata;

/**
 * Kind: React component (server component) — the page.
 * @param props  type `{ params: Promise<{ slug: string }> }`: Next.js passes the URL's [slug] value inside
 *               `params`, wrapped in a Promise (it must be awaited before use; ArticlePage does that).
 * @returns      JSX: the ArticlePage component with every prop passed through (`{...props}`) plus
 *               `kind="learn"` so it only looks among Learn guides, not news.
 */
export default function Page(props: { params: Promise<{ slug: string }> }) {
  return <ArticlePage {...props} kind="learn" />;
}
