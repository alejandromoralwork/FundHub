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
    default: "FundHub Lux — Luxembourg Fund Services Directory & Price Comparator",
    template: "%s · FundHub Lux",
  },
  description:
    "Institutional-grade B2B directory and empirical price comparator for the Luxembourg fund services market. Compare providers by tech stack, scale, and audited fee ranges.",
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
