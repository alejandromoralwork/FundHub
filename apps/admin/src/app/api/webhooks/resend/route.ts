import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@fundhub/db/client";
import { emailMessages } from "@fundhub/db/schema";

const STATUS: Record<string, "delivered" | "bounced" | "complained" | "sent"> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

/** Resend signs webhooks with Svix: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_". */
function verify(req: Request, body: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigs = req.headers.get("svix-signature");
  if (!secret || !id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false; // replay window
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigs.split(" ").some((s) => {
    const sig = Buffer.from(s.split(",")[1] ?? "", "base64");
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!verify(req, body)) return NextResponse.json({ message: "Invalid signature" }, { status: 401 });
  const event = JSON.parse(body) as { type: string; data?: { email_id?: string } };
  const status = STATUS[event.type];
  if (status && event.data?.email_id) {
    await db.update(emailMessages).set({ status }).where(eq(emailMessages.providerMessageId, event.data.email_id));
  }
  return NextResponse.json({ received: true });
}
