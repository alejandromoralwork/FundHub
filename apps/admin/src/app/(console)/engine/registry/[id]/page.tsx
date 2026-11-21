/** FILE: apps/admin/src/app/(console)/engine/registry/[id]/page.tsx — old URL of a company page, kept for bookmarks. */
import { redirect } from "next/navigation";

export default async function OldRegistryCompany({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/engine/companies/${(await params).id}`);
}
