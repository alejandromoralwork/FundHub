/**
 * Staff accounts for the internal platform (there is no public sign-up).
 *
 *   npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner
 *   npm run staff -w @fundhub/admin -- reset-password someone@fundhub.lu
 *   npm run staff -w @fundhub/admin -- reset-mfa someone@fundhub.lu     (lost phone)
 *   npm run staff -w @fundhub/admin -- list
 *
 * Point DATABASE_URL at production to manage live staff.
 *
 * FILE: apps/admin/scripts/staff.ts
 * PART: console (apps/admin) — a command-line script, not part of the web app.
 * WHAT IT DOES: Creates Console staff accounts, resets a password, resets two-factor (when a phone is lost),
 *   or lists all staff. New and reset passwords are random and printed once in the terminal. After a reset,
 *   all of that person's login sessions are deleted so they must log in again.
 * WHERE IT RUNS: on your own computer or a server, in a terminal, with Node.js. It talks straight to the
 *   database named by DATABASE_URL.
 * FRAMEWORK NOTES: `npm run staff -w @fundhub/admin -- …` runs the "staff" script defined in apps/admin's
 *   package.json ("-w" = in that workspace); everything after `--` is passed to this script as arguments,
 *   which it reads from `process.argv`.
 * TYPESCRIPT YOU WILL SEE HERE: side-effect imports, `async`/`await`, array destructuring with a default
 *   value (`role = "operations"`), optional chaining `?.`, `as` assertions, template strings with `\n`
 *   (new line), `throw new Error(...)`, Promise chains `.then(ok, fail)`, `process.exit(code)`.
 */

// `import "dotenv/config"` loads settings from a local .env file into `process.env` (e.g. DATABASE_URL).
// It is imported only for that side effect, so nothing is named.
import "dotenv/config";
// `import { a } from "b"` loads named exports. "node:crypto" is Node.js's built-in crypto module;
// randomBytes gives cryptographically strong random bytes (for temporary passwords).
import { randomBytes } from "node:crypto";
// Drizzle ORM helper: `eq(a, b)` = SQL "a = b".
import { eq } from "drizzle-orm";
// `@fundhub/…` = our shared packages. STAFF_ROLES = the list of allowed roles; `type StaffRole` = one role.
import { STAFF_ROLES, type StaffRole } from "@fundhub/core/enums";
// Turns a password into a one-way hash for safe storage (we never store the password itself).
import { hashPassword } from "@fundhub/core/password";
// `db` = the database (Drizzle); `pool` = the underlying set of connections, closed at the end.
import { db, pool } from "@fundhub/db/client";
// Tables: staff accounts and their login sessions.
import { staffSessions, staffUsers } from "@fundhub/db/schema";

/**
 * Kind: constant holding an arrow function.
 * @returns `string`: a random 16-character password (12 random bytes written in URL-safe base64).
 */
const genPassword = () => randomBytes(12).toString("base64url");

/**
 * Kind: async function — the script's main work.
 * Reads the command and its arguments from the terminal and carries it out.
 * @returns `Promise<void>`: nothing, once finished (`void` = no value). Errors are thrown and handled below.
 */
async function main() {
  // `process.argv` is the full command line; `.slice(2)` drops the first two items (the Node program and
  // this script's path). The rest are unpacked in order. `role = "operations"` is the default if no role given.
  const [cmd, rawEmail, name, role = "operations"] = process.argv.slice(2);
  // Normalise the email: remove spaces around it and make it lower case. `?.` = only if it was given.
  const email = rawEmail?.trim().toLowerCase();

  // "list": print a table of all staff in the terminal (`console.table` formats rows as a grid).
  if (cmd === "list") {
    console.table(
      await db
        .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name, role: staffUsers.role, mfa: staffUsers.totpEnabled, active: staffUsers.active })
        .from(staffUsers),
    );
    // `return` ends main() here.
    return;
  }
  // Other commands need an email and must be one of the three known commands. `cmd ?? ""` uses "" if no
  // command was typed, so `.includes` always gets a string.
  if (!email || !["create", "reset-password", "reset-mfa"].includes(cmd ?? "")) {
    // `console.error` prints to the error output. The single quotes allow double quotes inside the text.
    console.error('Usage: npm run staff -- <create email "Name" [owner|operations|analyst|sales] | reset-password email | reset-mfa email | list>');
    // Exit with code 1, which means "failed" to the terminal.
    process.exit(1);
  }

  // "create": add a new staff account.
  if (cmd === "create") {
    // Reject unknown roles. `throw new Error(...)` stops the function with an error (caught at the bottom).
    // `STAFF_ROLES.join(", ")` makes "owner, operations, …". `role as StaffRole` tells TypeScript to treat
    // the text as a role for the `.includes` check.
    if (!STAFF_ROLES.includes(role as StaffRole)) throw new Error(`Role must be one of ${STAFF_ROLES.join(", ")}`);
    const password = genPassword();
    // INSERT the account. `name || email`: if no name was given, use the email as the name.
    await db.insert(staffUsers).values({ email, name: name || email, role: role as StaffRole, passwordHash: await hashPassword(password) });
    // Show the temporary password once. `\n` starts a new line inside the text.
    console.log(`✔ Staff created: ${email} (${role})\n  Temporary password: ${password}\n  Log in at /admin/login and set up two-factor authentication.`);
    return;
  }

  // The two reset commands: first find the account. `[user]` = first result or undefined.
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
  if (!user) throw new Error(`No staff account for ${email}`);
  if (cmd === "reset-mfa") {
    // Turn 2FA off and forget the old secret; they will set up a new app at their next login.
    await db.update(staffUsers).set({ totpEnabled: false, totpSecret: null }).where(eq(staffUsers.id, user.id));
    console.log(`✔ Two-factor reset for ${email}; they'll enrol again at next login.`);
  } else {
    // "reset-password": store the hash of a new random password and print the password once.
    const password = genPassword();
    await db.update(staffUsers).set({ passwordHash: await hashPassword(password) }).where(eq(staffUsers.id, user.id));
    console.log(`✔ Password reset for ${email}\n  Temporary password: ${password}`);
  }
  // In both reset cases, log the person out everywhere by deleting their sessions.
  await db.delete(staffSessions).where(eq(staffSessions.staffUserId, user.id));
}

// Run main(), then close the database connections so Node.js can finish.
// `.then(a, b)`: if everything succeeded, run `a` (exit code 0 = success); if anything failed (main threw or
// closing failed), run `b`: print the message and exit with code 1.
// `err instanceof Error ? err.message : err` prints the tidy message for real errors, or the value itself.
main()
  .then(() => pool.end())
  .then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
