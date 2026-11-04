/**
 * FILE: packages/email/src/templates/index.tsx
 * PART: shared package (packages/email)
 * WHAT IT DOES: Contains every email FundHub can send, each as a small React component (password reset, claim
 *   approved/rejected, review verification/published, invoice reminder, and a free-form staff message), and the
 *   TEMPLATES catalogue that pairs each template name with its component and its subject line. send.ts looks
 *   templates up in that catalogue by name.
 * WHERE IT RUNS: on the server, when send.ts renders an email to HTML.
 * FRAMEWORK NOTES:
 *   - Each template is a React component: a function that receives "props" (its data) and returns JSX, the
 *     HTML-like markup of the email. Inside JSX, `{name}` inserts a value into the text.
 *   - `&apos;` is the HTML way of writing an apostrophe ('); React's checker asks for it inside JSX text.
 *   - A file called `index.tsx` is what you get when you import the folder itself (`from "./templates"`).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - typed destructured props `({ name, resetUrl }: { name: string; resetUrl: string })`; optional props `name?`.
 *   - spread in objects `{ ...p, marginTop: 16 }`: copy all of p's properties, then add/override some.
 *   - `&&` in JSX (`{cond && <X />}` shows X only when cond is true); `.map` in JSX with a `key`.
 *   - advanced types at the end: `keyof typeof`, generics with `extends`, `Parameters<F>`, conditional types
 *     `A extends B ? X : Y`, indexed access `T["field"]` and intersection types `A & B`.
 */

// `import { a, b } from "x"` brings named exports into this file.
// Button (a link that looks like a button) and Text (a paragraph) from React Email, a library from npm.
import { Button, Text } from "@react-email/components";
// The shared frame and the shared styles from layout.tsx in this same folder (`./`).
import { button, EmailLayout, h1, p } from "./layout";

/**
 * Every email FundHub sends. Each template declares its subject and props,
 * so staff-composed and transactional emails go through one code path.
 */

/**
 * Kind: React component (file-private). Email with a link to choose a new password.
 * Props (destructured from one object; the type after `:` lists each prop and its type):
 * - `name` type `string` — the recipient's first name, for the greeting.
 * - `resetUrl` type `string` — the secret one-time link to the reset page (expires after one hour).
 * @returns JSX: the email, wrapped in the shared EmailLayout frame.
 * All the templates below follow this same pattern: a heading (`style={h1}`), paragraphs (`style={p}`) and
 * usually a button linking to the next step.
 */
function PasswordReset({ name, resetUrl }: { name: string; resetUrl: string }) {
  return (
    <EmailLayout preview="Reset your FundHub password">
      <Text style={h1}>Reset your password</Text>
      <Text style={p}>Hi {name}, we received a request to reset the password of your FundHub account.</Text>
      <Button href={resetUrl} style={button}>
        Choose a new password
      </Button>
      {/* Small print: the paragraph style `p`, copied with spread `...p`, plus extra top space and smaller text. */}
      <Text style={{ ...p, marginTop: 16, fontSize: 12 }}>
        The link expires in 1 hour. If you didn&apos;t ask for this, you can ignore this email.
      </Text>
    </EmailLayout>
  );
}

/**
 * Kind: React component. Tells a person their claim to manage a provider profile was approved.
 * Props: `name` (string), `companyName` (string, the provider) and `editUrl` (string, link to edit the profile).
 * `preview={`...${companyName}...`}` passes a template string as the prop: a text with the company name inserted.
 */
function ClaimApproved({ name, companyName, editUrl }: { name: string; companyName: string; editUrl: string }) {
  return (
    <EmailLayout preview={`You can now manage ${companyName} on FundHub`}>
      <Text style={h1}>Your claim is approved</Text>
      <Text style={p}>
        Hi {name}, we&apos;ve confirmed that you represent {companyName}. You can now keep its services, team, tech
        stack and clients up to date, and download the private Data Intelligence reports.
      </Text>
      <Button href={editUrl} style={button}>
        Edit your company profile
      </Button>
    </EmailLayout>
  );
}

/**
 * Kind: React component. Tells a person their profile claim could not be confirmed, and how to try again.
 * Props: `name` (string) and `companyName` (string). No button: the next step is to reply to the email.
 */
function ClaimRejected({ name, companyName }: { name: string; companyName: string }) {
  return (
    <EmailLayout preview={`About your claim for ${companyName}`}>
      <Text style={h1}>We couldn&apos;t confirm your claim</Text>
      <Text style={p}>
        Hi {name}, we weren&apos;t able to confirm that you represent {companyName}. Reply to this email with a link to
        your profile on the company website or a message from a company email address, and we&apos;ll take another look.
      </Text>
    </EmailLayout>
  );
}

/**
 * Kind: React component. Asks a reviewer to confirm they really are (or were) a client of the provider, so that
 * only genuine reviews are published. Props: `name` (string) and `providerName` (string).
 * `{" "}` at a line end inserts a space that JSX would otherwise drop when the text continues on the next line.
 */
function ReviewVerification({ name, providerName }: { name: string; providerName: string }) {
  return (
    <EmailLayout preview={`Please confirm your review of ${providerName}`}>
      <Text style={h1}>Confirm your review</Text>
      <Text style={p}>
        Hi {name}, thank you for reviewing {providerName} on FundHub. To keep reviews trustworthy we verify every
        reviewer. Please reply to this email confirming that you are (or were in the last three years) a client of{" "}
        {providerName}, and add any detail that helps us confirm it, such as the fund name or contract year.
      </Text>
      <Text style={p}>Your name, email and company are never published.</Text>
    </EmailLayout>
  );
}

/**
 * Kind: React component. Tells a reviewer their review is live. Props: `name`, `providerName` and
 * `profileUrl` (all strings; the last is the link to the provider's public profile).
 */
function ReviewPublished({ name, providerName, profileUrl }: { name: string; providerName: string; profileUrl: string }) {
  return (
    <EmailLayout preview={`Your review of ${providerName} is live`}>
      <Text style={h1}>Your review is published</Text>
      <Text style={p}>
        Hi {name}, we&apos;ve verified and published your review of {providerName}. It now counts towards its Peer
        Opinion Score. Thank you for helping other managers choose on evidence.
      </Text>
      <Button href={profileUrl} style={button}>
        View the profile
      </Button>
    </EmailLayout>
  );
}

/**
 * Kind: React component. Payment reminder for a FundHub invoice. Props (all strings, already formatted for
 * display): `name`, `invoiceNumber`, `amount` (e.g. "€1,200"), `dueDate` and `payUrl` (link to view and pay).
 */
function InvoiceReminder({ name, invoiceNumber, amount, dueDate, payUrl }: { name: string; invoiceNumber: string; amount: string; dueDate: string; payUrl: string }) {
  return (
    <EmailLayout preview={`Reminder: invoice ${invoiceNumber}`}>
      <Text style={h1}>Invoice {invoiceNumber}</Text>
      <Text style={p}>
        Hi {name}, this is a friendly reminder that invoice {invoiceNumber} for {amount} is due on {dueDate}.
      </Text>
      <Button href={payUrl} style={button}>
        View and pay the invoice
      </Button>
    </EmailLayout>
  );
}

/**
 * Free-form message composed by staff in the admin platform. Paragraphs split on blank lines.
 *
 * Kind: React component.
 * Props: `name?` (optional string: the greeting is skipped without it), `body` (string, the text staff typed),
 * `ctaLabel?` and `ctaUrl?` (optional strings: the text and link of a "call to action" button).
 * - `preview={body.slice(0, 90)}`: the first 90 characters of the message become the inbox teaser.
 * - `{name && <Text ...>}`: `&&` shows the greeting only when `name` has a value; otherwise nothing is shown.
 * - `body.split(/\n\s*\n/)` cuts the text at blank lines (a line break, optional spaces, another line break)
 *   into a list of paragraphs; `.map((para, i) => ...)` turns each into a <Text>. `i` is its position (0, 1, 2...).
 *   React needs a unique `key` on items produced from a list to keep track of them; the position is used here.
 * - The button appears only when both `ctaLabel` and `ctaUrl` are given (`a && b && <Button ...>`).
 */
function Message({ name, body, ctaLabel, ctaUrl }: { name?: string; body: string; ctaLabel?: string; ctaUrl?: string }) {
  return (
    <EmailLayout preview={body.slice(0, 90)}>
      {name && <Text style={p}>Hi {name},</Text>}
      {body.split(/\n\s*\n/).map((para, i) => (
        <Text key={i} style={p}>
          {para}
        </Text>
      ))}
      {ctaLabel && ctaUrl && (
        <Button href={ctaUrl} style={button}>
          {ctaLabel}
        </Button>
      )}
    </EmailLayout>
  );
}

/**
 * Kind: constant (read-only object). The catalogue of all templates, by name. Each entry has:
 * - `component`: the React component above that draws the email.
 * - `subject`: a function that builds the subject line. It takes the props it needs, typed inline, e.g.
 *   `(props: { companyName: string }) => ...`; `() => "..."` takes nothing and always returns the same text.
 * Names with a dash must be in quotes ("password-reset"); `message` is a plain identifier so needs none.
 * `as const` keeps each entry's exact types, so TemplateName and TemplateProps below can be derived from it.
 * The free-form `message` has its subject typed by staff, so its subject function needs a `subject` prop.
 */
export const TEMPLATES = {
  "password-reset": { component: PasswordReset, subject: () => "Reset your FundHub password" },
  "claim-approved": {
    component: ClaimApproved,
    subject: (props: { companyName: string }) => `You can now manage ${props.companyName} on FundHub`,
  },
  "claim-rejected": {
    component: ClaimRejected,
    subject: (props: { companyName: string }) => `About your claim for ${props.companyName}`,
  },
  "review-verification": {
    component: ReviewVerification,
    subject: (props: { providerName: string }) => `Please confirm your review of ${props.providerName}`,
  },
  "review-published": {
    component: ReviewPublished,
    subject: (props: { providerName: string }) => `Your review of ${props.providerName} is live`,
  },
  "invoice-reminder": {
    component: InvoiceReminder,
    subject: (props: { invoiceNumber: string }) => `Reminder: FundHub invoice ${props.invoiceNumber}`,
  },
  message: { component: Message, subject: (props: { subject: string }) => props.subject },
} as const;

/**
 * Kind: type alias. Any template name: "password-reset" | "claim-approved" | ... | "message".
 * `typeof TEMPLATES` is the type of the catalogue; `keyof` gives the union of its keys.
 */
export type TemplateName = keyof typeof TEMPLATES;
/** Props of a template (plus `subject` for the free-form message). */
// HOW THESE TWO TYPES WORK (advanced; types are calculated by TypeScript while it checks the code):
// SubjectArg<F>: F is any function returning a string. `Parameters<F>` is the list of F's parameter types.
//   `A extends B ? X : Y` is a conditional type ("if A fits B then X else Y"). So: if F takes no parameters
//   (`[]`), the result is `object` (no extra props needed); otherwise it is the type of F's first parameter.
// TemplateProps<T>: for template T, take the props of its component (`Parameters<component>[0]`, the first
//   parameter), and `&` (intersection = "has all fields of both") the props its subject function needs.
//   Example: TemplateProps<"message"> = { name?, body, ctaLabel?, ctaUrl? } & { subject: string }.
type SubjectArg<F extends (...args: never[]) => string> = Parameters<F> extends [] ? object : Parameters<F>[0];
export type TemplateProps<T extends TemplateName> = Parameters<(typeof TEMPLATES)[T]["component"]>[0] &
  SubjectArg<(typeof TEMPLATES)[T]["subject"]>;
