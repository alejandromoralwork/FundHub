import type { Metadata } from "next";
import QRCode from "qrcode";
import { AccountSecurity } from "@/components/account-forms";
import { newTotpSecret, requireStaff, totpUri } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account security" };

export default async function AccountPage() {
  const staff = await requireStaff();
  // A fresh secret each visit; it's only saved once a code from the new app proves it works.
  const secret = newTotpSecret();
  const qrDataUrl = await QRCode.toDataURL(totpUri(secret, staff.email), { margin: 1, width: 320 });
  return <AccountSecurity email={staff.email} enrol={{ secret, qrDataUrl }} />;
}
