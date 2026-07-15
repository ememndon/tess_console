import "server-only";
import { getSecretValue } from "../secrets";
import type { RawVideo, SearchOpts, VideoResearchProvider } from "./provider";

// YouTube Data API v3 provider (free quota ~10,000 units/day). Quota notes:
//   search.list  = 100 units   videos.list = 1 unit   channels.list = 1 unit
// So one niche search ≈ 102 units (≈ ~95 searches/day). We batch videos.list and
// channels.list to keep it to two cheap follow-up calls per search.
const API = "https://www.googleapis.com/youtube/v3";

// "Short-form" cutoff. YouTube Shorts now run up to 3 minutes, so treat <=180s as
// short. (Used only for the optional shortsOnly filter + an isShort flag.)
const SHORT_MAX_SEC = 180;

function parseISODuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

type YTSearchItem = { id?: { videoId?: string } };
type YTVideoItem = {
  id?: string;
  snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
};
type YTChannelItem = { id?: string; statistics?: { viewCount?: string; videoCount?: string } };

class YouTubeProvider implements VideoResearchProvider {
  readonly platform = "youtube";
  constructor(private key: string) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ ...params, key: this.key }).toString();
    const r = await fetch(`${API}/${path}?${qs}`);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      if (/quotaExceeded|RESOURCE_EXHAUSTED/i.test(body)) throw new Error("YouTube daily quota exhausted (resets midnight Pacific).");
      if (/API key not valid|keyInvalid/i.test(body)) throw new Error("YouTube API key invalid.");
      if (/accessNotConfigured|SERVICE_DISABLED/i.test(body)) throw new Error("Enable 'YouTube Data API v3' for this key's Google Cloud project.");
      throw new Error(`YouTube API ${r.status}`);
    }
    return (await r.json()) as T;
  }

  async searchNiche(keywords: string, opts: SearchOpts = {}): Promise<RawVideo[]> {
    // Pull "up to" `target` videos. YouTube's search.list caps at 50 ids/page, so
    // for a deeper pool we page through with nextPageToken (each page = 100 units)
    // until we reach the target or run out of results.
    const target = Math.min(200, Math.max(5, opts.max ?? 50));
    const baseParams: Record<string, string> = {
      part: "snippet",
      q: keywords,
      type: "video",
      order: "viewCount",
      relevanceLanguage: "en",
    };
    if (opts.days) baseParams.publishedAfter = new Date(Date.now() - opts.days * 86_400_000).toISOString();
    if (opts.shortsOnly) baseParams.videoDuration = "short"; // YT "short" = < 4 min

    const ids: string[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; ids.length < target && page < 5; page++) {
      const params: Record<string, string> = { ...baseParams, maxResults: String(Math.min(50, target - ids.length)) };
      if (pageToken) params.pageToken = pageToken;
      const search = await this.get<{ items?: YTSearchItem[]; nextPageToken?: string }>("search", params);
      for (const it of search.items ?? []) {
        const id = it.id?.videoId;
        if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
      }
      pageToken = search.nextPageToken;
      if (!pageToken) break;
    }
    if (!ids.length) return [];

    // videos.list accepts up to 50 ids per call — chunk for pools >50.
    const out: RawVideo[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const vids = await this.get<{ items?: YTVideoItem[] }>("videos", {
        part: "snippet,statistics,contentDetails",
        id: chunk.join(","),
        maxResults: "50",
      });
      for (const v of vids.items ?? []) {
        const id = v.id;
        if (!id) continue;
        const durationSec = parseISODuration(v.contentDetails?.duration);
        const isShort = durationSec != null && durationSec <= SHORT_MAX_SEC;
        if (opts.shortsOnly && !isShort) continue;
        const th = v.snippet?.thumbnails ?? {};
        const thumbnail = th.medium?.url ?? th.high?.url ?? th.default?.url ?? null;
        out.push({
          platform: "youtube",
          externalId: id,
          channelId: v.snippet?.channelId ?? null,
          channelTitle: v.snippet?.channelTitle ?? null,
          title: v.snippet?.title ?? "(untitled)",
          url: `https://www.youtube.com/watch?v=${id}`,
          thumbnail,
          views: Number(v.statistics?.viewCount ?? 0),
          likes: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null,
          comments: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
          publishedAt: v.snippet?.publishedAt ?? null,
          durationSec,
          isShort,
        });
      }
    }
    return out;
  }

  async channelBaselines(channelIds: string[]): Promise<Map<string, number>> {
    const uniq = [...new Set(channelIds.filter(Boolean))];
    const out = new Map<string, number>();
    for (let i = 0; i < uniq.length; i += 50) {
      const chunk = uniq.slice(i, i + 50);
      const res = await this.get<{ items?: YTChannelItem[] }>("channels", { part: "statistics", id: chunk.join(","), maxResults: "50" });
      for (const c of res.items ?? []) {
        if (!c.id) continue;
        const views = Number(c.statistics?.viewCount ?? 0);
        const count = Math.max(1, Number(c.statistics?.videoCount ?? 1));
        out.set(c.id, Math.round(views / count)); // lifetime average views per video = cheap baseline
      }
    }
    return out;
  }
}

export async function getYouTubeProvider(): Promise<YouTubeProvider | null> {
  const key = await getSecretValue("youtube_api_key");
  return key ? new YouTubeProvider(key) : null;
}
