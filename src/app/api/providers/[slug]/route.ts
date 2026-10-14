import { NextResponse } from "next/server";
import { getProviderBySlug } from "@/db/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const provider = await getProviderBySlug((await params).slug);
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  return NextResponse.json(provider);
}
