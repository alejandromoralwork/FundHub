import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { SOCIAL_LIMITS, SOCIAL_NETWORKS, type SocialNetwork } from "@fundhub/core/enums";
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";

/** Model and effort are configurable; drafts are always reviewed by staff before publishing. */
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CONTENT_EFFORT ?? "medium") as "low" | "medium" | "high";

export class AiError extends Error {}

export function aiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

/** Structured JSON output with the server-side refusal fallback. */
async function generateJson<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  if (!aiConfigured()) throw new AiError("ANTHROPIC_API_KEY is not set on the admin project.");
  const response = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: EFFORT, format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new AiError(`The model declined this request (${response.stop_details?.category ?? "policy"}).`);
  if (response.stop_reason === "max_tokens") throw new AiError("The draft was cut off; try a shorter brief.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new AiError("No text in the model response.");
  return JSON.parse(text.text) as T;
}

const VOICE = `You write for FundHub (fundhub.lu), the independent fund service provider comparator and set-up & fee negotiation advisory for Luxembourg. FundHub accepts no referral fees or commissions from service providers; it is paid by fund managers.
Voice: precise, neutral, useful to asset managers and fund operations professionals. British English. No hype, no superlatives, no emojis in articles.
Accuracy rules:
- Use only facts given in the brief and the context. Never invent figures, quotes, names, dates or regulatory details. If a point needs a fact you were not given, write around it or mark it as [CHECK: …] for the editor.
- Do not give legal, tax or investment advice; say "general information" where relevant.
- Never promote or disparage a specific provider beyond the facts provided.`;

// ---------------------------------------------------------------- articles

export type PostDraft = {
  title: string;
  summary: string;
  body: string;
  topic: string;
  category: string | null;
  readMinutes: number;
};

export async function draftPost(input: { kind: "news" | "learn"; brief: string; context: string }): Promise<PostDraft> {
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      body: { type: "string" },
      topic: { type: "string", enum: ["Independence", "Fees", "Structuring", "Depositary", "Regulation", "FundHub", "Market data", "Technology"] },
      category: { anyOf: [{ type: "string", enum: [...CATEGORY_SLUGS] }, { type: "null" }] },
      readMinutes: { type: "integer" },
    },
    required: ["title", "summary", "body", "topic", "category", "readMinutes"],
    additionalProperties: false,
  };
  const kindGuide =
    input.kind === "news"
      ? "Write a NEWS article: what happened or changed, why it matters to Luxembourg fund managers, and what to do next. 300-600 words."
      : "Write a LEARN guide: practical, structured, with headed sections and checklists. 600-1100 words.";
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
  return { ...draft, readMinutes: Math.min(30, Math.max(1, draft.readMinutes || 3)) };
}

// ---------------------------------------------------------------- social

export type SocialDraft = Record<SocialNetwork, { text: string; hashtags: string[] }>;

const NETWORK_GUIDE: Record<SocialNetwork, string> = {
  linkedin: "Professional, 600-1300 characters, short paragraphs with line breaks, a clear takeaway, end with the article link. 3-5 hashtags.",
  x: `Max ${SOCIAL_LIMITS.x} characters INCLUDING the link and hashtags. One sharp sentence plus the link. 1-2 hashtags.`,
  facebook: "Conversational but professional, 300-700 characters, end with the article link. 2-3 hashtags.",
  instagram: `Caption up to ${SOCIAL_LIMITS.instagram} characters, hook in the first line, say "link in bio" instead of a URL, 5-10 relevant hashtags.`,
};

export async function adaptForSocial(post: { title: string; summary: string; body: string; url: string }): Promise<SocialDraft> {
  const item = { type: "object", properties: { text: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } }, required: ["text", "hashtags"], additionalProperties: false };
  const schema = {
    type: "object",
    properties: Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, item])),
    required: [...SOCIAL_NETWORKS],
    additionalProperties: false,
  };
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
  for (const n of SOCIAL_NETWORKS) {
    out[n].hashtags = [...new Set(out[n].hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")).filter(Boolean))].slice(0, 10);
  }
  return out;
}

