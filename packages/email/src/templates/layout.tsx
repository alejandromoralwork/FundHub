import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

const font = "Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";

/** Shared frame: the FundHub wordmark, content, and an independence footer. */
export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f7f8fa", fontFamily: font, margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", border: "1px solid #e2e6ec", borderRadius: 8, maxWidth: 560, padding: 32 }}>
          <Text style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, margin: "0 0 24px", color: "#1e2632" }}>
            Fund<span style={{ color: "#0f9d78" }}>Hub</span>
          </Text>
          <Section>{children}</Section>
          <Hr style={{ borderColor: "#e2e6ec", margin: "32px 0 16px" }} />
          <Text style={{ color: "#8a94a3", fontSize: 11, lineHeight: "16px", margin: 0 }}>
            FundHub.lu · the independent fund services comparator in Luxembourg. We accept no referral fees or commissions
            from service providers.{" "}
            <Link href="https://fundhub.lu" style={{ color: "#0c8265" }}>
              fundhub.lu
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const p = { color: "#3b4658", fontSize: 14, lineHeight: "22px", margin: "0 0 14px" } as const;
export const h1 = { color: "#1e2632", fontSize: 18, fontWeight: 600, margin: "0 0 16px" } as const;
export const button = {
  backgroundColor: "#0f9d78",
  borderRadius: 6,
  color: "#ffffff",
  display: "inline-block",
  fontSize: 14,
  fontWeight: 600,
  padding: "10px 18px",
  textDecoration: "none",
} as const;
