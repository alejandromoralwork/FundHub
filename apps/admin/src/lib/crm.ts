import "server-only";

/**
 * Twenty CRM (open source, self-hosted) REST client. Records live under /rest/<object>,
 * authenticated with a workspace API key (Settings → Developers → API).
 * Only documented basics are sent; amounts and stages are set in Twenty.
 */
export function crmConfigured(): boolean {
  return !!process.env.TWENTY_URL && !!process.env.TWENTY_API_KEY;
}

export function crmUrl(): string | null {
  return process.env.TWENTY_URL ? process.env.TWENTY_URL.replace(/\/$/, "") : null;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${crmUrl()}/rest/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TWENTY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`CRM ${path}: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json as T;
}

/** Twenty wraps created records as { data: { create<Object>: { id } } }; read the id defensively. */
function idOf(res: Record<string, unknown>): string | undefined {
  const data = res.data as Record<string, { id?: string }> | undefined;
  return data ? Object.values(data).find((v) => v && typeof v === "object" && "id" in v)?.id : undefined;
}

export async function createLead(input: { name: string; email: string; company: string; title: string }): Promise<{ personId?: string; opportunityId?: string }> {
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  const person = await call<Record<string, unknown>>("people", {
    name: { firstName: firstName ?? input.name, lastName: rest.join(" ") },
    emails: { primaryEmail: input.email },
  });
  const personId = idOf(person);
  const opportunity = await call<Record<string, unknown>>("opportunities", {
    name: input.title,
    ...(personId ? { pointOfContactId: personId } : {}),
  });
  return { personId, opportunityId: idOf(opportunity) };
}
