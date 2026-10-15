import { Button, Text } from "@react-email/components";
import { button, EmailLayout, h1, p } from "./layout";

/**
 * Every email FundHub sends. Each template declares its subject and props,
 * so staff-composed and transactional emails go through one code path.
 */

function PasswordReset({ name, resetUrl }: { name: string; resetUrl: string }) {
  return (
    <EmailLayout preview="Reset your FundHub password">
      <Text style={h1}>Reset your password</Text>
      <Text style={p}>Hi {name}, we received a request to reset the password of your FundHub account.</Text>
      <Button href={resetUrl} style={button}>
        Choose a new password
      </Button>
      <Text style={{ ...p, marginTop: 16, fontSize: 12 }}>
        The link expires in 1 hour. If you didn&apos;t ask for this, you can ignore this email.
      </Text>
    </EmailLayout>
  );
}

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

/** Free-form message composed by staff in the admin platform. Paragraphs split on blank lines. */
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

export type TemplateName = keyof typeof TEMPLATES;
/** Props of a template (plus `subject` for the free-form message). */
type SubjectArg<F extends (...args: never[]) => string> = Parameters<F> extends [] ? object : Parameters<F>[0];
export type TemplateProps<T extends TemplateName> = Parameters<(typeof TEMPLATES)[T]["component"]>[0] &
  SubjectArg<(typeof TEMPLATES)[T]["subject"]>;
