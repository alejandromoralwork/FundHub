/**
 * FILE: packages/core/src/password.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Turns passwords into "hashes" for storage and checks a typed password against a stored hash.
 *   A hash is a one-way scramble: from the hash you cannot get the password back, but hashing the same
 *   password with the same "salt" (random extra bytes) always gives the same hash. So FundHub never stores
 *   real passwords; if the database leaked, the passwords would still be hard to recover.
 *   The algorithm is scrypt, which is deliberately slow and memory-hungry to make guessing attacks expensive.
 * WHERE IT RUNS: on the server only (Node.js), because it uses Node's built-in `crypto` module. Used by the
 *   website and console log-in code and by command-line scripts (e.g. to create the first staff user).
 * FRAMEWORK NOTES: `node:crypto` and `node:util` are modules built into Node.js (the `node:` prefix says so).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async function` / `await` and `Promise<T>` (a value of type T that arrives later).
 *   - type assertion `x as SomeType` with a function type `(a: A, b: B) => R`.
 *   - re-export `export { X } from "./file"` (pass another file's export through this one).
 *   - array destructuring `const [a, b, c] = list`; template strings; `!x` (not), `||` (or), `&&` (and).
 *   - `Buffer`: Node's type for raw binary data (a sequence of bytes).
 */

// randomBytes = make cryptographically random bytes (for the salt); scrypt = the hashing algorithm;
// timingSafeEqual = compare two byte sequences in constant time (explained in verifyPassword).
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
// promisify turns an old-style "callback" function into one that returns a Promise, so we can `await` it.
import { promisify } from "node:util";

/**
 * Kind: constant holding a function. The scrypt hash function in Promise form.
 * `promisify(scrypt)` alone has a vague type, so `as (pw: string, salt: Buffer, len: number) => Promise<Buffer>`
 * tells TypeScript its exact shape: it takes the password, the salt and the wanted hash length in bytes,
 * and returns (later) the hash as a Buffer. `as` changes only what TypeScript believes, not the code.
 */
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
/** Kind: constant. Length of the hash in bytes (64 bytes = 512 bits). */
const KEY_LEN = 64;

// Re-export: code that imports from this file can also get PASSWORD_MIN_LENGTH here, while browser code imports
// it from password-rules.ts directly (that file has no server-only imports).
export { PASSWORD_MIN_LENGTH } from "./password-rules";

/**
 * Returns "scrypt$<salt b64>$<hash b64>". No "server-only" import so CLI scripts can use it.
 *
 * Kind: async function. Hashes a new password for storage.
 * @param password  type `string` — the plain password the user chose.
 * @returns `Promise<string>` — (later) the text to store in the database, in three parts joined by "$":
 *          the algorithm name, the salt and the hash, both written in base64 (a way of writing bytes as text).
 * ("server-only" is a package that makes Next.js refuse to bundle a file into browser code; it is left out here
 * because command-line scripts, which are not Next.js, also import this file.)
 */
export async function hashPassword(password: string): Promise<string> {
  // 16 fresh random bytes. A different salt per user means two people with the same password get different
  // hashes, and pre-computed tables of common-password hashes are useless.
  const salt = randomBytes(16);
  // `await` waits for the (deliberately slow) hash to be computed without freezing the rest of the server.
  const hash = await scryptAsync(password, salt, KEY_LEN);
  // `${…}` inserts values into the text. Note `scrypt$${…}`: the first `$` is a literal dollar sign, and
  // `${` starts an insertion. `.toString("base64")` turns the bytes into text.
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/**
 * Kind: async function. Checks a log-in attempt.
 * @param password  type `string` — what the user typed.
 * @param stored    type `string` — the value saved by `hashPassword` for that user.
 * @returns `Promise<boolean>` — (later) `true` if the password is right, `false` otherwise (also when the
 *          stored value is malformed).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Split "scrypt$salt$hash" at each "$" and name the three parts (array destructuring).
  const [scheme, saltB64, hashB64] = stored.split("$");
  // Guard clause: refuse unless the scheme is "scrypt" and both other parts exist. `!saltB64` is true when the
  // part is missing or empty. `||` = "or": any one failing condition is enough to return false straight away.
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  // Turn the stored hash back from base64 text into bytes.
  const expected = Buffer.from(hashB64, "base64");
  // Hash the typed password with the SAME salt and length as the stored one.
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  // Equal hashes mean the same password. `&&` = "and": first check lengths (timingSafeEqual throws an error if
  // they differ), then compare. timingSafeEqual always takes the same time however many bytes match, so an
  // attacker cannot learn anything by measuring how fast a wrong guess is rejected.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
