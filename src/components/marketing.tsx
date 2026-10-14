import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/** Building blocks for the editorial pages (landing, advisory, independence…). */

export function SectionTitle({
  eyebrow,
  title,
  lead,
  className,
  as: Heading = "h2",
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">{eyebrow}</p>}
      <Heading className={cn("mt-1 font-semibold text-ink", Heading === "h1" ? "text-2xl sm:text-3xl" : "text-xl")}>
        {title}
      </Heading>
      {lead && <p className="mt-2 text-sm leading-relaxed text-ink-600">{lead}</p>}
    </div>
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-slate-200 bg-white p-5", className)}>{children}</div>;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "dark" | "outline" | "ghost";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors",
        variant === "primary" && "bg-emerald text-white hover:bg-emerald-700",
        variant === "dark" && "bg-ink-900 text-white hover:bg-ink-800",
        variant === "outline" && "border border-slate-300 bg-white text-ink hover:bg-slate-50",
        variant === "ghost" && "border border-white/20 text-white hover:bg-white/10",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function CtaBand({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="rounded-xl bg-ink-900 px-6 py-8 text-white sm:px-10">
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href={primary.href}>
            {primary.label} <ArrowRight className="h-4 w-4" />
          </ButtonLink>
          {secondary && (
            <ButtonLink href={secondary.href} variant="ghost">
              {secondary.label}
            </ButtonLink>
          )}
        </div>
      </div>
    </section>
  );
}

export function CheckList({ items, tone = "positive" }: { items: readonly string[]; tone?: "positive" | "negative" }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
          <span
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              tone === "positive" ? "bg-emerald" : "bg-red-400",
            )}
          />
          {i}
        </li>
      ))}
    </ul>
  );
}
