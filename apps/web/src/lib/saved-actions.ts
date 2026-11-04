"use server";
/**
 * FILE: apps/web/src/lib/saved-actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The server action behind the "Save" / "Saved" button on a provider's page. It adds the provider
 *   to the logged-in user's shortlist, or removes it if it was already there (a toggle).
 * WHERE IT RUNS: on the server (it writes to the database).
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line, must stay first) makes the exported function a server action: the button's
 *     form calls it and Next.js runs it on the server.
 *   - `revalidatePath(path)` tells Next.js the page at that path has changed, so it is rebuilt with fresh data
 *     (the button then shows the new state).
 *   - Drizzle ORM: `db.select().from(t).where(...)`, `db.delete(t).where(...)`, `db.insert(t).values(...)`.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Number(x)` / `String(x)` = convert to a number / text; `??` = "use the right side if the left is empty".
 *   - array destructuring `const [existing] = …` = take the first item of a list.
 *   - nested template strings `` `…${encodeURIComponent(`/providers/${slug}`)}` ``.
 */

// Drizzle helpers: `and(a, b)` = both conditions; `eq(column, value)` = column equals value.
import { and, eq } from "drizzle-orm";
// Next.js: mark pages as outdated so they are rebuilt.
import { revalidatePath } from "next/cache";
// Next.js: send the visitor to another page.
import { redirect } from "next/navigation";
// `@fundhub/...` = our shared packages. The database connection, and the `saved_providers` table.
import { db } from "@fundhub/db/client";
import { savedProviders } from "@fundhub/db/schema";
// Who is logged in.
import { getCurrentUser } from "./auth/session";

/**
 * Adds or removes a provider from the logged-in user's shortlist.
 * Kind: server action (async function).
 * @param formData  type `FormData` — hidden form fields "providerId" (number as text) and "slug" (the
 *                  provider's URL name, used to return to and refresh the right page).
 * @returns         `Promise<void>`: nothing; the pages are refreshed instead.
 */
export async function toggleSavedProvider(formData: FormData) {
  // Form values always arrive as text, so convert the id to a number.
  const providerId = Number(formData.get("providerId"));
  const slug = String(formData.get("slug") ?? "");
  const user = await getCurrentUser();
  // Anonymous visitors must log in first, then come back to this provider's page.
  if (!user) redirect(`/account/login?next=${encodeURIComponent(`/providers/${slug}`)}`);

  // The condition "this user AND this provider", built once and used for both the lookup and the delete.
  const where = and(eq(savedProviders.userId, user.id), eq(savedProviders.providerId, providerId));
  const [existing] = await db.select().from(savedProviders).where(where);
  // Already saved → remove it. Otherwise → add it. `.onConflictDoNothing()` makes a double click harmless:
  // if the row appeared in the meantime, the database quietly skips the duplicate instead of failing.
  if (existing) await db.delete(savedProviders).where(where);
  else await db.insert(savedProviders).values({ userId: user.id, providerId }).onConflictDoNothing();

  // Both the provider page (the button) and the account page (the shortlist) need fresh data.
  revalidatePath(`/providers/${slug}`);
  revalidatePath("/account");
}
