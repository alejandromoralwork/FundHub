import { NextResponse, type NextRequest } from "next/server";
import { searchProviders } from "@fundhub/db/queries";
import { parseFilters } from "@fundhub/core/filters";

export async function GET(req: NextRequest) {
  const filters = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
  const data = await searchProviders(filters);
  return NextResponse.json({ count: data.length, filters, data });
}
