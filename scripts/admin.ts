/**
 * Account administration (no email service yet, so passwords are set here).
 *
 *   npm run admin -- create-admin you@fundhub.lu "Your Name"   (prints a generated password)
 *   npm run admin -- reset-password someone@provider.lu       (prints a new temporary password)
 *   npm run admin -- promote someone@fundhub.lu                (make an existing account admin)
 *   npm run admin -- list
 *
 * Point DATABASE_URL / DATABASE_AUTH_TOKEN at production to manage live accounts.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { sessions, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

const genPassword = () => randomBytes(12).toString("base64url");

async function main() {
  const [cmd, rawEmail, name] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();

  if (cmd === "list") {
    const rows = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users);
    console.table(rows);
    return;
  }
  if (!email || !["create-admin", "reset-password", "promote"].includes(cmd ?? "")) {
    console.error("Usage: npm run admin -- <create-admin email name | reset-password email | promote email | list>");
    process.exit(1);
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email));

  if (cmd === "create-admin") {
    if (existing) throw new Error(`${email} already exists. Use "promote" or "reset-password".`);
    const password = genPassword();
    await db.insert(users).values({ email, name: name || email, role: "admin", passwordHash: await hashPassword(password) });
    console.log(`✔ Admin created: ${email}\n  Temporary password: ${password}\n  Log in at /account/login.`);
    return;
  }
  if (!existing) throw new Error(`No account for ${email}`);

  if (cmd === "promote") {
    await db.update(users).set({ role: "admin" }).where(eq(users.id, existing.id));
    console.log(`✔ ${email} is now an admin.`);
    return;
  }

  const password = genPassword();
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, existing.id));
  // Sign out everywhere.
  await db.delete(sessions).where(eq(sessions.userId, existing.id));
  console.log(`✔ Password reset for ${email}\n  Temporary password: ${password}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
