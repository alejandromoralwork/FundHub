import Link from "next/link";
import { TAXONOMY } from "@fundhub/core/taxonomy";
import { CookieSettingsLink } from "./cookie-consent";
import { NewsletterForm } from "./newsletter-form";
import { Wordmark } from "./wordmark";

const COLUMNS = [
  {
    title: "Compare",
    links: [
      { href: "/compare", label: "Provider comparator" },
      { href: "/services", label: "Service categories" },
      { href: "/benchmarks", label: "Fee benchmarks & rankings" },
      { href: "/fundhub-score", label: "FundHub Score" },
    ],
  },
  {
    title: "Services",
    links: [
      { href: "/advisory", label: "Selection & negotiation" },
      { href: "/advisory/fund-setup", label: "Fund set-up advisory" },
      { href: "/data-intelligence", label: "Data Intelligence" },
      { href: "/data-intelligence/membership", label: "Membership" },
      { href: "/news", label: "News" },
      { href: "/learn", label: "Learn" },
      { href: "/awards", label: "FundHub Awards" },
    ],
  },
  {
    title: "FundHub",
    links: [
      { href: "/independence", label: "Independence charter" },
      { href: "/methodology", label: "Methodology & data" },
      { href: "/for-providers", label: "For service providers" },
      { href: "/account/login", label: "Log in / Sign up" },
    ],
  },
];

export function SiteFooter({ newsletter = false }: { newsletter?: boolean }) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="grid gap-8 px-4 py-8 sm:px-6 md:grid-cols-2 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <p>
            <Wordmark className="text-lg" />
            <span className="ml-1 text-xs text-slate-400">FundHub.lu</span>
          </p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-600">
            The independent comparator and buy-side advisor for Luxembourg fund services. We are paid by fund
            managers, never by referral fees or commissions from the providers we compare.
          </p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Categories</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            {TAXONOMY.map((c, i) => (
              <span key={c.slug}>
                {i > 0 && " · "}
                <Link href={`/services/${c.slug}`} className="hover:text-ink hover:underline">
                  {c.label}
                </Link>
              </span>
            ))}
          </p>
          {newsletter && (
            <>
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Newsletter</p>
              <p className="mt-1 mb-2 text-xs text-ink-600">Sector news and the quarterly market snapshot. Unsubscribe anytime.</p>
              <NewsletterForm />
            </>
          )}
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{col.title}</p>
            <ul className="mt-2 space-y-1.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-xs text-ink-600 hover:text-ink hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 px-4 py-4 text-[11px] leading-relaxed text-slate-400 sm:px-6">
        <p className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/legal/notice" className="text-xs text-ink-600 hover:text-ink hover:underline">Legal notice</Link>
          <Link href="/legal/privacy" className="text-xs text-ink-600 hover:text-ink hover:underline">Privacy</Link>
          <Link href="/legal/terms" className="text-xs text-ink-600 hover:text-ink hover:underline">Terms</Link>
          <Link href="/legal/cookies" className="text-xs text-ink-600 hover:text-ink hover:underline">Cookies</Link>
          <Link href="/privacy-request" className="text-xs text-ink-600 hover:text-ink hover:underline">Data request</Link>
          <CookieSettingsLink />
        </p>
        <p>
          © {new Date().getFullYear()} FundHub.lu. Fee ranges are indicative quarterly quotes, not offers. Content is
          general information, not legal, tax or investment advice. Public beta: provider profiles shown are
          illustrative sample data.
        </p>
      </div>
    </footer>
  );
}
