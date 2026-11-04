"use client";

/**
 * FILE: apps/admin/src/components/download.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: A tiny helper that turns a piece of text (for example a CSV export or a GDPR data export)
 *   into a file the staff member's browser downloads, without asking the server for a separate file URL.
 * WHERE IT RUNS: in the browser only. It uses browser-only things (`document`, `Blob`, `URL.createObjectURL`)
 *   that do not exist on the server, which is why the file starts with "use client".
 * FRAMEWORK NOTES: "use client" is a Next.js directive. It must be the very first line and marks this module
 *   as browser code, so components that run in the browser may import it.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `export function` = a named function other files can import.
 *   - typed parameters (`filename: string`) and a default value (`type = "text/plain"`; TypeScript infers string).
 *   - arrow functions `() => …` = short anonymous functions.
 */

/**
 * Kind: function (no return value, i.e. it returns `void`).
 * Saves text as a file in the browser (anchor attached to the DOM so every browser starts the download).
 * @param filename  type `string` — the name the downloaded file gets, e.g. "providers.csv".
 * @param text      type `string` — the full contents of the file.
 * @param type      type `string`, optional with default "text/plain" — the MIME type that tells the browser
 *                  what kind of file it is (e.g. "text/csv" or "application/json").
 * Why: the browser has no "save this string" command, so we fake a click on a hidden download link.
 */
export function downloadText(filename: string, text: string, type = "text/plain") {
  // `new Blob([text], { type })` wraps the text in a file-like object held in browser memory.
  // `{ type }` is shorthand for `{ type: type }`. `URL.createObjectURL` gives it a temporary "blob:" address.
  const url = URL.createObjectURL(new Blob([text], { type }));
  // Create an invisible <a> (link) element. `Object.assign(target, {...})` copies the listed properties onto it:
  // `href` = where the link points, `download` = "save as this file name instead of opening it".
  const a = Object.assign(document.createElement("a"), { href: url, download: filename, style: "display:none" });
  // Add the link to the page; some browsers (notably Firefox) ignore clicks on links that are not on the page.
  document.body.appendChild(a);
  // Simulate a click, which starts the download.
  a.click();
  // Remove the hidden link again so the page stays clean.
  a.remove();
  // After one second (1000 ms) free the memory used by the blob address. `setTimeout(fn, ms)` runs fn later;
  // we wait a moment so the browser has time to start the download first.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
