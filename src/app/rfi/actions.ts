"use server";

import { z } from "zod";
import { db } from "@/db/index";
import { getProviderById } from "@/db/queries";
import { rfiRequests } from "@/db/schema";
import { AUM_BANDS, FUND_STRUCTURES, RFI_SERVICES } from "./options";

const rfiSchema = z.object({
  providerId: z.coerce.number().int().positive().optional().catch(undefined),
  contactName: z.string().trim().min(2, "Please enter your name").max(120),
  email: z.string().trim().email("Please enter a valid email").max(200),
  company: z.string().trim().min(2, "Please enter your company or fund").max(160),
  fundStructure: z.enum(FUND_STRUCTURES, { message: "Choose a fund structure" }),
  aumBand: z.enum(AUM_BANDS, { message: "Choose an AuM band" }),
  servicesNeeded: z.array(z.enum(RFI_SERVICES)).min(1, "Select at least one service"),
  message: z.string().trim().max(4000).default(""),
});

export type RfiFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Partial<Record<string, string>>; values: Record<string, unknown> }
  | { status: "success"; reference: string; providerName?: string };

export async function createRfi(_prev: RfiFormState, formData: FormData): Promise<RfiFormState> {
  // Honeypot: real users never fill this hidden field.
  if (formData.get("website")) return { status: "success", reference: "RFI-000000" };

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

  const parsed = rfiSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values: raw };
  }

  const provider = parsed.data.providerId ? await getProviderById(parsed.data.providerId) : undefined;

  try {
    const [row] = await db
      .insert(rfiRequests)
      .values({ ...parsed.data, providerId: provider?.id ?? null })
      .returning({ id: rfiRequests.id });

    return {
      status: "success",
      reference: `RFI-${String(row.id).padStart(6, "0")}`,
      providerName: provider?.name,
    };
  } catch (err) {
    console.error("Failed to store RFI", err);
    return {
      status: "error",
      message: "We couldn't submit your request right now. Please try again in a moment.",
      fieldErrors: {},
      values: raw,
    };
  }
}
