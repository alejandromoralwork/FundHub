"use server";

import { z } from "zod";
import { db } from "@fundhub/db/client";
import { rateLimit } from "@fundhub/db/rate-limit";
import { clientIp } from "./client-ip";
import { getProviderById } from "@fundhub/db/queries";
import { REQUEST_TYPES, rfiRequests, type NewRfiRequest, type RequestType } from "@fundhub/db/schema";
import { AUM_BANDS, FUND_STRUCTURES, NO_FUND_FIELDS, SERVICE_GROUPS } from "@fundhub/core/request-options";

const REFERENCE_PREFIX: Record<RequestType, string> = { rfi: "RFI", advisory: "ADV", data: "DAT", awards: "AWD", claim: "PRO" };

const baseSchema = z.object({
  providerId: z.coerce.number().int().positive().optional().catch(undefined),
  contactName: z.string().trim().min(2, "Please enter your name").max(120),
  email: z.string().trim().email("Please enter a valid email").max(200),
  company: z.string().trim().min(2, "Please enter your company").max(160),
  message: z.string().trim().max(4000).default(""),
});

/** Buyer-side requests describe the fund; provider claims don't. */
const fundSchema = z.object({
  fundStructure: z.enum(FUND_STRUCTURES, { message: "Choose a fund structure" }),
  aumBand: z.enum(AUM_BANDS, { message: "Choose an AuM band" }),
});

function servicesSchema(type: RequestType) {
  const allowed = SERVICE_GROUPS[type].flatMap((g) => g.options);
  return z
    .array(z.string().refine((s) => allowed.includes(s)))
    .min(1, type === "rfi" || type === "advisory" ? "Select at least one service" : "Select at least one option");
}

export type RequestFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Partial<Record<string, string>>; values: Record<string, unknown> }
  | { status: "success"; reference: string; providerName?: string };

export async function submitRequest(_prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const type = z.enum(REQUEST_TYPES).catch("rfi").parse(formData.get("requestType"));

  // Honeypot: real users never fill this hidden field.
  if (formData.get("website")) return { status: "success", reference: `${REFERENCE_PREFIX[type]}-000000` };
  if (!(await rateLimit(`request:${await clientIp()}`, 10, 60 * 60))) {
    return { status: "error", message: "Too many requests. Please try again later.", fieldErrors: {}, values: {} };
  }

  const raw = {
    providerId: formData.get("providerId") || undefined,
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    company: formData.get("company"),
    fundStructure: formData.get("fundStructure"),
    aumBand: formData.get("aumBand"),
    servicesNeeded: formData.getAll("servicesNeeded"),
    message: formData.get("message") ?? "",
  };

  const noFund = NO_FUND_FIELDS.includes(type);
  const schema = noFund
      ? baseSchema.extend({ servicesNeeded: servicesSchema(type) })
      : baseSchema.merge(fundSchema).extend({ servicesNeeded: servicesSchema(type) });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values: raw };
  }

  const data = parsed.data;
  // Already validated above for buyer-side requests; re-parse for a precise type.
  const fund = noFund ? undefined : fundSchema.parse(raw);
  const provider = data.providerId ? await getProviderById(data.providerId) : undefined;

  const values: NewRfiRequest = {
    requestType: type,
    providerId: provider?.id ?? null,
    contactName: data.contactName,
    email: data.email,
    company: data.company,
    fundStructure: fund?.fundStructure ?? "",
    aumBand: fund?.aumBand ?? "",
    servicesNeeded: data.servicesNeeded,
    message: data.message,
  };

  try {
    const [row] = await db.insert(rfiRequests).values(values).returning({ id: rfiRequests.id });

    return {
      status: "success",
      reference: `${REFERENCE_PREFIX[type]}-${String(row.id).padStart(6, "0")}`,
      providerName: provider?.name,
    };
  } catch (err) {
    console.error("Failed to store request", err);
    return {
      status: "error",
      message: "We couldn't submit your request right now. Please try again in a moment.",
      fieldErrors: {},
      values: raw,
    };
  }
}
