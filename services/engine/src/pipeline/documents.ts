/**
 * FILE: services/engine/src/pipeline/documents.ts
 * PART: scraping engine (services/engine) — document housekeeping
 * WHAT IT DOES: `engine docs:purge-unwanted [--apply]` — removes saved filing PDFs that no kept filing needs any
 *   more, after the document rules changed (core/document-scope.ts: DOCUMENT_SCOPE / DOCUMENT_FILINGS):
 *   - a PDF linked only to filings whose TYPE is not kept (signature lists, director-only changes…), or
 *   - a PDF not linked yet whose filing number belongs to a not-kept type.
 *   PDFs linked to at least one kept filing, and PDFs of filings never captured, are left alone. Company scope
 *   (DOCUMENT_SCOPE) is NOT used here: a company leaving the scope keeps the PDFs already saved.
 *   Without --apply it only reports. With --apply: unlink the filings and delete the raw.documents rows in one
 *   transaction, then delete the files (a file that fails to delete is reported; it is an orphan, never a
 *   dangling database reference). The filings list (metadata) is never touched.
 * WHERE IT RUNS: on the VM, by hand (npm run engine -- docs:purge-unwanted).
 */

import { sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { withActor } from "@fundhub/engine-db/core/entity";
import { documentFilingsLabel, filingDocumentSql } from "@fundhub/engine-db/core/document-scope";
import type { BlobStore } from "../storage";

/** Kind: type alias. What a purge found / did. */
export type PurgeResult = { documents: number; bytes: number; filingsUnlinked: number; filesDeleted: number; fileErrors: string[]; byType: Record<string, number>; applied: boolean; rule: string };

/** Kind: async function. Finds (and with apply: removes) the PDFs no kept filing needs. */
export async function purgeUnwantedDocuments(blobs: BlobStore, opts: { apply?: boolean } = {}): Promise<PurgeResult> {
  const wanted = filingDocumentSql("f");
  const rows = (
    await db.execute<{ sha256: string; blob_key: string; bytes: number; types: string[] }>(sql`
      select d.sha256, d.blob_key, d.bytes,
             coalesce((select array_agg(distinct f.type) from clean.filings f where f.document_sha256 = d.sha256 or f.filing_number = d.filing_number), '{}') as types
      from raw.documents d
      where not exists (select 1 from clean.filings f where (f.document_sha256 = d.sha256 or (f.document_sha256 is null and f.filing_number = d.filing_number)) and ${wanted})
        and exists (select 1 from clean.filings f where f.document_sha256 = d.sha256 or f.filing_number = d.filing_number)`)
  ).rows;
  const byType: Record<string, number> = {};
  for (const r of rows) for (const t of r.types) byType[t] = (byType[t] ?? 0) + 1;
  const result: PurgeResult = { documents: rows.length, bytes: rows.reduce((a, r) => a + r.bytes, 0), filingsUnlinked: 0, filesDeleted: 0, fileErrors: [], byType, applied: !!opts.apply, rule: documentFilingsLabel() };
  if (!opts.apply || !rows.length) return result;

  const hashes = rows.map((r) => r.sha256);
  await db.transaction(async (tx) => {
    await withActor(tx, "engine:docs-purge");
    const un = await tx.execute(sql`update clean.filings set document_sha256 = null where document_sha256 in ${hashes}`);
    result.filingsUnlinked = un.rowCount ?? 0;
    await tx.execute(sql`delete from raw.documents where sha256 in ${hashes}`);
  });
  for (const r of rows) {
    try {
      await blobs.delete(r.blob_key);
      result.filesDeleted++;
    } catch (err) {
      result.fileErrors.push(`${r.blob_key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
