"use server";

import { z } from "zod";
import { rateLimit } from "@fundhub/db/rate-limit";
import { clientIp } from "./client-ip";

/**
 * Newsletter subscriptions live in Listmonk (open source, self-hosted). Its public
 * subscription API handles double opt-in and unsubscribe links for the configured list.
 */
export async function subscribeToListmonk(email: string, name = ""): Promise<boolean> {
  const url = process.env.LISTMONK_URL;
  const list = process.env.LISTMONK_LIST_UUID;
  if (!url || !list) return false;
  const res = await fetch(`${url.replace(/\/$/, "")}/api/public/subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name: name || email.split("@")[0], list_uuids: [list] }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    console.error("Listmonk subscription failed", err);
    return null;
  });
  if (res && !res.ok) console.error("Listmonk subscription failed", res.status, await res.text().catch(() => ""));
  return !!res?.ok;
}

export type NewsletterState = { ok?: string; error?: string };

export async function subscribe(_prev: NewsletterState, formData: FormData): Promise<NewsletterState> {
  if (formData.get("website")) return { ok: "Thanks!" };
  if (!(await rateLimit(`newsletter:${await clientIp()}`, 5, 60 * 60))) return { error: "Too many attempts. Try again later." };
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email." };
  const ok = await subscribeToListmonk(email.data);
  return ok ? { ok: "Check your inbox to confirm your subscription." } : { error: "Subscription is unavailable right now. Please try later." };
}
