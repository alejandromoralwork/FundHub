import { ConsoleShell } from "@/components/console-shell";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Every page in this group requires password + two-factor. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return <ConsoleShell staff={{ name: staff.name, email: staff.email, role: staff.role }}>{children}</ConsoleShell>;
}
