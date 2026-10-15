import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@fundhub/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch (err) {
    console.error("Health check failed", err);
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
