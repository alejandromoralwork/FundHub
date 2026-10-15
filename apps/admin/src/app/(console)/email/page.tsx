import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { emailMessages, staffUsers } from "@fundhub/db/schema";
import { EmailView, type EmailRow } from "@/components/comms-views";
import { CAN, requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Email" };

export default async function EmailPage() {
  await requireStaff(CAN.email);
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
    .leftJoin(staffUsers, eq(staffUsers.id, emailMessages.sentBy))
    .orderBy(desc(emailMessages.createdAt))
    .limit(300);
  return <EmailView log={JSON.parse(JSON.stringify(log)) as EmailRow[]} resendConfigured={!!process.env.RESEND_API_KEY} />;
}
