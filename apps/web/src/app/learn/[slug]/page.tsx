import { ArticlePage, articleMetadata } from "@/components/article-page";

export const dynamic = "force-dynamic";
export const generateMetadata = articleMetadata;

export default function Page(props: { params: Promise<{ slug: string }> }) {
  return <ArticlePage {...props} kind="learn" />;
}
