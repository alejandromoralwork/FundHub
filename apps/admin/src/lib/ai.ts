/**
 * FILE: apps/admin/src/lib/ai.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Talks to Anthropic's Claude AI model to write first drafts for the Content Studio: a news
 *   article or "learn" guide from an editor's brief, and short posts for each social network adapted from an
 *   article. The model is forced to answer in a fixed JSON shape so the code can read the fields reliably.
 *   Staff always review the drafts before anything is published.
 * WHERE IT RUNS: only on the server (Node.js). It uses the secret ANTHROPIC_API_KEY, which must never reach
 *   the browser.
 * FRAMEWORK NOTES: `import "server-only"` is a tiny npm package used with Next.js: if any browser-side code
 *   ever imports this file, the build fails with an error. It is a safety net that keeps the API key and
 *   this code on the server.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - classes (`class AiError extends Error {}`) and `throw`.
 *   - generics `<T>`: a function whose result type is chosen by the caller.
 *   - type aliases, union types (`"low" | "medium" | "high"`), `Record<K, V>` (an object whose keys are K and
 *     values are V), type assertions `as X`, `type` imports.
 *   - `??` and `??=` (nullish coalescing and "assign if empty"), `!!`, ternary `c ? x : y`.
 *   - template strings over several lines, spread `[...arr]` / `{...obj}`, `Set`, `.map/.filter/.find`.
 */

// Ensures this module can only be imported by server code (see FRAMEWORK NOTES).
import "server-only";
// The official Anthropic SDK (npm library) for calling Claude. `import X from "…"` takes the module's
// default export (here the client class), unlike `{ … }` which takes named exports.
import Anthropic from "@anthropic-ai/sdk";
// `@fundhub/…` = our own shared packages. Social networks list, their character limits, and the
// `SocialNetwork` type. The `type` keyword marks an import used only for type checking (erased at runtime).
import { SOCIAL_LIMITS, SOCIAL_NETWORKS, type SocialNetwork } from "@fundhub/core/enums";
// The list of FundHub service-category slugs (e.g. "depositary"), so the model can only pick a real one.
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";

/**
 * Kind: constants.
 * Model and effort are configurable; drafts are always reviewed by staff before publishing.
 * `process.env.X` reads an environment variable (a setting given to the server, not stored in code).
 * `?? "claude-opus-5-5"` = use this default if the variable is not set.
 * EFFORT tells Claude how hard to think (more effort = better but slower and more expensive).
 * `as "low" | "medium" | "high"` is a type assertion: we tell TypeScript to treat the text as one of
 * those three values. (It does not check at runtime; a wrong value in the env would reach the API.)
 */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CONTENT_EFFORT ?? "medium") as "low" | "medium" | "high";

/**
 * Kind: class (exported).
 * Our own error type. `extends Error` means it is a normal JavaScript error with a message, but with its own
 * name, so callers can tell "an AI problem we can explain to the user" apart from unexpected crashes
 * (`error instanceof AiError`). The empty `{}` means it adds nothing else.
 */
export class AiError extends Error {}

/**
 * Kind: function (exported).
 * @returns `boolean`: true if the API key is set, so the UI can hide or disable AI buttons otherwise.
 * `!!value` turns any value into true/false (a non-empty string becomes true).
 */
export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * Kind: variable + arrow function (lazy singleton).
 * `let` (unlike `const`) can be reassigned later. `Anthropic | null` = either a client or nothing yet.
 * `client ??= new Anthropic()` means "if client is null, create one and store it"; either way the stored
 * client is returned. So the client is created only once, on first use. `new Anthropic()` reads
 * ANTHROPIC_API_KEY from the environment by itself.
 */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/**
 * Kind: async generic function (private to this file).
 * Structured JSON output with the server-side refusal fallback.
 * @param system  type `string` — the "system prompt": standing instructions on voice and rules.
 * @param user    type `string` — the actual request for this draft.
 * @param schema  type `Record<string, unknown>` — a JSON Schema describing the exact shape of the answer.
 *                `unknown` = "any value, but you must check it before using it".
 * @returns `Promise<T>`: the parsed answer. `<T>` is a generic: the caller says which type it expects
 *          (e.g. `generateJson<PostDraft>(…)`), so the result is typed accordingly.
 * @throws `AiError` when the key is missing, the model declines, or the answer is cut off or empty.
 */
async function generateJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  // Fail early with a clear message instead of a confusing API error.
  if (!aiConfigured()) throw new AiError("ANTHROPIC_API_KEY is not set on the admin project.");
  // One request to Claude. `.beta.` is the SDK's area for features still in beta.
  const response = await anthropic().beta.messages.create({
    // Which Claude model to use (see MODEL above).
    model: MODEL,
    // Upper limit on the length of the answer, in tokens (roughly word pieces).
    max_tokens: 16000,
    // Switches on the beta feature below. `fallbacks: "default"`: if the model's safety checks decline the
    // request, Anthropic's servers automatically retry it on a suitable fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // `effort` = how much thinking to do. `format: json_schema` forces the reply to be JSON matching `schema`.
    output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
    // Standing instructions (shorthand: `system` alone means `system: system`).
    system,
    // The conversation: one message from the "user" (us) with the request text.
    messages: [{ role: "user", content: user }],
  });
  // `stop_reason` says why the model stopped. "refusal" = it declined even after the fallback; `stop_details`
  // then names a category. `?.` reads it safely and `?? "policy"` is the fallback word.
  if (response.stop_reason === "refusal") throw new AiError(`The model declined this request (${response.stop_details?.category ?? "policy"}).`);
  // "max_tokens" = the answer hit the length limit, so the JSON would be incomplete.
  if (response.stop_reason === "max_tokens") throw new AiError("The draft was cut off; try a shorter brief.");
  // The answer is a list of content blocks; `.find(…)` returns the first block whose type is "text"
  // (or `undefined` if none). `(b) => …` is an arrow function used as the test.
  const text = response.content.find((b) => b.type === "text");
  // Checking `text.type` again lets TypeScript know for sure it is a text block ("type narrowing").
  if (!text || text.type !== "text") throw new AiError("No text in the model response.");
  // `JSON.parse` turns the JSON text into a JavaScript object; `as T` labels it with the caller's type.
  return JSON.parse(text.text) as T;
}

/**
 * Kind: constant (multi-line template string).
 * The house style and accuracy rules sent as the system prompt for every draft. The key business rule: the
 * model may only use facts it was given and must flag gaps with [CHECK: …], because FundHub's credibility
 * depends on accuracy and neutrality towards providers.
 */
const VOICE = `You write for FundHub (fundhub.lu), the independent fund service provider comparator and set-up & fee negotiation advisory for Luxembourg. FundHub accepts no referral fees or commissions from service providers; it is paid by fund managers.
Voice: precise, neutral, useful to asset managers and fund operations professionals. British English. No hype, no superlatives, no emojis in articles.
Accuracy rules:
- Use only facts given in the brief and the context. Never invent figures, quotes, names, dates or regulatory details. If a point needs a fact you were not given, write around it or mark it as [CHECK: …] for the editor.
- Do not give legal, tax or investment advice; say "general information" where relevant.
- Never promote or disparage a specific provider beyond the facts provided.`;

// ---------------------------------------------------------------- articles

/**
 * Kind: type alias (exported).
 * The shape of an article draft returned by the model. `string | null` = text or nothing (no category).
 */
export type PostDraft = {
  title: string;
  summary: string;
  body: string;
  topic: string;
  category: string | null;
  readMinutes: number;
};

/**
 * Kind: async function (exported).
 * Drafts a news article or learn guide.
 * @param input  an object with: `kind` (`"news" | "learn"`, which kind of piece), `brief` (`string`, the
 *               editor's instructions) and `context` (`string`, the facts the model may rely on).
 * @returns `Promise<PostDraft>`: the draft, with reading time kept between 1 and 30 minutes.
 */
export async function draftPost(input: { kind: "news" | "learn"; brief: string; context: string }): Promise<PostDraft> {
  // JSON Schema for the answer: an object with these properties, all required, and nothing extra
  // (`additionalProperties: false`). `enum` restricts a field to a fixed list of allowed values.
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      body: { type: "string" },
      topic: { type: "string", enum: ["Independence", "Fees", "Structuring", "Depositary", "Regulation", "FundHub", "Market data", "Technology"] },
      // `anyOf`: either one of the category slugs, or null. `[...CATEGORY_SLUGS]` copies the list into a new array.
      category: { anyOf: [{ type: "string", enum: [...CATEGORY_SLUGS] }, { type: "null" }] },
      readMinutes: { type: "integer" },
    },
    required: ["title", "summary", "body", "topic", "category", "readMinutes"],
    additionalProperties: false,
  };
  // Ternary: pick the instructions for a news article or for a learn guide.
  const kindGuide =
    input.kind === "news"
      ? "Write a NEWS article: what happened or changed, why it matters to Luxembourg fund managers, and what to do next. 300-600 words."
      : "Write a LEARN guide: practical, structured, with headed sections and checklists. 600-1100 words.";
  // Ask the model. `<PostDraft>` tells generateJson what type the result is. The second argument is a
  // multi-line template string; `${…}` inserts values, and `|| "(none provided)"` covers empty context.
  const draft = await generateJson<PostDraft>(
    VOICE,
    `${kindGuide}
Return: a title (max 90 characters), a one-paragraph summary (max 300 characters), the body in Markdown (use ## headings and bullet lists; do not repeat the title or summary; no raw HTML), a topic, the most relevant FundHub service category slug or null, and estimated reading minutes.

Brief from the editor:
${input.brief}

Context (the only facts you may rely on):
${input.context || "(none provided)"}`,
    schema,
  );
  // `{ ...draft, readMinutes: … }` copies every field of the draft (spread) and overrides one.
  // `draft.readMinutes || 3` uses 3 if it is 0; then Math.max/Math.min clamp it to the range 1–30.
  return { ...draft, readMinutes: Math.min(30, Math.max(1, draft.readMinutes || 3)) };
}

// ---------------------------------------------------------------- social

/**
 * Kind: type alias (exported).
 * One post per social network: `Record<SocialNetwork, …>` = an object with a key for every network
 * (linkedin, x, facebook, instagram), each holding the post text and a list of hashtags (`string[]`).
 */
export type SocialDraft = Record<SocialNetwork, { text: string; hashtags: string[] }>;

/**
 * Kind: constant.
 * Writing rules per network (length, tone, number of hashtags). Typed as `Record<SocialNetwork, string>`
 * so TypeScript complains if a network is missing. The X and Instagram limits come from SOCIAL_LIMITS.
 */
const NETWORK_GUIDE: Record<SocialNetwork, string> = {
  linkedin: "Professional, 600-1300 characters, short paragraphs with line breaks, a clear takeaway, end with the article link. 3-5 hashtags.",
  x: `Max ${SOCIAL_LIMITS.x} characters INCLUDING the link and hashtags. One sharp sentence plus the link. 1-2 hashtags.`,
  facebook: "Conversational but professional, 300-700 characters, end with the article link. 2-3 hashtags.",
  instagram: `Caption up to ${SOCIAL_LIMITS.instagram} characters, hook in the first line, say "link in bio" instead of a URL, 5-10 relevant hashtags.`,
};

/**
 * Kind: async function (exported).
 * Turns a published article into one social post per network.
 * @param post  an object with the article's `title`, `summary`, `body` and public `url` (all `string`).
 * @returns `Promise<SocialDraft>`: the posts, with hashtags cleaned up.
 */
export async function adaptForSocial(post: { title: string; summary: string; body: string; url: string }): Promise<SocialDraft> {
  // Schema for one network's post: text plus an array of strings.
  const item = { type: "object", properties: { text: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } }, required: ["text", "hashtags"], additionalProperties: false };
  // Schema for the whole answer. `SOCIAL_NETWORKS.map((n) => [n, item])` makes pairs like ["x", item];
  // `Object.fromEntries` turns those pairs into an object { x: item, linkedin: item, … }.
  const schema = {
    type: "object",
    properties: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, item])),
    required: [...SOCIAL_NETWORKS],
    additionalProperties: false,
  };
  // The prompt lists each network's rule: `.map` makes one line per network and `.join("\n")` glues them
  // together with line breaks.
  const out = await generateJson<SocialDraft>(
    VOICE,
    `Adapt this FundHub article into one post per social network. Keep every claim faithful to the article; add no new facts.
${SOCIAL_NETWORKS.map((n) => `- ${n}: ${NETWORK_GUIDE[n]}`).join("\n")}
Put hashtags in the "hashtags" array (without #); the "text" must already include any hashtags you want inline for x. Article link: ${post.url}

Title: ${post.title}
Summary: ${post.summary}

Article:
${post.body}`,
    schema,
  );
  // Normalise hashtags (no '#', no spaces, deduplicated).
  // `for (const n of list)` loops over each network. For each hashtag: `.replace(/^#/, "")` removes a leading
  // "#" (a regular expression: ^ = start), `.replace(/\s+/g, "")` removes all whitespace, `.filter(Boolean)`
  // drops empty ones. `new Set(…)` removes duplicates; `[...set]` turns it back into an array; `.slice(0, 10)`
  // keeps at most 10.
  for (const n of SOCIAL_NETWORKS) {
    out[n].hashtags = [...new Set(out[n].hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean))].slice(0, 10);
  }
  return out;
}
