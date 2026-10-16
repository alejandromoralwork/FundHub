import type { Metadata } from "next";
import { ForgotForm } from "@/components/account-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return <ForgotForm />;
}
