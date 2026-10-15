/**
 * FundHub Score: an independent 0–100 grade per provider, computed only from FundHub's own data.
 * Nobody can pay to change it. Formula and weights are published on /fundhub-score.
 *
 *   Quality Score = 75% peer reviews (smoothed) + 25% data credibility
 *   Price Score   = how the provider's typical fee compares with its category peers (cheaper = higher)
 *   FundHub Score = 60% Quality + 40% Price (Quality only when too few peers to compare price)
 */

export const SCORE_WEIGHTS = { quality: 0.6, price: 0.4, peer: 0.75, credibility: 0.25 } as const;
/** Reviews are pulled towards this average until a provider has enough of them. */
export const PRIOR_RATING = 3.5;
export const PRIOR_WEIGHT = 5;
/** Below this many reviews the score is shown as provisional. */
export const MIN_REVIEWS = 3;
/** A category needs at least this many providers to compare price. */
export const MIN_PRICE_PEERS = 3;
export const CREDIBILITY_POINTS = { verified: 40, licensed: 20, certified: 20, fresh: 20 } as const;

export const GRADES = [
  { grade: "A+", min: 85 },
  { grade: "A", min: 75 },
  { grade: "B", min: 65 },
  { grade: "C", min: 50 },
  { grade: "D", min: 0 },
] as const;
export type Grade = (typeof GRADES)[number]["grade"];

/** The provider fields the score needs. */
export type ScoreInput = {
  id: number;
  category: string;
  priceMin: number;
  priceMax: number;
  rating: number;
  reviewCount: number;
  verified: boolean;
  licences: string[];
  certifications: string[];
  lastVerifiedAt: Date | string | null;
  providerUpdatedAt: Date | string | null;
};

export type ProviderScore = {
  fundhub: number;
  grade: Grade;
  quality: number;
  /** Null when the category has too few providers to compare fees. */
  price: number | null;
  peer: number;
  credibility: number;
  /** Fewer than MIN_REVIEWS reviews: treat with caution. */
  provisional: boolean;
};

export function gradeOf(score: number): Grade {
  return GRADES.find((g) => score >= g.min)!.grade;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;
const mid = (p: Pick<ScoreInput, "priceMin" | "priceMax">) => (p.priceMin + p.priceMax) / 2;

function peerScore(p: ScoreInput): number {
  const n = Math.max(0, p.reviewCount);
  const avg = n > 0 ? (p.rating * n + PRIOR_RATING * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT) : PRIOR_RATING;
  return Math.max(0, Math.min(100, ((avg - 1) / 4) * 100));
}

function credibilityScore(p: ScoreInput, now: number): number {
  const last = Math.max(p.lastVerifiedAt ? new Date(p.lastVerifiedAt).getTime() : 0, p.providerUpdatedAt ? new Date(p.providerUpdatedAt).getTime() : 0);
  return (
    (p.verified ? CREDIBILITY_POINTS.verified : 0) +
    (p.licences.length ? CREDIBILITY_POINTS.licensed : 0) +
    (p.certifications.length ? CREDIBILITY_POINTS.certified : 0) +
    (last && now - last < YEAR_MS ? CREDIBILITY_POINTS.fresh : 0)
  );
}

/** Share of category peers with a higher typical fee (ties count half), 0–100. */
function priceScore(p: ScoreInput, peerMids: number[]): number | null {
  if (peerMids.length < MIN_PRICE_PEERS) return null;
  const m = mid(p);
  let above = 0;
  let ties = -1; // the provider itself is in the list
  for (const x of peerMids) {
    if (x > m) above++;
    else if (x === m) ties++;
  }
  return (100 * (above + ties / 2)) / (peerMids.length - 1);
}

/** Scores every provider against its primary-category peers. */
export function computeScores(all: ScoreInput[], now = Date.now()): Map<number, ProviderScore> {
  const mids = new Map<string, number[]>();
  for (const p of all) mids.set(p.category, [...(mids.get(p.category) ?? []), mid(p)]);

  const out = new Map<number, ProviderScore>();
  for (const p of all) {
    const peer = peerScore(p);
    const credibility = credibilityScore(p, now);
    const quality = SCORE_WEIGHTS.peer * peer + SCORE_WEIGHTS.credibility * credibility;
    const price = priceScore(p, mids.get(p.category)!);
    const fundhub = price === null ? quality : SCORE_WEIGHTS.quality * quality + SCORE_WEIGHTS.price * price;
    const r = Math.round(fundhub);
    out.set(p.id, {
      fundhub: r,
      grade: gradeOf(r),
      quality: Math.round(quality),
      price: price === null ? null : Math.round(price),
      peer: Math.round(peer),
      credibility,
      provisional: p.reviewCount < MIN_REVIEWS,
    });
  }
  return out;
}
