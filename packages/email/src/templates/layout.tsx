/**
 * FILE: packages/email/src/templates/layout.tsx
 * PART: shared package (packages/email)
 * WHAT IT DOES: The common frame of every FundHub email: grey background, a white card, the "FundHub" wordmark at
 *   the top, the email's own content in the middle, and a footer stating FundHub's independence. It also exports
 *   three shared style objects (`p` for paragraphs, `h1` for headings, `button` for buttons) so all emails look
 *   the same.
 * WHERE IT RUNS: on the server, when send.ts renders an email to HTML. It never runs in a browser.
 * FRAMEWORK NOTES:
 *   - A `.tsx` file is TypeScript that may contain JSX: HTML-like tags written inside code, e.g. `<Text>Hi</Text>`.
 *   - A React component is a function that returns JSX. Its inputs are "props" (like HTML attributes).
 *     `children` is the special prop holding whatever is written between the component's opening and closing tags.
 *   - React Email provides components (`Html`, `Body`, `Container`, `Text`, `Link`…) that turn into the old-style
 *     HTML that email programs such as Outlook and Gmail display reliably.
 *   - Email programs ignore most stylesheets, so styles are written "inline" as JavaScript objects in `style={{…}}`:
 *     the outer braces mean "a JavaScript value goes here", the inner ones are the object. Property names use
 *     camelCase (`backgroundColor` for CSS `background-color`), and bare numbers mean pixels.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - destructured, typed props: `({ preview, children }: { preview: string; children: ReactNode })`.
 *   - `ReactNode`: the type of "anything React can display" (text, elements, lists of them…).
 *   - `import type`; `as const` on style objects.
 */

// React Email building blocks (npm library). Each becomes standard email HTML when rendered.
import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
// Type-only import of ReactNode, used to type the `children` prop.
import type { ReactNode } from "react";

/** Kind: constant. The font list: use Inter if available, otherwise the next font in the list that the reader has. */
const font = "Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif";

/**
 * Shared frame: the FundHub wordmark, content, and an independence footer.
 *
 * Kind: React component (a function returning JSX).
 * @param props  destructured into:
 *   - `preview` type `string` — the short teaser line inbox lists show next to the subject.
 *   - `children` type `ReactNode` — the email's own content, written between `<EmailLayout>` and `</EmailLayout>`.
 * @returns JSX: the full email document.
 * Inside JSX, `{expression}` inserts a JavaScript value, e.g. `{preview}` puts the preview text there.
 */
export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  // The structure: <Html> document → <Head> (technical header) → <Preview> (hidden teaser text) → <Body> (grey
  // background) → <Container> (white card, max 560px wide) holding the wordmark, the content <Section>, a
  // horizontal line <Hr> and the footer text. In the wordmark, "Hub" is wrapped in a <span> to colour it green.
  // `{" "}` inserts a plain space that JSX would otherwise drop at the end of a line.
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f7f8fa", fontFamily: font, margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", border: "1px solid #e2e6ec", borderRadius: 8, maxWidth: 560, padding: 32 }}>
          {/* The "FundHub" wordmark. */}
          <Text style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, margin: "0 0 24px", color: "#1e2632" }}>
            Fund<span style={{ color: "#0f9d78" }}>Hub</span>
          </Text>
          {/* The email's own content, passed in as children. */}
          <Section>{children}</Section>
          <Hr style={{ borderColor: "#e2e6ec", margin: "32px 0 16px" }} />
          {/* Footer: FundHub's independence statement and a link to the website. */}
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

// SHARED STYLES. Templates use them as `<Text style={p}>`. `as const` makes them read-only and keeps the exact
// values as types, which keeps React's style type checking happy (e.g. a specific value rather than any string).

/** Kind: constant (style object). Normal paragraph text: dark grey, 14px, with space below. */
export const p = { color: "#3b4658", fontSize: 14, lineHeight: "22px", margin: "0 0 14px" } as const;
/** Kind: constant (style object). Email heading: darker, 18px, semi-bold. */
export const h1 = { color: "#1e2632", fontSize: 18, fontWeight: 600, margin: "0 0 16px" } as const;
/** Kind: constant (style object). The green call-to-action button (a link styled to look like a button). */
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
