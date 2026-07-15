import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { brandProfiles, socialPosts } from "./db/schema";

// A unique human-friendly 6-digit Post ID for referencing a post in chat ("fix
// post #483920"). Retries on the (rare) collision; a video's 3 formats share the
// post row, so they share one ref.
export async function newPostRef(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const ref = String(Math.floor(100000 + Math.random() * 900000));
    const [hit] = await db.select({ id: socialPosts.id }).from(socialPosts).where(eq(socialPosts.ref, ref)).limit(1);
    if (!hit) return ref;
  }
  return String(Date.now()).slice(-6);
}
import type { SiteScope } from "./site-scope";
import type { BrandProfile, PlatformConfig, QueuePost, Platform } from "./social-types";

// Social Studio server queries. Client-safe constants/types live in
// ./social-types and are re-exported here for convenience.
export * from "./social-types";

const siteCond = (scope: SiteScope, col = "site"): SQL =>
  scope === "all" ? sql`true` : sql`${sql.raw(col)} = ${scope}`;
type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

export async function getBrandProfiles(scope: SiteScope): Promise<BrandProfile[]> {
  const res = await db.select().from(brandProfiles);
  return res
    .filter((b) => scope === "all" || b.site === scope)
    .sort((a, b) => a.site.localeCompare(b.site))
    .map((b) => ({
      site: b.site,
      voice: b.voice,
      audience: b.audience,
      hashtags: (b.hashtags as string[]) ?? [],
      ctaUrl: b.ctaUrl,
      notFinancialAdvice: b.notFinancialAdvice,
      contentMix: (b.contentMix as BrandProfile["contentMix"]) ?? { text: 50, banner: 35, video: 15 },
    }));
}

export async function getSocialConfig(scope: SiteScope): Promise<PlatformConfig[]> {
  const res = await rows(sql`
    SELECT c.site, c.platform, c.enabled, c.mode, c.per_day, c.times,
      coalesce(a.connected, false) AS connected, a.handle,
      coalesce(t.paused, false) AS paused, t.paused_reason
    FROM social_config c
    LEFT JOIN social_accounts a ON a.site = c.site AND a.platform = c.platform
    LEFT JOIN platform_throttle t ON t.site = c.site AND t.platform = c.platform
    WHERE ${siteCond(scope, "c.site")}
    ORDER BY c.site, c.platform
  `);
  return res.map((r) => ({
    site: String(r.site),
    platform: r.platform as Platform,
    enabled: Boolean(r.enabled),
    mode: r.mode === "autonomous" ? "autonomous" : "handoff",
    perDay: Number(r.per_day),
    times: (r.times as string[]) ?? [],
    connected: Boolean(r.connected),
    handle: r.handle == null ? null : String(r.handle),
    paused: Boolean(r.paused),
    pausedReason: r.paused_reason == null ? null : String(r.paused_reason),
  }));
}

export async function getQueue(scope: SiteScope, limit = 60): Promise<QueuePost[]> {
  const posts = await rows(sql`
    SELECT id, ref, site, kind, caption, status, scheduled_at, created_by, created_at, data
    FROM social_posts WHERE ${siteCond(scope)}
    ORDER BY coalesce(scheduled_at, created_at) DESC
    LIMIT ${limit}
  `);
  if (posts.length === 0) return [];
  const ids = posts.map((p) => String(p.id));
  // Brand default hashtags per site, for posts that don't carry an explicit override.
  const sites = [...new Set(posts.map((p) => String(p.site)))];
  const brandRows = await rows(sql`
    SELECT site, hashtags FROM brand_profiles WHERE site IN (${sql.join(sites.map((s) => sql`${s}`), sql`, `)})
  `);
  const brandTags = new Map(brandRows.map((b) => [String(b.site), Array.isArray(b.hashtags) ? (b.hashtags as unknown[]).map(String) : []]));
  const tg = await rows(sql`
    SELECT post_id, platform, mode, status, external_url, error FROM social_targets
    WHERE post_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
  const md = await rows(sql`
    SELECT id, post_id, type, path FROM social_media
    WHERE post_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
    ORDER BY idx, created_at
  `);
  return posts.map((p) => ({
    id: String(p.id),
    ref: p.ref == null ? null : String(p.ref),
    site: String(p.site),
    kind: p.kind as QueuePost["kind"],
    caption: p.caption == null ? null : String(p.caption),
    headline: ((p.data as Record<string, unknown> | null)?.headline as string) ?? null,
    subhead: ((p.data as Record<string, unknown> | null)?.subhead as string) ?? null,
    bannerStyle: ((p.data as Record<string, unknown> | null)?.bannerStyle as QueuePost["bannerStyle"]) ?? null,
    status: String(p.status),
    scheduledAt: p.scheduled_at ? new Date(p.scheduled_at as string).toISOString() : null,
    createdBy: String(p.created_by),
    createdAt: new Date(p.created_at as string).toISOString(),
    targets: tg
      .filter((t) => String(t.post_id) === String(p.id))
      .map((t) => ({
        platform: t.platform as Platform,
        mode: String(t.mode),
        status: String(t.status),
        externalUrl: t.external_url == null ? null : String(t.external_url),
        error: t.error == null ? null : String(t.error),
      })),
    media: md
      .filter((m) => String(m.post_id) === String(p.id))
      // Cache-bust with the media row id. A banner re-render deletes+reinserts the
      // row (new id), so the URL changes and the browser/SW fetch the new image
      // instead of a stale cached one.
      .map((m) => ({ type: String(m.type), path: String(m.path), url: `/api/media/${toRel(String(m.path))}?v=${String(m.id).slice(0, 8)}` })),
    review: reviewOf(p.data),
    hashtags: hashtagsOf(p.data) ?? brandTags.get(String(p.site)) ?? [],
    carousel: carouselOf(p.data),
  }));
}

// Pull the editable carousel slide defs out of the post's data blob (only present
// on carousel posts saved with persisted slide defs). Powers the per-slide editor.
function carouselOf(data: unknown): QueuePost["carousel"] {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.format !== "carousel" || !Array.isArray(d.slideDefs)) return null;
  const slides = (d.slideDefs as unknown[])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const kind = o.kind === "cover" || o.kind === "cta" ? o.kind : "point";
      return { kind: kind as "cover" | "point" | "cta", title: String(o.title ?? ""), body: o.body ? String(o.body) : undefined };
    })
    .filter((s) => s.title);
  if (slides.length < 3) return null;
  const style = d.style === "minimal" || d.style === "editorial" ? d.style : "bold";
  return { aspect: d.aspect === "square" ? "square" : "portrait", style, slides };
}

// Pull the pre-publish quality guard result out of the post's data blob.
function reviewOf(data: unknown): QueuePost["review"] {
  if (!data || typeof data !== "object") return null;
  const r = (data as { review?: { ok?: unknown; flags?: unknown } }).review;
  if (!r || typeof r !== "object") return null;
  return { ok: r.ok !== false, flags: Array.isArray(r.flags) ? r.flags.map(String) : [] };
}

// A per-post hashtags override, if the owner edited it; null → use brand default.
function hashtagsOf(data: unknown): string[] | null {
  if (!data || typeof data !== "object") return null;
  const h = (data as { hashtags?: unknown }).hashtags;
  return Array.isArray(h) ? h.map(String) : null;
}

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/app/media";
const toRel = (abs: string) => (abs.startsWith(MEDIA_ROOT + "/") ? abs.slice(MEDIA_ROOT.length + 1) : abs);

export type HandoffItem = {
  targetId: string;
  postId: string;
  ref: string | null;
  site: string;
  platform: Platform;
  caption: string | null;
  createdAt: string;
  media: { type: string; url: string }[];
};

export async function getHandoffItems(scope: SiteScope): Promise<HandoffItem[]> {
  const items = await rows(sql`
    SELECT st.id AS target_id, p.id AS post_id, p.ref, p.site, st.platform, p.caption, p.created_at
    FROM social_targets st JOIN social_posts p ON p.id = st.post_id
    WHERE ${siteCond(scope, "p.site")} AND st.status = 'handoff'
    ORDER BY p.created_at DESC
    LIMIT 100
  `);
  if (items.length === 0) return [];
  const postIds = [...new Set(items.map((i) => String(i.post_id)))];
  const md = await rows(sql`
    SELECT post_id, type, path FROM social_media
    WHERE post_id IN (${sql.join(postIds.map((i) => sql`${i}::uuid`), sql`, `)})
  `);
  return items.map((i) => ({
    targetId: String(i.target_id),
    postId: String(i.post_id),
    ref: i.ref == null ? null : String(i.ref),
    site: String(i.site),
    platform: i.platform as Platform,
    caption: i.caption == null ? null : String(i.caption),
    createdAt: new Date(i.created_at as string).toISOString(),
    media: md
      .filter((m) => String(m.post_id) === String(i.post_id))
      .map((m) => ({ type: String(m.type), url: `/api/media/${toRel(String(m.path))}` })),
  }));
}

export type CalendarPost = {
  id: string;
  site: string;
  kind: string;
  caption: string | null;
  status: string;
  at: string; // ISO — scheduledAt or createdAt
  platforms: Platform[];
};

export async function getCalendarPosts(scope: SiteScope, fromISO: string, toISO: string): Promise<CalendarPost[]> {
  const res = await rows(sql`
    SELECT p.id, p.site, p.kind, p.caption, p.status,
      coalesce(p.scheduled_at, p.created_at) AS at,
      array_remove(array_agg(DISTINCT st.platform), NULL) AS platforms
    FROM social_posts p
    LEFT JOIN social_targets st ON st.post_id = p.id
    WHERE ${siteCond(scope)}
      AND coalesce(p.scheduled_at, p.created_at) >= ${fromISO}::timestamptz
      AND coalesce(p.scheduled_at, p.created_at) < ${toISO}::timestamptz
    GROUP BY p.id
    ORDER BY at
  `);
  return res.map((r) => ({
    id: String(r.id),
    site: String(r.site),
    kind: String(r.kind),
    caption: r.caption == null ? null : String(r.caption),
    status: String(r.status),
    at: new Date(r.at as string).toISOString(),
    platforms: ((r.platforms as string[]) ?? []) as Platform[],
  }));
}

export async function getStudioCounts(scope: SiteScope) {
  const [r] = await rows(sql`
    SELECT
      (SELECT count(*) FROM social_posts WHERE ${siteCond(scope)} AND status IN ('scheduled','ready'))::int AS scheduled,
      (SELECT count(*) FROM social_targets st JOIN social_posts p ON p.id = st.post_id WHERE ${siteCond(scope, "p.site")} AND st.status = 'handoff')::int AS handoff,
      (SELECT count(*) FROM social_targets st JOIN social_posts p ON p.id = st.post_id WHERE ${siteCond(scope, "p.site")} AND st.status = 'published')::int AS published,
      (SELECT count(*) FROM platform_throttle WHERE ${siteCond(scope)} AND paused)::int AS paused
  `);
  return {
    scheduled: Number(r?.scheduled ?? 0),
    handoff: Number(r?.handoff ?? 0),
    published: Number(r?.published ?? 0),
    paused: Number(r?.paused ?? 0),
  };
}
