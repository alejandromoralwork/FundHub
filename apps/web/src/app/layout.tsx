import type { Metadata, Viewport } from "next";
// Self-hosted fonts: bundled from npm, so builds never depend on reaching Google Fonts.
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { AdvisorWidget } from "@/components/advisor-widget";
import { CookieConsent } from "@/components/cookie-consent";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "FundHub · Independent Fund Services Comparator & Advisor in Luxembourg",
    template: "%s · FundHub",
  },
  description:
    "Independent fund service provider comparator and set-up & fee negotiation advisory for Luxembourg. Compare administrators, depositaries, ManCos, tax and legal providers on real fees, tech and peer reviews. No referral fees, no commissions.",
  openGraph: { type: "website", siteName: "FundHub", locale: "en_GB" },
  metadataBase: process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : undefined,
};

export const viewport: Viewport = {
  themeColor: "#1a212b",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body className="font-sans">
        <AppShell account={user && { name: user.name, accountType: user.accountType }} newsletter={!!process.env.LISTMONK_URL && !!process.env.LISTMONK_LIST_UUID}>{children}</AppShell>
        <AdvisorWidget />
        <CookieConsent />
      </body>
    </html>
  );
}
