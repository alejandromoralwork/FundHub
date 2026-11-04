/**
 * FILE: packages/core/src/password-rules.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Holds the password policy (currently just the minimum length). It is in its own tiny file,
 *   separate from password.ts, because password.ts uses Node.js's `crypto` module, which does not exist in
 *   the browser. Sign-up and change-password forms in the browser can import this file to check the length
 *   as the user types, without pulling server-only code into the web page.
 * WHERE IT RUNS: both (server and browser).
 * FRAMEWORK NOTES: none.
 * TYPESCRIPT YOU WILL SEE HERE: `export const` = a fixed, named value other files can import.
 *   TypeScript infers its type (`number`) from the value, so no type is written.
 */

/** Kind: constant (number). The minimum number of characters a FundHub password must have. */
export const PASSWORD_MIN_LENGTH = 10;
