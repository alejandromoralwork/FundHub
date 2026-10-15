import { NextResponse } from "next/server";
import { db } from "@fundhub/db/client";
import { apiStaff, jsonError, listRows, loadResource, parseListParams, writable } from "@/lib/api";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ resource: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return staff;
  const r = loadResource((await params).resource);
  if (!r) return jsonError("Unknown resource", 404);
  return NextResponse.json(await listRows(r, parseListParams(new URL(req.url))));
}

export async function POST(req: Request, { params }: Ctx) {
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return staff;
  const name = (await params).resource;
  const r = loadResource(name);
  if (!r) return jsonError("Unknown resource", 404);
  if (!r.def.canCreate || !r.def.write?.includes(staff.role)) return jsonError("Not allowed", 403);
  try {
    const values = writable(r.meta, await req.json());
    const [row] = await db.insert(r.def.table).values(values as never).returning(r.selection);
    await audit(staff, "create", name, (row as { id?: number }).id, values);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Invalid data");
  }
}
