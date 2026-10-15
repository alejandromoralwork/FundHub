import { notFound } from "next/navigation";
import { ResourceList } from "@/components/db-views";
import { getResource } from "@/lib/resources";

export default async function ResourcePage({ params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  if (!getResource(resource)) notFound();
  return <ResourceList resource={resource} />;
}
