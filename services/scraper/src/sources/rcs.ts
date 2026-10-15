/**
 * RCS (Luxembourg Business Registers) source.
 *
 * The real data source isn't chosen yet: LBR's API is paid and enterprise-oriented, and
 * scraping lbr.lu may breach its terms. Adapters implement `RcsClient`; `MockRcsClient`
 * lets the pipeline run end to end meanwhile. Select with RCS_SOURCE=<name>.
 */
import type { ExtractedField } from "@fundhub/db/schema";
import type { Settings } from "../config";
import type { Extraction, ProviderRef, Source } from "../types";

export type RcsRecord = {
  rcsNumber: string;
  legalName: string;
  legalForm?: string | null;
  /** e.g. "active", "in liquidation" */
  status?: string | null;
  /** ISO date */
  incorporationDate?: string | null;
  registeredAddress?: string | null;
  directors?: string[];
  sourceUrl?: string | null;
};

export interface RcsClient {
  name: string;
  lookup(provider: ProviderRef): Promise<RcsRecord | null>;
}

/** Echoes what FundHub already knows, flagged as mock. Never invents new facts. */
export class MockRcsClient implements RcsClient {
  readonly name = "mock";
  async lookup(p: ProviderRef): Promise<RcsRecord | null> {
    if (!p.rcsNumber) return null;
    return {
      rcsNumber: p.rcsNumber,
      legalName: p.name,
      legalForm: /\bS\.?A\.?$/.test(p.name) ? "S.A." : null,
      status: "active",
      incorporationDate: p.foundedYear ? `${p.foundedYear}-01-01` : null,
      registeredAddress: p.headquarters,
      directors: [],
      sourceUrl: null,
    };
  }
}

const CLIENTS: Record<string, () => RcsClient> = { mock: () => new MockRcsClient() };

export function makeRcsClient(name: string): RcsClient {
  const make = CLIENTS[name];
  if (!make) throw new Error(`Unknown RCS_SOURCE "${name}". Available: ${Object.keys(CLIENTS).join(", ")}`);
  return make();
}

export class RcsSource implements Source {
  readonly name = "rcs" as const;
  private readonly client: RcsClient;

  constructor(settings: Settings, client?: RcsClient) {
    this.client = client ?? makeRcsClient(settings.rcsSource);
  }

  async fetch(provider: ProviderRef): Promise<Extraction | null> {
    const rec = await this.client.lookup(provider);
    if (!rec) return null;
    // Registry data is authoritative; the mock is not.
    const confidence = this.client.name === "mock" ? 0.3 : 0.95;
    const f = (value: unknown): ExtractedField => ({ value, confidence, sourceUrl: rec.sourceUrl ?? null });
    const fields: Record<string, ExtractedField> = { rcsNumber: f(rec.rcsNumber) };
    if (rec.incorporationDate) fields.foundedYear = f(Number(rec.incorporationDate.slice(0, 4)));
    if (rec.registeredAddress) fields.headquarters = f(rec.registeredAddress);
    return {
      provider,
      sourceUrl: rec.sourceUrl ?? null,
      fields,
      // Legal form, status and directors are shown to staff for context, never written automatically.
      raw: { client: this.client.name, mock: this.client.name === "mock", record: rec },
    };
  }
}
