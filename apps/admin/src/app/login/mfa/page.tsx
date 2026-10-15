import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { MfaForm } from "@/components/login-forms";
import { getSession, newTotpSecret, totpUri } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mfaPassed) redirect("/");
  if (s.staff.totpEnabled) return <MfaForm />;

  // First login: enrol. The secret is only saved once a valid code proves the app is set up.
  const secret = newTotpSecret();
  const qrDataUrl = await QRCode.toDataURL(totpUri(secret, s.staff.email), { margin: 1, width: 360 });
  return <MfaForm enrol={{ secret, qrDataUrl }} />;
}
