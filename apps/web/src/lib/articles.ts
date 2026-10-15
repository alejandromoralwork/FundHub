/** News live under /news, guides under /learn. */
export const articleHref = (kind: string, slug: string) => `/${kind === "learn" ? "learn" : "news"}/${slug}`;
