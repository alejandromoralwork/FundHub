/**
 * FILE: services/engine/src/core/media.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Downloads a logo image (found by the web agent on a provider's site), checks it really is an
 *   image of reasonable size, and stores it in object storage under logos/<sha256>.<ext>. The returned `Logo`
 *   goes into the record's facts (`facts.logo`), so it gets history and precedence like any other fact.
 * WHERE IT RUNS: the web-agent job (phase 6), before ingest — parsers stay pure, downloads happen here.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<string, string>` lookup, early returns with `null`.
 */

import type { Logo } from "@fundhub/engine-db/schema";
import type { PoliteHttp } from "../http";
import { blobKey, sha256, type BlobStore } from "../storage";

/** Kind: constant. Accepted image types → file extension. */
const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};
/** Kind: constant. Larger files are not logos (hero images, banners). */
const MAX_LOGO_BYTES = 2_000_000;

/**
 * Kind: async function. Fetches and stores a logo.
 * @param url    absolute image URL.
 * @param deps   the polite HTTP client, the blob store, and the per-host delay.
 * @returns `Promise<Logo | null>` — null when the URL is not a usable image.
 */
export async function storeLogo(url: string, deps: { http: PoliteHttp; blobs: BlobStore; delayMs: number }): Promise<Logo | null> {
  const res = await deps.http.get(url, { delayMs: deps.delayMs, accept: "image/*", okStatuses: [404, 403] });
  if (res.status >= 400) return null;
  const mime = (res.contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[mime];
  if (!ext || res.body.length === 0 || res.body.length > MAX_LOGO_BYTES) return null;
  // SVG is text: refuse anything with scripts so a stored logo can be shown safely later.
  if (ext === "svg" && /<script|on\w+\s*=|javascript:/i.test(res.body.toString("utf8"))) return null;
  const hash = sha256(res.body);
  const key = blobKey("logos", hash, ext);
  await deps.blobs.put(key, res.body, mime);
  return { blobKey: key, sourceUrl: url, mime, sha256: hash, bytes: res.body.length };
}
