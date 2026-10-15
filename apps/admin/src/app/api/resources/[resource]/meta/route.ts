import { NextResponse } from "next/server";
import { apiStaff, jsonError, loadResource } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return staff;
  const r = loadResource((await params).resource);
  if (!r) return jsonError("Unknown resource", 404);
  const canWrite = !!r.def.write?.includes(staff.role);
  return NextResponse.json({
    label: r.def.label,
    columns: r.meta.map((m) => ({ ...m, editable: canWrite && m.editable })),
    search: r.def.search ?? [],
    canCreate: canWrite && !!r.def.canCreate,
    canDelete: canWrite && !!r.def.canDelete,
    canEdit: canWrite && r.hasId,
  });
}
