import { BadgeCheck, Clock, ShieldCheck } from "lucide-react";
import type { ProviderType } from "@/db/schema";
import { cn } from "@/lib/cn";

export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald/30">
      <BadgeCheck className="h-3 w-3" /> FundHub Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
      <Clock className="h-3 w-3" /> Pending review
    </span>
  );
}

const TYPE_STYLES: Record<ProviderType, string> = {
  Boutique: "bg-sky-50 text-sky-700 border-sky-200",
  "Mid-Market": "bg-indigo-50 text-indigo-700 border-indigo-200",
  Institutional: "bg-ink-50 text-ink-700 border-slate-300",
};

export function TypeBadge({ type }: { type: ProviderType }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", TYPE_STYLES[type])}>{type}</span>
  );
}

export function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-[11px] font-medium ring-1",
        accent ? "bg-emerald-50 text-emerald-700 ring-emerald/30" : "bg-slate-50 text-ink-600 ring-slate-200",
      )}
    >
      {children}
    </span>
  );
}

/** Small pill stating FundHub's independence; used across marketing sections. */
export function IndependentBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald/30",
        className,
      )}
    >
      <ShieldCheck className="h-3 w-3" /> Independent · No referral fees
    </span>
  );
}
