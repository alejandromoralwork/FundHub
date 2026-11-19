/**
 * FILE: apps/admin/src/app/(console)/drive/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Drive" page: a button that opens FundHub's internal file drive (FileBrowser Quantum on the
 *   Azure VM, behind the VM 2FA login; see docs/operations.md → Drive).
 *   The address comes from DRIVE_URL, or the VM default in src/lib/drive.ts.
 * WHERE IT RUNS: on the server (reads the env and checks the role); DriveView runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/drive = the URL /admin/drive.
 */

import type { Metadata } from "next";
import { DriveView } from "@/components/drive-view";
import { CAN, requireStaff } from "@/lib/auth";
import { driveFilesUrl } from "@/lib/drive";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Drive" };

/**
 * Kind: React component (async server component) — the page.
 * @returns `Promise<JSX>`: the Open Drive card.
 */
export default async function DrivePage() {
  await requireStaff(CAN.drive);
  return <DriveView url={driveFilesUrl()} />;
}
