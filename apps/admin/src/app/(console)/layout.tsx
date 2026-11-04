/**
 * FILE: apps/admin/src/app/(console)/layout.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The shared frame around every Console page (menu, header, links to other company tools).
 *   Before showing anything it checks that the visitor is a fully logged-in staff member, so every page in
 *   the "(console)" group is protected in one place. It also builds the list of external tool links
 *   (Nextcloud, CRM, newsletter, social scheduler) from whichever addresses are configured.
 * WHERE IT RUNS: on the server (Node.js), as a server component; the ConsoleShell it renders runs in the browser.
 * FRAMEWORK NOTES: Next.js treats a file called layout.tsx as a wrapper for every page in its folder and
 *   sub-folders; the current page is passed in as `children`. "(console)" in round brackets is a route group:
 *   it lets these pages share this layout without adding "(console)" to the URL. The login pages live outside
 *   this group, so they are not wrapped (and not protected) by it.
 * TYPESCRIPT YOU WILL SEE HERE: `React.ReactNode` (any renderable content), optional parameters `v?: string`,
 *   optional chaining `?.`, `&&` short-circuit, template strings, non-null `!`, `.filter` with a type guard
 *   `(t): t is ShellTool`, type annotations, JSX with children.
 */

// `import { a } from "b"` loads named exports from module "b". `@/…` = this app's src folder.
// ConsoleShell = the menu/header frame; `type ShellTool` = the shape of one external tool link.
import { ConsoleShell, type ShellTool } from "@/components/console-shell";
// Login check: redirects to /admin/login (or the 2FA step) if the visitor is not fully logged in.
import { requireStaff } from "@/lib/auth";

/**
 * Kind: constant (Next.js setting). "force-dynamic" = render on every request, never cache, because the
 * output depends on who is logged in. Placed on the layout, it applies to all pages inside it.
 */
export const dynamic = "force-dynamic";

/**
 * Kind: React component (async server component) — the layout.
 * Every page in this group requires password + two-factor.
 * @param props  `{ children }` destructured; type `React.ReactNode` = anything React can display (here: the
 *               page being visited).
 * @returns `Promise<JSX>`: the frame with the page inside it.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Stop here (redirect) unless the visitor is fully logged in.
  const staff = await requireStaff();
  // Small helper (arrow function). `v?: string` = the argument may be missing. `v?.replace(...)` runs replace
  // only if v exists (otherwise the result is undefined). The pattern /\/$/ removes one trailing slash.
  const base = (v?: string) => v?.replace(/\/$/, "");
  // The Nextcloud address (shared drive, calendar, task boards), or undefined if not configured.
  const nc = base(process.env.NEXTCLOUD_URL);
  // The tool links. Each entry is `condition && { … }`: if the condition is empty/undefined the entry is
  // that falsy value instead of a link. `.filter(...)` then keeps only real links.
  // `(t): t is ShellTool => !!t` is a "type guard": it tells TypeScript that the items that pass the filter
  // are ShellTool objects, so the list's type is ShellTool[]. `!` after base(...) says "not undefined here"
  // (we already checked it with `&&`).
  const tools: ShellTool[] = [
    nc && { label: "Drive (Nextcloud)", href: `${nc}/apps/files/` },
    nc && { label: "Calendar", href: `${nc}/apps/calendar/` },
    nc && { label: "Team tasks (Deck)", href: `${nc}/apps/deck/` },
    base(process.env.TWENTY_URL) && { label: "CRM (Twenty)", href: base(process.env.TWENTY_URL)! },
    base(process.env.LISTMONK_URL) && { label: "Newsletter (Listmonk)", href: `${base(process.env.LISTMONK_URL)}/admin/` },
    base(process.env.POSTIZ_URL) && { label: "Social scheduler (Postiz)", href: base(process.env.POSTIZ_URL)! },
  ].filter((t): t is ShellTool => !!t);
  // Render the shell with only the staff fields it needs, the links, and the current page inside it.
  // `{children}` inside the tags places the page's content there.
  return (
    <ConsoleShell staff={{ name: staff.name, email: staff.email, role: staff.role }} tools={tools}>
      {children}
    </ConsoleShell>
  );
}
