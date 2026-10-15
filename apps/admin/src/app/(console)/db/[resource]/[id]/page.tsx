import { notFound } from "next/navigation";
import { ResourceEdit } from "@/components/db-views";
import { getResource } from "@/lib/resources";

export default async function ResourceRecordPage({ params }: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await params;
  if (!getResource(resource)) notFound();
  return <ResourceEdit resource={resource} id={id === "create" ? undefined : id} />;
}
