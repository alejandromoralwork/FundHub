/**
 * FundHub Score: an independent 0–100 grade per provider, computed only from FundHub's own data.
 * Nobody can pay to change it. Formula and weights are published on /fundhub-score.
 *
 *   Quality Score = 75% peer reviews (smoothed) + 25% data credibility
 *   Price Score   = how the provider's typical fee compares with its category peers (cheaper = higher)
 *   FundHub Score = 60% Quality + 40% Price (Quality only when too few peers to compare price)
 */

/**
 * FILE: packages/core/src/score.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Calculates the FundHub Score of every provider (the formula is summarised just above) and turns
 *   it into a letter grade (A+ to D). It is a pure calculation: it receives provider data and returns scores,
 *   without reading the database itself. packages/db/src/queries.ts loads the providers and calls
 *   `computeScores`, and the website shows the results on profiles and the comparator.
 * WHERE IT RUNS: on the server in practice (called from the database queries), but it is plain code.
 * FRAMEWORK NOTES: none.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - object types (`type X = { field: type; … }`) and union types such as `Date | string | null`.
 *   - indexed access types `(typeof GRADES)[number]["grade"]` (the type of the `grade` field of any item).
 *   - `Pick<T, "a" | "b">`: a type with only the listed fields of T.
 *   - `Map<K, V>`: a built-in lookup table from keys of type K to values of type V.
 *   - default parameter values (`now = Date.now()`), `let` (a variable that can change) vs `const`.
 *   - `for (const x of list)` loops, `++` (add one), `.find`, non-null `!`, ternaries, `??`, spread `[...a, b]`.
 */

/**
 * Kind: constant (read-only object). The weights of the formula:
 * `quality`/`price` split the FundHub Score (60/40); `peer`/`credibility` split the Quality Score (75/25).
 */
export const SCORE_WEIGHTS = { quality: 0.6, price: 0.4, peer: 0.75, credibility: 0.25 } as const;
/** Reviews are pulled towards this average until a provider has enough of them. */
export const PRIOR_RATING = 3.5;
/**
 * Kind: constant. How many "imaginary" reviews of PRIOR_RATING are mixed in (see peerScore). With 5, a provider
 * with a single 5-star review gets (5 + 5 × 3.5) / 6 = 3.75 stars, not a perfect 5: one lucky review is not enough.
 */
export const PRIOR_WEIGHT = 5;
/** Below this many reviews the score is shown as provisional. */
export const MIN_REVIEWS = 3;
/** A category needs at least this many providers to compare price. */
export const MIN_PRICE_PEERS = 3;
/** Facts on record only. The Verified badge is excluded because verification is part of a paid subscription. */
// Points out of 100: 35 for holding any licence, 35 for any certification, 30 if the data is fresh (under a year).
export const CREDIBILITY_POINTS = { licensed: 35, certified: 35, fresh: 30 } as const;

/**
 * Kind: constant (read-only list). Grade boundaries, from best to worst: a score of at least `min` earns `grade`.
 * The order matters: `gradeOf` picks the FIRST row whose minimum is reached.
 */
export const GRADES = [
  { grade: "A+", min: 85 },
  { grade: "A", min: 75 },
  { grade: "B", min: 65 },
  { grade: "C", min: 50 },
  { grade: "D", min: 0 },
] as const;
/**
 * Kind: type alias. "A+" | "A" | "B" | "C" | "D".
 * `(typeof GRADES)[number]` = the type of any row; adding `["grade"]` = the type of that row's `grade` field.
 * Works only because of `as const` above, which keeps the exact grade texts.
 */
export type Grade = (typeof GRADES)[number]["grade"];

/** The provider fields the score needs. */
// Kind: type alias for an object type. Each line is `fieldName: type;`.
// `Date | string | null` = a date object, OR a date written as text, OR null (never verified / unknown).
export type ScoreInput = {
  // The provider's database id.
  id: number;
  // Slug of its primary service category; price is compared only within the same category.
  category: string;
  // Typical fee range in euros.
  priceMin: number;
  priceMax: number;
  // Average review rating (1–5 stars) and number of approved reviews.
  rating: number;
  reviewCount: number;
  // Licences and certifications held (lists of names).
  licences: string[];
  certifications: string[];
  // When FundHub last verified the data, and when the provider last updated its own profile.
  lastVerifiedAt: Date | string | null;
  providerUpdatedAt: Date | string | null;
};

/** Kind: type alias. The result for one provider. All scores are 0–100 numbers. */
export type ProviderScore = {
  // The FundHub Score (rounded) and its letter grade.
  fundhub: number;
  grade: Grade;
  // The Quality Score (rounded).
  quality: number;
  /** Null when the category has too few providers to compare fees. */
  price: number | null;
  // The two parts of the Quality Score.
  peer: number;
  credibility: number;
  /** Fewer than MIN_REVIEWS reviews: treat with caution. */
  provisional: boolean;
};

/**
 * Kind: function. Converts a 0–100 score into its letter grade.
 * @param score  type `number`.
 * @returns `Grade`, e.g. 78 → "A".
 * `.find(fn)` returns the first item for which `fn` returns true, or `undefined` if none does. Because the last
 * row has `min: 0`, any score of 0 or more always finds a row, so `!` ("not undefined") is safe here.
 */
export function gradeOf(score: number): Grade {
  return GRADES.find((g) => score >= g.min)!.grade;
}

/** Kind: constant. One year in milliseconds (JavaScript measures time in milliseconds). */
const YEAR_MS = 365 * 24 * 3600 * 1000;
/**
 * Kind: function. The middle of a provider's fee range, used as its "typical fee".
 * @param p  type `Pick<ScoreInput, "priceMin" | "priceMax">` — any object that has at least these two fields.
 * @returns `number`.
 */
const mid = (p: Pick<ScoreInput, "priceMin" | "priceMax">) => (p.priceMin + p.priceMax) / 2;

/**
 * Kind: function (file-private). Peer-review part of the score, 0–100.
 * @param p  type `ScoreInput` — the provider.
 * @returns `number`.
 */
function peerScore(p: ScoreInput): number {
  // Number of reviews, never below 0 (`Math.max` returns the larger of its arguments).
  const n = Math.max(0, p.reviewCount);
  // "Smoothed" average: the real ratings mixed with PRIOR_WEIGHT imaginary reviews of PRIOR_RATING stars.
  // Few reviews → close to 3.5; many reviews → close to the real average. With no reviews, simply 3.5.
  const avg = n > 0 ? (p.rating * n + PRIOR_RATING * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT) : PRIOR_RATING;
  // Map 1–5 stars onto 0–100 (1 star → 0, 5 stars → 100), then clamp between 0 and 100 with min/max.
  return Math.max(0, Math.min(100, ((avg - 1) / 4) * 100));
}

/**
 * Kind: function (file-private). Data-credibility part of the score: 0, 30, 35, 65, 70 or 100.
 * @param p    type `ScoreInput` — the provider.
 * @param now  type `number` — the current time in milliseconds (passed in so tests can fix the date).
 * @returns `number`.
 */
function credibilityScore(p: ScoreInput, now: number): number {
  // The most recent of the two dates, in milliseconds. `new Date(x).getTime()` converts a date or date text into
  // milliseconds; a missing date (null) counts as 0 ("long ago") via the ternary `cond ? a : b`.
  const last = Math.max(p.lastVerifiedAt ? new Date(p.lastVerifiedAt).getTime() : 0, p.providerUpdatedAt ? new Date(p.providerUpdatedAt).getTime() : 0);
  return (
    // `.length` of an empty list is 0, which counts as false; any other length counts as true.
    (p.licences.length ? CREDIBILITY_POINTS.licensed : 0) +
    (p.certifications.length ? CREDIBILITY_POINTS.certified : 0) +
    // Fresh = a date exists (`last` is not 0) AND it is less than a year old.
    (last && now - last < YEAR_MS ? CREDIBILITY_POINTS.fresh : 0)
  );
}

/**
 * Share of category peers with a higher typical fee (ties count half), 0–100.
 *
 * Kind: function (file-private).
 * @param p         type `ScoreInput` — the provider.
 * @param peerMids  type `number[]` — the typical fees of ALL providers in its category, including itself.
 * @returns `number | null` — 100 = cheapest in its category, 0 = most expensive; `null` = too few peers.
 */
function priceScore(p: ScoreInput, peerMids: number[]): number | null {
  // Too few providers to make a fair comparison.
  if (peerMids.length < MIN_PRICE_PEERS) return null;
  const m = mid(p);
  // `let` (not `const`) because these counters change inside the loop.
  let above = 0;
  let ties = -1; // the provider itself is in the list
  // `for (const x of peerMids)` runs the block once for each fee in the list.
  for (const x of peerMids) {
    // `above++` adds 1 to `above`.
    if (x > m) above++;
    else if (x === m) ties++;
  }
  // Percentage of the OTHER providers (hence `length - 1`) that are more expensive, ties counting half.
  return (100 * (above + ties / 2)) / (peerMids.length - 1);
}

/**
 * Scores every provider against its primary-category peers.
 *
 * Kind: function (exported).
 * @param all  type `ScoreInput[]` — every published provider.
 * @param now  type `number`, optional — the current time in milliseconds. `= Date.now()` is a default value:
 *             it is used when the caller leaves the argument out.
 * @returns `Map<number, ProviderScore>` — a lookup table from provider id to its scores, used as
 *          `scores.get(providerId)`.
 */
export function computeScores(all: ScoreInput[], now = Date.now()): Map<number, ProviderScore> {
  // First pass: collect the typical fees per category. `new Map<string, number[]>()` creates an empty table with
  // category slugs as keys and lists of fees as values.
  // For each provider: take the category's list so far (`mids.get(...)`, or `[]` if there is none yet, via `??`),
  // copy it with the new fee added at the end (`[...list, fee]`), and store it back with `.set`.
  const mids = new Map<string, number[]>();
  for (const p of all) mids.set(p.category, [...(mids.get(p.category) ?? []), mid(p)]);

  // Second pass: compute each provider's scores and store them in `out` under its id.
  const out = new Map<number, ProviderScore>();
  for (const p of all) {
    const peer = peerScore(p);
    const credibility = credibilityScore(p, now);
    // Quality = 75% peer + 25% credibility.
    const quality = SCORE_WEIGHTS.peer * peer + SCORE_WEIGHTS.credibility * credibility;
    // `!` because the first pass guarantees every provider's category is in the map.
    const price = priceScore(p, mids.get(p.category)!);
    // Without a price score, the FundHub Score is the Quality Score alone; otherwise 60% quality + 40% price.
    const fundhub = price === null ? quality : SCORE_WEIGHTS.quality * quality + SCORE_WEIGHTS.price * price;
    // Round once, and grade the rounded number so the grade always matches the number shown.
    const r = Math.round(fundhub);
    out.set(p.id, {
      fundhub: r,
      grade: gradeOf(r),
      quality: Math.round(quality),
      price: price === null ? null : Math.round(price),
      peer: Math.round(peer),
      // Shorthand: `credibility,` means `credibility: credibility`. It is already a whole number, so no rounding.
      credibility,
      provisional: p.reviewCount < MIN_REVIEWS,
    });
  }
  return out;
}
