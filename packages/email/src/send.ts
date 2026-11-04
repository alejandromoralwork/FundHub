/**
 * FILE: packages/email/src/send.ts
 * PART: shared package (packages/email)
 * WHAT IT DOES: The single function every part of FundHub uses to send an email. It turns a named template
 *   (see templates/index.tsx) plus its data into HTML, writes a record of the email into the `email_messages`
 *   database table (so staff can see every email in the console's email log), sends it through Resend (an
 *   email-delivery service) and records whether that worked. On a developer's computer without a Resend key
 *   it prints the email to the terminal instead of sending it.
 * WHERE IT RUNS: on the server only (Node.js): it uses the database and a secret API key, which must never
 *   reach the browser.
 * FRAMEWORK NOTES:
 *   - React Email lets us write emails as React components (HTML-like JSX); its `render` turns them into
 *     an HTML string that email programs understand.
 *   - Drizzle ORM writes SQL for us: `db.insert(table).values({...})` = "INSERT INTO table …",
 *     `db.update(table).set({...}).where(...)` = "UPDATE table SET … WHERE …".
 *   - `process.env.NAME` reads an environment variable: a setting given to the server from outside the code
 *     (e.g. secrets like RESEND_API_KEY), so secrets are not written in the source code.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generics `<T extends TemplateName>`: T stands for "whichever template the caller chose", so the type of
 *     `props` can depend on the template.
 *   - object types with optional properties (`toName?: string`).
 *   - discriminated unions: `{ ok: true; … } | { ok: false; … }` (the `ok` field tells which shape it is).
 *   - type assertions `as X` and `as unknown as X`; `import { type X }`; re-exports `export { … }`.
 *   - async/await, `Promise<T>`, optional chaining `?.`, `??`, ternaries, template strings, destructuring.
 */

// `import { a } from "b"` brings the named export `a` of module `b` into this file.
// `render` turns a React Email component into an HTML string (library from npm).
import { render } from "@react-email/components";
// `eq(column, value)` builds the SQL condition "column = value" for Drizzle queries.
import { eq } from "drizzle-orm";
// From React: `createElement` builds a component instance in code (what JSX `<X />` does behind the scenes);
// `ComponentType` is the TypeScript type for "any React component". `type` marks it as a type-only import.
import { createElement, type ComponentType } from "react";
// The official Resend client library, used to send the email over the internet.
import { Resend } from "resend";
// `@fundhub/…` = our own shared packages in packages/. `db` = the database connection from packages/db.
import { db } from "@fundhub/db/client";
// The Drizzle definition of the `email_messages` table (its columns), used to insert and update log rows.
import { emailMessages } from "@fundhub/db/schema";
// The catalogue of templates and its helper types, from ./templates (this package's templates/index.tsx).
import { TEMPLATES, type TemplateName, type TemplateProps } from "./templates";

// Re-export: code elsewhere can import these from "@fundhub/email/send" directly, without knowing about the
// templates folder.
export { TEMPLATES, type TemplateName, type TemplateProps };

/**
 * Kind: type alias (generic object type). The options for `sendEmail`.
 * `<T extends TemplateName>` = T is one of the template names ("password-reset", "message", …).
 * - `to: string` — recipient email address.
 * - `toName?: string` — optional recipient name (the `?` means it may be left out).
 * - `template: T` — which template to use.
 * - `props: TemplateProps<T>` — the data that template needs. Because it depends on T, TypeScript checks
 *   that e.g. "password-reset" receives `{ name, resetUrl }` and nothing else.
 */
export type SendOptions<T extends TemplateName> = {
  to: string;
  toName?: string;
  template: T;
  props: TemplateProps<T>;
  /** What the email is about, for the admin email log (e.g. "provider_claims", "12"). */
  // `string | number` = the id may be text or a number; it is stored as text either way.
  related?: { entity: string; id: string | number };
  /** Staff user who sent it from the admin platform. */
  sentBy?: number;
  /** Contains a secret (e.g. a reset link): the email log keeps the subject but not the content. */
  sensitive?: boolean;
};

/**
 * Kind: type alias (a union of two object types). What `sendEmail` reports back.
 * Either `{ ok: true, id }` (sent) or `{ ok: false, id, error }` (failed, with the reason). `id` is the row id in
 * `email_messages` in both cases. After checking `if (result.ok)`, TypeScript knows which of the two shapes it is,
 * and therefore whether `error` exists. This pattern is called a "discriminated union".
 */
export type SendResult = { ok: true; id: number } | { ok: false; id: number; error: string };

/**
 * Kind: function (arrow function, file-private). The sender address: the EMAIL_FROM setting if present,
 * otherwise (`??`) the default "FundHub <hello@fundhub.lu>". A function rather than a constant so the setting is
 * read when an email is sent, not once when the file first loads.
 */
const fromAddress = () => process.env.EMAIL_FROM ?? "FundHub <hello@fundhub.lu>";

/**
 * Renders a template, logs it in `email_messages`, and sends it through Resend.
 * Without RESEND_API_KEY (local development) the email is printed to the console instead.
 *
 * Kind: async function (generic).
 * @param opts  type `SendOptions<T>` — recipient, template name, template data and log details (see above).
 *              T is worked out automatically from `opts.template` at each call.
 * @returns `Promise<SendResult>` — (later) whether it was sent, and the log row id. It does not throw on a
 *          Resend failure; it reports it in the result instead. (A database error would still throw.)
 */
export async function sendEmail<T extends TemplateName>(opts: SendOptions<T>): Promise<SendResult> {
  // Look up the chosen template's definition (its component and subject function). `TEMPLATES[name]` reads the
  // property whose name is held in the variable (square-bracket access).
  const def = TEMPLATES[opts.template];
  // Build the subject line by calling the template's subject function with the props.
  // The `as (p: TemplateProps<T>) => string` assertion tells TypeScript the function's exact type, because it
  // cannot narrow the union of all subject functions by itself (see the next comment).
  const subject = (def.subject as (p: TemplateProps<T>) => string)(opts.props);
  // Template unions don't narrow through generics; the public signature keeps callers type-safe.
  // (Meaning: inside this function TypeScript only knows "some template", so we loosen the type with
  // `as unknown as …`, a two-step assertion that forces a type. Callers are still fully checked by SendOptions<T>.)
  const Component = def.component as unknown as ComponentType<Record<string, unknown>>;
  // Create the email component with its props and turn it into an HTML string. `await` because render is async.
  const html = await render(createElement(Component, opts.props as Record<string, unknown>));

  // Log the email in the database BEFORE sending, so even a failed attempt is visible in the console.
  // `.returning({ id: … })` asks Postgres to send back the new row's id. The result is a list of rows;
  // `const [row] = …` takes the first (and only) one.
  const [row] = await db
    .insert(emailMessages)
    .values({
      toEmail: opts.to,
      toName: opts.toName,
      subject,
      template: opts.template,
      // For sensitive emails store only `{ redacted: true }` instead of the data (which holds e.g. a reset link).
      payload: opts.sensitive ? { redacted: true } : (opts.props as Record<string, unknown>),
      // `opts.related?.entity`: read `entity` only if `related` was given; otherwise the value is `undefined`.
      relatedEntity: opts.related?.entity,
      // `String(x)` converts the id to text; `null` (empty in the database) when no related item was given.
      relatedId: opts.related ? String(opts.related.id) : null,
      sentBy: opts.sentBy,
    })
    .returning({ id: emailMessages.id });

  // The Resend secret key from the environment; `undefined` on a developer machine without one.
  const key = process.env.RESEND_API_KEY;
  // `!key` = "no key". Development mode: print instead of sending.
  if (!key) {
    // `JSON.stringify(value, null, 2)` turns the data into readable, indented text; `\n` is a line break.
    console.info(`[email:console] to=${opts.to} subject="${subject}"\n${JSON.stringify(opts.props, null, 2)}`);
    // Mark the log row as sent, with "console" as the delivery id so it is clear it was never really sent.
    await db.update(emailMessages).set({ status: "sent", providerMessageId: "console" }).where(eq(emailMessages.id, row.id));
    return { ok: true, id: row.id };
  }

  // Send for real. `new Resend(key)` creates a client; `.emails.send({...})` sends one email.
  // Resend replies with `{ data, error }`; destructuring takes both fields out into their own constants.
  const { data, error } = await new Resend(key).emails.send({
    from: fromAddress(),
    // With a name, use the standard "Name <address>" form; otherwise just the address.
    to: opts.toName ? `${opts.toName} <${opts.to}>` : opts.to,
    subject,
    html,
  });
  // Failure: Resend returned an error, or no data at all.
  if (error || !data) {
    // `error?.message ?? "…"`: the error text if there is one, otherwise a generic message.
    const message = error?.message ?? "Unknown Resend error";
    // Record the failure and its reason in the log row.
    await db.update(emailMessages).set({ status: "failed", error: message }).where(eq(emailMessages.id, row.id));
    return { ok: false, id: row.id, error: message };
  }
  // Success: store Resend's own id for the message, so later delivery reports can be matched to this row.
  await db.update(emailMessages).set({ status: "sent", providerMessageId: data.id }).where(eq(emailMessages.id, row.id));
  return { ok: true, id: row.id };
}
