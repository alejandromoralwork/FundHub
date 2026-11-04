/**
 * FILE: apps/web/src/app/legal/[page]/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shows one of the legal documents (privacy policy, terms, cookies, imprint...) at
 *   /legal/<name>, e.g. /legal/privacy. The texts live in the file src/content/legal.ts (the LEGAL object);
 *   this page just picks the right one, draws its sections, and adds a menu linking to all the others.
 * WHERE IT RUNS: on the server (Node.js). As the documents never change between deployments, Next.js
 *   builds each one into a ready-made HTML file at build time (see generateStaticParams).
 * FRAMEWORK NOTES:
 *   - page.tsx = a web page; the folder path is the URL. The folder [page] in square brackets is a "dynamic
 *     segment": it matches any value (privacy, terms...) and Next.js gives it to us as `params.page`.
 *   - `generateStaticParams`: a Next.js hook listing every value of [page] to pre-build at build time.
 *   - `generateMetadata`: a Next.js hook that works out the <title>/description from data.
 *   - `notFound()` (from next/navigation): stops drawing and shows the 404 page (app/not-found.tsx).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type Props = {...}`: give a name to an object shape so it can be re-used.
 *   - `Promise<T>`: a value of type T that arrives later; `await` waits for it.
 *   - destructuring `const { page } = ...` / `([key, d]) =>`: pull named parts out of an object or array.
 *   - optional chaining `a?.map(...)`: only call `.map` if `a` exists.
 *   - logical `&&` in JSX: `cond && <X/>` shows X only when cond is true.
 *   - ternary `cond ? a : b`, template strings `` `/legal/${key}` ``, arrow functions `(x) => ...`.
 */

// `import { a } from "b"` loads the named export `a` from module "b" ("next" = npm library, "@/..." = this
// app's src folder). `import X from "b"` loads the module's default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link (like <a>, without a full reload).
import Link from "next/link";
// notFound: shows the 404 page.
import { notFound } from "next/navigation";
// LEGAL: an object mapping each document name ("privacy", "terms"...) to its title, description and sections.
import { LEGAL } from "@/content/legal";

/**
 * Kind: type alias. The props Next.js gives this page: `params`, a Promise of `{ page: string }`, where
 * `page` is the [page] part of the URL.
 */
type Props = { params: Promise<{ page: string }> };

/**
 * Kind: function (Next.js build-time hook). Takes no parameters.
 * @returns an array like `[{ page: "privacy" }, { page: "terms" }, ...]`: one entry per legal document, so
 *          Next.js pre-builds each /legal/<name> page. `Object.keys(LEGAL)` gives the object's property
 *          names as an array; `.map(...)` turns each name into `{ page: name }` (`{ page }` is shorthand for
 *          `{ page: page }`).
 */
export function generateStaticParams() {
  return Object.keys(LEGAL).map((page) => ({ page }));
}

/**
 * Kind: async function (Next.js metadata hook).
 * @param params  from `Props` (destructured with `{ params }`): the URL value, as a Promise.
 * @returns       `Promise<Metadata>`: the document's title and description, or the title "Not found".
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // `(await params).page` waits for params and reads `page`; `LEGAL[...]` looks the document up by name.
  // The result is undefined if no document has that name.
  const p = LEGAL[(await params).page];
  return p ? { title: p.title, description: p.description } : { title: "Not found" };
}

/**
 * Kind: async React component (server component) — the page.
 * @param params  the [page] URL value, as a Promise.
 * @returns       `Promise<JSX>`: menu of legal documents, then the selected document.
 */
export default async function LegalPage({ params }: Props) {
  // Wait for params and pull out `page` (object destructuring).
  const { page } = await params;
  const doc = LEGAL[page];
  // `!doc` = "doc is missing". Unknown names show the 404 page; notFound() stops the function here, so
  // TypeScript knows `doc` exists in the code below.
  if (!doc) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Menu of all legal documents. `flex flex-wrap gap-3` = in a row, wrapping onto new lines if needed. */}
      <nav className="flex flex-wrap gap-3 text-xs">
        {/* `Object.entries(LEGAL)` gives [name, document] pairs; `([key, d]) =>` destructures each pair.
            `.map` returns one Link per document. React needs a unique `key` on items in a list to track them.
            The ternary in `className` makes the current document bold and the others grey. */}
        {Object.entries(LEGAL).map(([key, d]) => (
          <Link key={key} href={`/legal/${key}`} className={key === page ? "font-semibold text-ink" : "text-slate-500 hover:text-ink hover:underline"}>
            {d.title}
          </Link>
        ))}
        <Link href="/privacy-request" className="text-slate-500 hover:text-ink hover:underline">
          Data request
        </Link>
      </nav>
      {/* The document itself, in a white card with a light border. */}
      <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-ink">{doc.title}</h1>
        <div className="mt-5 space-y-5">
          {/* One <section> per document section; `i` is the position (0, 1, 2...), used as the key because
              sections have no id of their own (fine here, the list never changes order). */}
          {doc.sections.map((s, i) => (
            <section key={i}>
              {/* Heading is optional: `s.heading && <h2>` draws it only when the section has one. */}
              {s.heading && <h2 className="mb-2 text-base font-semibold text-ink">{s.heading}</h2>}
              {/* `s.paragraphs?.map(...)`: if the section has paragraphs, draw each one. The key is the first
                  40 characters of the paragraph (`.slice(0, 40)`), which is unique enough within a section. */}
              {s.paragraphs?.map((p) => (
                <p key={p.slice(0, 40)} className="mb-2 text-sm leading-relaxed text-ink-600">
                  {p}
                </p>
              ))}
              {/* Optional bullet list (`list-disc` = round bullets, `pl-5` = indent). */}
              {s.bullets && (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
        {/* Only on the privacy policy: a green note linking to the data request form. */}
        {page === "privacy" && (
          <p className="mt-6 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            To access, correct or delete your data,{" "}
            <Link href="/privacy-request" className="font-semibold underline">
              submit a data request
            </Link>
            .
          </p>
        )}
      </article>
    </main>
  );
}
