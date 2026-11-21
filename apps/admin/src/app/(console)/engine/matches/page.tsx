/** FILE: apps/admin/src/app/(console)/engine/matches/page.tsx — old URL of Match review, now a tab of Review. */
import { redirect } from "next/navigation";

export default function OldMatches() {
  redirect("/engine/review?tab=matches");
}
