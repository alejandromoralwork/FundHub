/**
 * FILE: apps/admin/src/lib/drive.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The address of FundHub's internal drive (FileBrowser Quantum on the Azure VM). DRIVE_URL
 *   overrides it; without it the VM's address is used, so the Drive works even before the setting exists.
 *   `driveFilesUrl()` opens straight into the shared "FundHub" folder.
 * WHERE IT RUNS: on the server (reads the environment).
 */

/** Kind: constant. The VM's drive when DRIVE_URL is not set (see docs/operations.md → Drive). */
const DEFAULT_DRIVE_URL = "https://alejandro-code.centralindia.cloudapp.azure.com/drive";

/** Kind: function. The drive's base address, without a trailing slash. */
export function driveUrl(): string {
  return (process.env.DRIVE_URL?.trim() || DEFAULT_DRIVE_URL).replace(/\/+$/, "");
}

/** Kind: function. The drive opened on the shared "FundHub" folder. */
export function driveFilesUrl(): string {
  return `${driveUrl()}/files/FundHub/`;
}
