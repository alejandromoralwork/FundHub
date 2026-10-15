import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@fundhub/db/client";
import { apiStaff, jsonError, loadResource, writable } from "@/lib/api";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ resource: string; id: string }> };

async function setup(ctx: Ctx) {
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return { error: staff } as const;
  const { resource, id } = await ctx.params;
  const r = loadResource(resource);
  if (!r || !r.hasId) return { error: jsonError("Unknown resource", 404) } as const;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return { error: jsonError("Invalid id") } as const;
  return { staff, r, resource, id: numericId, where: eq(r.cols.id!, numericId) } as const;
}

export async function GET(_req: Request, ctx: Ctx) {
  const s = await setup(ctx);
  if ("error" in s) return s.error;
  const [row] = await db.select(s.r.selection).from(s.r.def.table).where(s.where).limit(1);
  return row ? NextResponse.json({ data: row }) : jsonError("Not found", 404);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await setup(ctx);
  if ("error" in s) return s.error;
  if (!s.r.def.write?.includes(s.staff.role)) return jsonError("Not allowed", 403);
  try {
    const values = writable(s.r.meta, await req.json());
    if (!Object.keys(values).length) return jsonError("Nothing to update");
    const [before] = await db.select(s.r.selection).from(s.r.def.table).where(s.where);
    if (!before) return jsonError("Not found", 404);
    const [row] = await db.update(s.r.def.table).set(values as never).where(s.where).returning(s.r.selection);
    const changes = Object.fromEntries(
      Object.keys(values)
        .filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((row as Record<string, unknown>)[k]))
        .map((k) => [k, { from: (before as Record<string, unknown>)[k], to: (row as Record<string, unknown>)[k] }]),
    );
    await audit(s.staff, "update", s.resource, s.id, changes);
    return NextResponse.json({ data: row });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Invalid data");
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await setup(ctx);
  if ("error" in s) return s.error;
  if (!s.r.def.canDelete || !s.r.def.write?.includes(s.staff.role)) return jsonError("Not allowed", 403);
  const [row] = await db.delete(s.r.def.table).where(s.where).returning(s.r.selection);
  if (!row) return jsonError("Not found", 404);
  await audit(s.staff, "delete", s.resource, s.id, { deleted: row });
  return NextResponse.json({ data: row });
}
