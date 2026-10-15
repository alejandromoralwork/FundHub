import type { ExtractedField, IngestSource } from "@fundhub/db/schema";

export type ProviderRef = {
  id: number;
  slug: string;
  name: string;
  website: string | null;
  rcsNumber: string | null;
  headquarters: string;
  foundedYear: number | null;
};

/** Keys are provider column names, so the admin review maps them 1:1. */
export type Extraction = {
  provider: ProviderRef;
  sourceUrl: string | null;
  fields: Record<string, ExtractedField>;
  raw: Record<string, unknown>;
};

export interface Source {
  name: IngestSource;
  /** Null when the source has nothing for this provider. */
  fetch(provider: ProviderRef): Promise<Extraction | null>;
}
