import "server-only";
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";
import { db } from "@fundhub/db/client";
import { getSession, type Staff } from "./auth";
import { coerce, columnsOf, getResource, type ColumnMeta } from "./resources";

/** Fully authenticated staff for API routes (JSON 401 instead of a redirect). */
export async function apiStaff(): Promise<Staff | NextResponse> {
  const s = await getSession();
  if (!s || !s.mfaPassed) return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  return s.staff;
}

export const jsonError = (message: string, status = 400) => NextResponse.json({ message }, { status });

export function loadResource(name: string) {
  const def = getResource(name);
  if (!def) return null;
  const meta = columnsOf(def);
  const cols = getTableColumns(def.table) as unknown as Record<string, PgColumn>;
  const selection = Object.fromEntries(meta.map((m) => [m.name, cols[m.name]!]));
  const hasId = meta.some((m) => m.name === "id");
  return { def, meta, cols, selection, hasId };
}

export type ListParams = {
  page: number;
  pageSize: number;
  sort?: string;
  order: "asc" | "desc";
  q?: string;
  filters: Record<string, string>;
};

export function parseListParams(url: URL): ListParams {
  const sp = url.searchParams;
  const filters: Record<string, string> = {};
  for (const [k, v] of sp) {
    const m = k.match(/^filter\[(\w+)\]$/);
    if (m && v !== "") filters[m[1]!] = v;
  }
  return {
    page: Math.max(1, Number(sp.get("page")) || 1),
    pageSize: Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 20)),
    sort: sp.get("sort") ?? undefined,
    order: sp.get("order") === "asc" ? "asc" : "desc",
    q: sp.get("q")?.trim() || undefined,
    filters,
  };
}

export function buildWhere(r: NonNullable<ReturnType<typeof loadResource>>, p: ListParams): SQL | undefined {
  const conds: SQL[] = [];
  if (p.q && r.def.search?.length) {
    const term = `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const parts = r.def.search.map((f) => ilike(sql`${r.cols[f]!}::text`, term));
    conds.push(or(...parts)!);
  }
  for (const [field, raw] of Object.entries(p.filters)) {
    const m = r.meta.find((c) => c.name === field);
    if (!m) continue;
    conds.push(eq(r.cols[field]!, coerce(m, raw) as never));
  }
  return conds.length ? and(...conds) : undefined;
}

export async function listRows(r: NonNullable<ReturnType<typeof loadResource>>, p: ListParams) {
  const where = buildWhere(r, p);
  const sortField = p.sort && r.cols[p.sort] ? p.sort : r.def.defaultSort ?? (r.hasId ? "id" : undefined);
  const orderBy = sortField ? [(p.sort ? p.order : sortField === "id" ? "desc" : "asc") === "asc" ? asc(r.cols[sortField]!) : desc(r.cols[sortField]!)] : [];
  const [data, [{ n }]] = await Promise.all([
    db
      .select(r.selection)
      .from(r.def.table)
      .where(where)
      .orderBy(...orderBy)
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize),
    db.select({ n: count() }).from(r.def.table).where(where),
  ]);
  return { data, total: n };
}

/** Validates a write payload against editable columns only. */
export function writable(meta: ColumnMeta[], body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const m of meta) {
    if (!m.editable || !(m.name in body)) continue;
    out[m.name] = coerce(m, body[m.name]);
  }
  return out;
}
