/**
 * FILE: apps/admin/src/app/(console)/email/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Email" page. It shows a log of the latest 300 emails sent from the Console (to whom,
 *   subject, template, delivery status, any error, and which staff member sent it), and tells the screen
 *   whether sending is possible at all (i.e. whether a Resend API key is set).
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database and server settings;
 *   EmailView runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/email = the URL /admin/email ("(console)" is a route group).
 * TYPESCRIPT YOU WILL SEE HERE: multi-line object literals, `!!x` (to true/false), `as` assertions,
 *   `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `desc` = sort descending, `eq` = "equals".
import { desc, eq } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and tables.
import { db } from "@fundhub/db/client";
import { emailMessages, staffUsers } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The email screen and the type of one log row.
import { EmailView, type EmailRow } from "@/components/comms-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Email" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the email screen markup.
 */
export default async function EmailPage() {
  // Only roles in CAN.email (owner, operations, sales).
  await requireStaff(CAN.email);
  // Fetch the email log: chosen columns, plus the sender's name from the staff table.
  const log = await db
    .select({
      id: emailMessages.id,
      toEmail: emailMessages.toEmail,
      toName: emailMessages.toName,
      subject: emailMessages.subject,
      template: emailMessages.template,
      status: emailMessages.status,
      error: emailMessages.error,
      sentByName: staffUsers.name,
      createdAt: emailMessages.createdAt,
    })
    .from(emailMessages)
    // leftJoin: automatic emails have no staff sender, and we still want them listed.
    .leftJoin(staffUsers, eq(staffUsers.id, emailMessages.sentBy))
    // Newest first, at most 300.
    .orderBy(desc(emailMessages.createdAt))
    .limit(300);
  // JSON round-trip for the browser (Dates -> strings). `!!process.env.RESEND_API_KEY` = true if the key
  // for Resend (our email-sending service) is set; only that yes/no is sent, never the key.
  return <EmailView log={JSON.parse(JSON.stringify(log)) as EmailRow[]} resendConfigured={!!process.env.RESEND_API_KEY} />;
}
