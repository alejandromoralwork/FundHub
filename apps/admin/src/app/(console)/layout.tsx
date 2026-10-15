import { ConsoleShell, type ShellTool } from "@/components/console-shell";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Every page in this group requires password + two-factor. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const base = (v?: string) => v?.replace(/\/$/, "");
  const nc = base(process.env.NEXTCLOUD_URL);
  const tools: ShellTool[] = [
    nc && { label: "Drive (Nextcloud)", href: `${nc}/apps/files/` },
    nc && { label: "Calendar", href: `${nc}/apps/calendar/` },
    nc && { label: "Team tasks (Deck)", href: `${nc}/apps/deck/` },
    base(process.env.TWENTY_URL) && { label: "CRM (Twenty)", href: base(process.env.TWENTY_URL)! },
    base(process.env.LISTMONK_URL) && { label: "Newsletter (Listmonk)", href: `${base(process.env.LISTMONK_URL)}/admin/` },
    base(process.env.POSTIZ_URL) && { label: "Social scheduler (Postiz)", href: base(process.env.POSTIZ_URL)! },
  ].filter((t): t is ShellTool => !!t);
  return (
    <ConsoleShell staff={{ name: staff.name, email: staff.email, role: staff.role }} tools={tools}>
      {children}
    </ConsoleShell>
  );
}
