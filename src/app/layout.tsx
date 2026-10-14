import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { AdvisorWidget } from "@/components/advisor-widget";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FundHub Lux · Independent Fund Services Comparator & Advisor in Luxembourg",
    template: "%s · FundHub Lux",
  },
  description:
    "Independent comparator and buy-side advisor for Luxembourg fund services. Compare administrators, depositaries, ManCos, tax and legal providers on real fees, tech and peer reviews. No referral fees, no commissions.",
  openGraph: { type: "website", siteName: "FundHub Lux", locale: "en_GB" },
  metadataBase: process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? new URL(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    : undefined,
};

export const viewport: Viewport = {
  themeColor: "#1a212b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="font-sans">
        <AppShell>{children}</AppShell>
        <AdvisorWidget />
      </body>
    </html>
  );
}
