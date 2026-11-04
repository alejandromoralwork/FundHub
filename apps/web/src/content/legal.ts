/**
 * FILE: apps/web/src/content/legal.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Holds the text of the website's four legal pages: legal notice, privacy policy, cookie policy and
 *   terms of use. A single page component reads this data and lays it out, so the wording can be changed here
 *   without touching any page design. Company details (address, VAT number, …) are filled in from COMPANY.
 * WHERE IT RUNS: on the server, where the legal pages are built (it is plain data, so it could run anywhere).
 * FRAMEWORK NOTES: files in src/content/ keep fixed website content as TypeScript data instead of in the database.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional fields (`heading?: string` = may be left out).
 *   - `Record<string, LegalPage>` = an object whose keys are texts (page names) and whose values are LegalPages.
 *   - template strings `` `VAT number: ${c.vatNumber}` `` = text with a value inserted.
 */

// `import { a } from "b"` loads a named thing from module b. `@fundhub/...` = our own shared packages.
// COMPANY = FundHub's official company details, defined once and reused across the site and emails.
import { COMPANY } from "@fundhub/core/company";

/**
 * Legal texts. Drafted as a starting point for FundHub's processing activities;
 * have them reviewed by a Luxembourg lawyer before launch.
 *
 * Kind: type alias. One section of a legal page: an optional heading, then optional paragraphs and/or bullet points.
 */
export type LegalSection = { heading?: string; paragraphs?: string[]; bullets?: string[] };
/** Kind: type alias. One legal page: its title, a short description (used for search engines), and its sections. */
export type LegalPage = { title: string; description: string; sections: LegalSection[] };

/** Kind: constant. A short alias for COMPANY, to keep the long template strings below readable. */
const c = COMPANY;

/**
 * Kind: constant (lookup table of pages). The keys (`notice`, `privacy`, `cookies`, `terms`) identify the pages;
 * each value follows the LegalPage shape above. Within the texts, `${c.something}` inserts a company detail.
 */
export const LEGAL: Record<string, LegalPage> = {
  // Legal notice: who publishes and hosts the site (required for Luxembourg websites).
  notice: {
    title: "Legal notice",
    description: "Publisher and hosting information for fundhub.lu.",
    sections: [
      {
        heading: "Publisher",
        bullets: [
          `${c.legalName} (${c.legalForm}), trading as ${c.brand}`,
          `Registered office: ${c.address}`,
          `Luxembourg Business Registers (RCS): ${c.rcsNumber}`,
          `VAT number: ${c.vatNumber}`,
          `Business permit: ${c.businessPermit}`,
          `Contact: ${c.contactEmail}`,
          `Director of publication: ${c.director}`,
        ],
      },
      { heading: "Hosting", paragraphs: [c.hostingProvider] },
      {
        heading: "Nature of the service",
        paragraphs: [
          `${c.brand} is an independent comparator and advisory service for fund service providers in Luxembourg. Information on this website is general information, not legal, tax or investment advice. Fee ranges are indicative and are not offers. ${c.brand} receives no referral fees or commissions from the service providers it lists.`,
        ],
      },
    ],
  },

  // Privacy policy (GDPR): who is responsible, what is collected and why, who receives it, how long it is kept.
  privacy: {
    title: "Privacy policy",
    description: "How FundHub collects, uses and protects personal data (GDPR).",
    sections: [
      {
        heading: "Who is responsible",
        paragraphs: [
          `The controller of your personal data is ${c.legalName}, ${c.address} (“${c.brand}”). For any privacy question or to exercise your rights, contact ${c.privacyEmail} or use our data request form.`,
        ],
      },
      {
        heading: "What we collect and why",
        bullets: [
          "Account data (name, email, company, password hash, account type): to provide your account. Legal basis: contract (Art. 6(1)(b) GDPR).",
          "Requests you send (quotes, advisory, data services, award nominations): to answer them and, for quote requests, to forward them to the providers you choose. Legal basis: contract / steps at your request.",
          "Client reviews (name, work email, company, role, evidence): to verify that you are a genuine client. Only your role, relationship and fund type are published. Legal basis: legitimate interest in trustworthy reviews (Art. 6(1)(f)).",
          "Provider profile edits and company claims: to verify that you represent the company and to keep an audit log. Legal basis: contract and legitimate interest.",
          "Newsletter: your email, only with your consent, which you can withdraw at any time. Legal basis: consent (Art. 6(1)(a)).",
          "Security and technical data (session cookie, IP address for rate limiting, server logs): to keep the service secure. Legal basis: legitimate interest.",
          "Billing data for customers (company name, billing email, VAT number, invoices): to invoice and meet accounting obligations. Legal basis: contract and legal obligation (Art. 6(1)(c)).",
        ],
      },
      {
        heading: "Who receives your data",
        paragraphs: [
          "We do not sell personal data and we do not share it with service providers unless you ask us to (for example, a quote request to a named provider). We use processors bound by data processing agreements: website hosting (Vercel), database hosting (Neon), email delivery (Resend), payments and invoicing (Stripe), AI processing of public provider information (Anthropic), and our internal tools for CRM, newsletter and file storage.",
          "Some of these processors are located in the United States. Transfers are covered by the EU-US Data Privacy Framework where the processor is certified, or by the European Commission's standard contractual clauses.",
        ],
      },
      {
        heading: "How long we keep data",
        bullets: [
          "Accounts: while the account is active, then deleted within 30 days of a deletion request.",
          "Requests and correspondence: up to 3 years after the last contact.",
          "Billing records: 10 years, as required by Luxembourg accounting law.",
          "Security logs: up to 12 months.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You can request access to your data, correction, deletion, restriction, portability, and object to processing based on legitimate interest. Where processing is based on consent, you can withdraw it at any time. We answer within one month. You can also lodge a complaint with the Commission nationale pour la protection des données (CNPD), cnpd.public.lu.",
        ],
      },
      {
        heading: "Cookies",
        paragraphs: ["See our cookie policy. We only use cookies needed to run the site unless you agree to analytics cookies."],
      },
      { paragraphs: [`Last updated: ${c.lastUpdated}.`] },
    ],
  },

  // Cookie policy. "fh_session" is the login cookie set in src/lib/auth/session.ts (30 days there too).
  cookies: {
    title: "Cookie policy",
    description: "Which cookies fundhub.lu uses.",
    sections: [
      {
        heading: "Strictly necessary cookies (always on)",
        bullets: [
          "fh_session: keeps you logged in to your FundHub account (30 days, only if you log in).",
          "fh_consent: remembers your cookie choice (12 months).",
        ],
      },
      {
        heading: "Analytics cookies (only with your consent)",
        paragraphs: [
          "If you accept analytics, we measure anonymous usage (pages viewed, referrers) to improve the website. You can change your choice at any time with the “Cookie settings” link at the bottom of every page.",
        ],
      },
      { paragraphs: [`Last updated: ${c.lastUpdated}.`] },
    ],
  },

  // Terms of use: rules for accounts, reviews, independence, liability and governing law.
  terms: {
    title: "Terms of use",
    description: "Rules for using fundhub.lu and FundHub accounts.",
    sections: [
      {
        heading: "The service",
        paragraphs: [
          `${c.brand} provides an independent directory and comparator of fund service providers in Luxembourg, market information, and paid advisory services. Information is provided for general information only and does not constitute legal, tax, investment or professional advice. Fee ranges are indicative and not offers from providers.`,
        ],
      },
      {
        heading: "Accounts",
        bullets: [
          "You must give accurate information and keep your password confidential.",
          "Provider accounts may only manage the profile of a company they are authorised to represent. We verify claims and may refuse or withdraw access.",
          "Providers are responsible for the accuracy of the information they publish. Fee ranges, peer scores, reviews and the Verified badge remain under FundHub's independent control.",
        ],
      },
      {
        heading: "Reviews",
        bullets: [
          "Reviews must reflect a genuine client relationship within the last three years and must not be written by a provider's staff or competitors, or in exchange for payment or benefit.",
          "We verify reviews before publishing and may refuse or remove reviews that breach these rules.",
        ],
      },
      {
        heading: "Independence",
        paragraphs: [`${c.brand} accepts no referral fees, commissions or other benefits from service providers in connection with the providers it lists or recommends.`],
      },
      {
        heading: "Liability",
        paragraphs: [
          `${c.brand} takes care to keep information accurate but does not guarantee that it is complete or up to date. To the extent permitted by law, ${c.brand} is not liable for decisions taken on the basis of information on this website. Paid advisory services are governed by their own engagement letters.`,
        ],
      },
      { heading: "Governing law", paragraphs: ["These terms are governed by Luxembourg law. The courts of Luxembourg City have jurisdiction."] },
      { paragraphs: [`Last updated: ${c.lastUpdated}.`] },
    ],
  },
};
