"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@fundhub/db/client";
import { savedProviders } from "@fundhub/db/schema";
import { getCurrentUser } from "./auth/session";

/** Adds or removes a provider from the logged-in user's shortlist. */
export async function toggleSavedProvider(formData: FormData) {
  const providerId = Number(formData.get("providerId"));
  const slug = String(formData.get("slug") ?? "");
  const user = await getCurrentUser();
  if (!user) redirect(`/account/login?next=${encodeURIComponent(`/providers/${slug}`)}`);

  const where = and(eq(savedProviders.userId, user.id), eq(savedProviders.providerId, providerId));
  const [existing] = await db.select().from(savedProviders).where(where);
  if (existing) await db.delete(savedProviders).where(where);
  else await db.insert(savedProviders).values({ userId: user.id, providerId }).onConflictDoNothing();

  revalidatePath(`/providers/${slug}`);
  revalidatePath("/account");
}
