/**
 * FILE: apps/admin/src/app/(console)/drive/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Drive" page: FundHub's internal file drive (a self-hosted open-source file manager on the
 *   Azure VM, see docs/operations.md) shown inside the console, with a button to open it in its own tab.
 *   The address comes from DRIVE_URL; without it the page explains how to set it up.
 * WHERE IT RUNS: on the server (reads the env and checks the role); DriveView runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/drive = the URL /admin/drive.
 */

import type { Metadata } from "next";
import { DriveView } from "@/components/drive-view";
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Drive" };

/**
 * Kind: React component (async server component) — the page.
 * @returns `Promise<JSX>`: the embedded drive, or setup instructions when DRIVE_URL is not set.
 */
export default async function DrivePage() {
  await requireStaff(CAN.drive);
  const url = process.env.DRIVE_URL?.replace(/\/$/, "") || null;
  return <DriveView url={url ? `${url}/` : null} />;
}
