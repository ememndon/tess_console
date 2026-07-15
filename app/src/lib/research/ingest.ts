import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { researchVideos, researchChannels } from "../db/schema";
import { getResearchProvider } from "./provider";
import { outlierScore, velocityPerDay, engagementRate, opportunityScore } from "./outliers";
import { invalidateStrategyCache } from "./strategy-cache";

// Fetch a niche from the active provider, score every video against its channel
// baseline, and upsert into research_videos / research_channels. Idempotent: a
// re-run refreshes views + scores rather than duplicating. Returns a summary.

export type RefreshResult = { niche: string; provider: string | null; fetched: number; stored: number; topOutlier: number | null; note?: string };

export async function refreshNiche(
  niche: string,
  opts: { days?: number; shortsOnly?: boolean; max?: number; site?: string } = {},
): Promise<RefreshResult> {
  const q = niche.trim();
  if (!q) return { niche, provider: null, fetched: 0, stored: 0, topOutlier: null, note: "empty niche" };
  const provider = await getResearchProvider();
  if (!provider) return { niche: q, provider: null, fetched: 0, stored: 0, topOutlier: null, note: "No research data source configured. Add a YouTube Data API key in Settings → Secrets." };

  // Pull a deep pool by default (~120) so the strategy + a full 30-day plan at
  // 5 posts/day have plenty of proven outliers to draw from. ~3 search pages ≈ 300 quota units.
  const videos = await provider.searchNiche(q, { days: opts.days ?? 90, shortsOnly: opts.shortsOnly, max: opts.max ?? 120 });
  if (!videos.length) return { niche: q, provider: provider.platform, fetched: 0, stored: 0, topOutlier: null };

  const channelIds = [...new Set(videos.map((v) => v.channelId).filter((x): x is string => !!x))];
  const baselines = await provider.channelBaselines(channelIds);

  for (const cid of channelIds) {
    const base = baselines.get(cid);
    if (base == null) continue;
    const sample = videos.find((v) => v.channelId === cid);
    await db
      .insert(researchChannels)
      .values({ platform: provider.platform, channelId: cid, title: sample?.channelTitle ?? null, medianViews: base, niche: q })
      .onConflictDoUpdate({ target: [researchChannels.platform, researchChannels.channelId], set: { medianViews: base, title: sample?.channelTitle ?? null, niche: q, fetchedAt: new Date() } });
  }

  let top: number | null = null;
  let stored = 0;
  for (const v of videos) {
    const base = v.channelId ? baselines.get(v.channelId) ?? null : null;
    const score = outlierScore(v.views, base);
    const vel = velocityPerDay(v.views, v.publishedAt);
    const eng = engagementRate(v.views, v.likes, v.comments);
    const opp = opportunityScore({ outlierScore: score, velocity: vel, engagementRate: eng, publishedAt: v.publishedAt });
    if (score != null && (top == null || score > top)) top = score;
    await db
      .insert(researchVideos)
      .values({
        platform: v.platform,
        externalId: v.externalId,
        niche: q,
        site: opts.site ?? null,
        channelId: v.channelId,
        channelTitle: v.channelTitle,
        title: v.title,
        url: v.url,
        thumbnail: v.thumbnail,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        engagementRate: eng,
        publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
        durationSec: v.durationSec,
        isShort: v.isShort,
        outlierScore: score,
        velocity: vel,
        opportunityScore: opp,
      })
      .onConflictDoUpdate({
        target: [researchVideos.platform, researchVideos.externalId, researchVideos.niche],
        set: { views: v.views, likes: v.likes, comments: v.comments, engagementRate: eng, outlierScore: score, velocity: vel, opportunityScore: opp, title: v.title, channelTitle: v.channelTitle, thumbnail: v.thumbnail, fetchedAt: new Date() },
      });
    stored++;
  }
  // Fresh outliers landed — drop any cached strategy so the next analyze/build
  // recomputes against this new data instead of reusing a stale one.
  if (stored > 0) invalidateStrategyCache(q);
  return { niche: q, provider: provider.platform, fetched: videos.length, stored, topOutlier: top };
}

export type OutlierVideo = {
  externalId: string;
  title: string;
  url: string;
  thumbnail: string | null;
  channelTitle: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  engagementRate: number | null;
  outlierScore: number | null;
  velocity: number | null;
  opportunityScore: number | null;
  isShort: boolean;
  publishedAt: string | null;
  format: string | null;
};

/** Top stored outliers for a niche, ranked by the composite opportunity score. */
export async function getOutliers(niche: string, limit = 30): Promise<OutlierVideo[]> {
  const rows = await db
    .select()
    .from(researchVideos)
    .where(eq(researchVideos.niche, niche.trim()))
    .orderBy(desc(researchVideos.opportunityScore), desc(researchVideos.outlierScore), desc(researchVideos.views))
    .limit(limit);
  return rows.map((r) => ({
    externalId: r.externalId,
    title: r.title,
    url: r.url ?? "",
    thumbnail: r.thumbnail,
    channelTitle: r.channelTitle,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    engagementRate: r.engagementRate,
    outlierScore: r.outlierScore,
    velocity: r.velocity,
    opportunityScore: r.opportunityScore,
    isShort: r.isShort,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    format: r.format,
  }));
}
