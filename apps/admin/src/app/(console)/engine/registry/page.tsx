/** FILE: apps/admin/src/app/(console)/engine/registry/page.tsx — old URL of the Companies page, kept for bookmarks. */
import { redirect } from "next/navigation";

export default async function OldRegistry({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = new URLSearchParams(await searchParams).toString();
  redirect(`/engine/companies${q ? `?${q}` : ""}`);
}
