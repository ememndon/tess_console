// Outlier scoring — the heart of "what's winning". A video is an OUTLIER when it
// vastly outperforms its OWN channel's typical views, not just when it has high
// raw views (that just rewards big channels). Pure functions, no I/O.

export const OUTLIER_THRESHOLD = 5; // >= 5x the channel baseline = a genuine outlier
const SCORE_CAP = 50; // clamp so one freak hit on a tiny channel doesn't dominate

/** views / channel-baseline, rounded to 1dp and capped. null if no baseline. */
export function outlierScore(views: number, channelBaseline: number | null | undefined): number | null {
  if (!channelBaseline || channelBaseline <= 0) return null;
  return Math.min(SCORE_CAP, Math.round((views / channelBaseline) * 10) / 10);
}

/** Views per day since publish — momentum, independent of channel size. */
export function velocityPerDay(views: number, publishedAt: string | null): number | null {
  if (!publishedAt) return null;
  const ms = Date.now() - new Date(publishedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const days = Math.max(1, ms / 86_400_000);
  return Math.round(views / days);
}

export const isOutlier = (score: number | null): boolean => score != null && score >= OUTLIER_THRESHOLD;

/** (likes + comments) / views — audience reaction strength, 0..~. null if no views. */
export function engagementRate(views: number, likes: number | null, comments: number | null): number | null {
  if (!views || views <= 0) return null;
  const r = ((likes ?? 0) + (comments ?? 0)) / views;
  return Math.round(r * 10000) / 10000;
}

// Composite "opportunity" score (0..100) — the single number to rank by. Blends
// how much a video beats its channel (outlier), its momentum (velocity), how hard
// the audience reacted (engagement), and freshness (recent = more actionable).
// Each input is squashed to 0..1 so no single signal dominates.
export function opportunityScore(input: {
  outlierScore: number | null;
  velocity: number | null;
  engagementRate: number | null;
  publishedAt: string | null;
}): number {
  const sat = (x: number) => x / (x + 1); // diminishing returns, 0..1
  const outlier = input.outlierScore != null ? sat(input.outlierScore / 8) : 0; // ~8x → strong
  const vel = input.velocity != null ? sat(input.velocity / 50_000) : 0; // 50k/day → strong
  const eng = input.engagementRate != null ? sat(input.engagementRate / 0.05) : 0; // 5% → strong
  let recency = 0.5;
  if (input.publishedAt) {
    const days = (Date.now() - new Date(input.publishedAt).getTime()) / 86_400_000;
    recency = days <= 7 ? 1 : days <= 30 ? 0.85 : days <= 90 ? 0.6 : days <= 180 ? 0.4 : 0.25;
  }
  const score = (0.4 * outlier + 0.25 * vel + 0.2 * eng + 0.15 * recency) * 100;
  return Math.round(score * 10) / 10;
}

export function median(nums: number[]): number {
  const a = nums.filter((n) => Number.isFinite(n) && n >= 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
