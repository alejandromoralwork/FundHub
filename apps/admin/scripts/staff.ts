/**
 * Staff accounts for the internal platform (there is no public sign-up).
 *
 *   npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner
 *   npm run staff -w @fundhub/admin -- reset-password someone@fundhub.lu
 *   npm run staff -w @fundhub/admin -- reset-mfa someone@fundhub.lu     (lost phone)
 *   npm run staff -w @fundhub/admin -- list
 *
 * Point DATABASE_URL at production to manage live staff.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { STAFF_ROLES, type StaffRole } from "@fundhub/core/enums";
import { hashPassword } from "@fundhub/core/password";
import { db, pool } from "@fundhub/db/client";
import { staffSessions, staffUsers } from "@fundhub/db/schema";

const genPassword = () => randomBytes(12).toString("base64url");

async function main() {
  const [cmd, rawEmail, name, role = "operations"] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();

  if (cmd === "list") {
    console.table(
      await db
        .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name, role: staffUsers.role, mfa: staffUsers.totpEnabled, active: staffUsers.active })
        .from(staffUsers),
    );
    return;
  }
  if (!email || !["create", "reset-password", "reset-mfa"].includes(cmd ?? "")) {
    console.error('Usage: npm run staff -- <create email "Name" [owner|operations|analyst|sales] | reset-password email | reset-mfa email | list>');
    process.exit(1);
  }

  if (cmd === "create") {
    if (!STAFF_ROLES.includes(role as StaffRole)) throw new Error(`Role must be one of ${STAFF_ROLES.join(", ")}`);
    const password = genPassword();
    await db.insert(staffUsers).values({ email, name: name || email, role: role as StaffRole, passwordHash: await hashPassword(password) });
    console.log(`✔ Staff created: ${email} (${role})\n  Temporary password: ${password}\n  Log in at /admin/login and set up two-factor authentication.`);
    return;
  }

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  if (!user) throw new Error(`No staff account for ${email}`);
  if (cmd === "reset-mfa") {
    await db.update(staffUsers).set({ totpEnabled: false, totpSecret: null }).where(eq(staffUsers.id, user.id));
    console.log(`✔ Two-factor reset for ${email}; they'll enrol again at next login.`);
  } else {
    const password = genPassword();
    await db.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, user.id));
    console.log(`✔ Password reset for ${email}\n  Temporary password: ${password}`);
  }
  await db.delete(staffSessions).where(eq(staffSessions.staffUserId, user.id));
}

main()
  .then(() => pool.end())
  .then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
