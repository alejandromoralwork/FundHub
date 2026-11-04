/**
 * FILE: apps/web/src/app/news/[slug]/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shows one news article, e.g. /news/new-cssf-circular. The shared ArticlePage component does
 *   the real work (load from the database, draw, 404 if missing); it is the same one used for Learn guides.
 * WHERE IT RUNS: on the server (Node.js), as a React server component, so it can read the database.
 * FRAMEWORK NOTES: In the Next.js App Router a file called page.tsx is a web page and its folder path is the
 *   URL. The folder [slug] in square brackets is a "dynamic segment": it matches any value and Next.js hands
 *   it to the page as `params.slug`, so this one file serves every news article.
 *   `export const dynamic = "force-dynamic"` makes Next.js build the page fresh on each visit (no cached copy).
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
 *               `params`, wrapped in a Promise (ArticlePage awaits it).
 * @returns      JSX: ArticlePage with every prop passed through (`{...props}`) plus `kind="news"` so it only
 *               looks among news articles.
 */
export default function Page(props: { params: Promise<{ slug: string }> }) {
  return <ArticlePage {...props} kind="news" />;
}
