/**
 * FILE: apps/web/src/app/api/advisor/route.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A small web API endpoint at POST /api/advisor. The website's "ask the advisor" chat box sends
 *   a question here as JSON ({ "message": "..." }); this file checks the input and replies with the advisor's
 *   answer (a title, text, bullet points and suggested providers) as JSON.
 * WHERE IT RUNS: on the server (Node.js) only. Browsers call it over HTTP; it never runs in the browser.
 * FRAMEWORK NOTES: In the Next.js App Router, a file called route.ts (instead of page.tsx) is an API endpoint
 *   rather than a web page. The folder path is the URL (app/api/advisor -> /api/advisor), and each exported
 *   function named after an HTTP method (GET, POST, ...) handles requests of that method.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async function` / `await`; a parameter with a type (`req: Request`).
 *   - arrow function `() => null`; method chaining `a.b().c()`.
 *   - Zod schemas (`z.object(...)`) and `.safeParse()` for checking untrusted input.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next/server" and "zod" are npm libraries;
// "@/..." is this app's src folder.
// `NextResponse`: Next.js helper for building HTTP responses, e.g. `NextResponse.json(data)`.
import { NextResponse } from "next/server";
// `z`: the Zod library, used to describe what valid input looks like and to check it.
import { z } from "zod";
// The function that actually works out the advisor's answer to a question.
import { answerAdvisorQuestion } from "@/lib/advisor";

/**
 * Kind: constant (Zod schema).
 * Describes the only accepted request body: an object with a `message` that is a string. `.trim()` removes
 * spaces at both ends first; `.min(1).max(500)` then requires 1 to 500 characters, so empty or very long
 * messages are refused before any work is done.
 */
const bodySchema = z.object({ message: z.string().trim().min(1).max(500) });

/**
 * Kind: async function (Next.js route handler for HTTP POST).
 * @param req  type `Request` (the standard web request object): carries the incoming body, headers, URL.
 * @returns    `Promise<NextResponse>`: a JSON reply, either the advisor's answer or an error with status 400.
 */
export async function POST(req: Request) {
  // `req.json()` reads the body and turns JSON text into a JavaScript object. If the body is not valid JSON
  // it fails; `.catch(() => null)` turns that failure into the value `null` instead of crashing.
  // `.safeParse(...)` checks the value against the schema and returns `{ success: true, data }` or
  // `{ success: false, error }`, never throwing an error.
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  // Invalid input: reply with HTTP status 400 ("bad request") and a short explanation.
  if (!parsed.success) {
    return NextResponse.json({ error: "Send { message: string } (1–500 chars)." }, { status: 400 });
  }
  // Valid input: `parsed.data.message` is the cleaned-up text. Wait for the answer and send it as JSON
  // (status 200 "OK" by default).
  return NextResponse.json(await answerAdvisorQuestion(parsed.data.message));
}
