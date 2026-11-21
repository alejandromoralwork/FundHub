/**
 * FILE: apps/admin/src/app/(console)/engine/layout.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Wraps every Scraping Engine page. In development it first makes sure the engine database is
 *   running (starting it if needed, see lib/engine-boot.ts), so opening the section "kicks" the service.
 * WHERE IT RUNS: on the server (React Server Component).
 */

import type { ReactNode } from "react";
import { ensureEngineDb } from "@/lib/engine-boot";

export default async function EngineLayout({ children }: { children: ReactNode }) {
  await ensureEngineDb();
  return children;
}
