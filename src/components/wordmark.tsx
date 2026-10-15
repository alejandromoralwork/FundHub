import { cn } from "@/lib/cn";

/** The FundHub logo is the name itself: no symbol. "Hub" carries the accent. */
export function Wordmark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span className={cn("font-bold tracking-tight", tone === "light" ? "text-white" : "text-ink", className)}>
      Fund<span className="text-emerald">Hub</span>
    </span>
  );
}
