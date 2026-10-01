import { NextResponse } from "next/server";
import { z } from "zod";
import { answerAdvisorQuestion } from "@/lib/advisor";

const bodySchema = z.object({ message: z.string().trim().min(1).max(500) });

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { message: string } (1–500 chars)." }, { status: 400 });
  }
  return NextResponse.json(await answerAdvisorQuestion(parsed.data.message));
}
