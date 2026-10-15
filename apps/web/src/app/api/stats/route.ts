import { NextResponse } from "next/server";
import { getEcosystemStats, getFeeBenchmarks } from "@fundhub/db/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, benchmarks] = await Promise.all([getEcosystemStats(), getFeeBenchmarks()]);
  return NextResponse.json({ ...stats, benchmarks });
}
