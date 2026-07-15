import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contentPlans, contentPlanItems, notifications, settings } from "../db/schema";
import { analyzeNiche, type NicheStrategy } from "./analyze";
import { buildDemandStrategy, mergeBlendBriefs } from "./gsc-demand";
import { getOutliers } from "./ingest";
import { FORMAT_VAULT, formatKind } from "./formats";
import { SITE_META, type SiteKey } from "../site-scope";

export const LOW_BACKLOG_THRESHOLD = 12; // ~2 days at 5 images + 1 video/day

// The 30-day content GRID — a plan of BRIEFS sized to Tess's real cadence: by
// default 5 IMAGE briefs + 1 VIDEO brief per day (= 150 image + 30 video over 30
// days), matching the overnight image pipeline (5 slots) + the daily video. Each
// brief = subtopic x winning format x platform x medium, anchored to a proven
// outlier. The real image/video draft is produced later by generatePlanItem
// (manual "Generate Post" button or the daily auto-gen job).

const FORMAT_PLATFORM: Record<string, string> = {
  hot_take: "x", qa: "x", explainer: "linkedin", case_study: "linkedin", mini_doc: "youtube",
  howto: "youtube", rapid: "instagram", listicle: "instagram", tier_list: "instagram",
  comparison: "instagram", transformation: "instagram", day_in_life: "instagram", myth: "instagram",
  problem_solution: "instagram", mistakes: "instagram", spotlight: "instagram", bts: "instagram",
  storytime: "tiktok", trendjack: "tiktok", challenge: "tiktok", hypothetical: "tiktok",
};
const PLATFORM_HOUR: Record<string, number> = { x: 13, instagram: 18, tiktok: 19, linkedin: 9, facebook: 11, youtube: 16, pinterest: 20 };

export type GridResult = {
  planRef: string;
  site: string;
  niche: string;
  days: number;
  imageCount: number;
  videoCount: number;
  note?: string;
};

// A format pool of {id,name}, strategy winners first then the rest of the vault,
// so we always have enough DISTINCT formats of a kind to vary the daily slots.
function formatPool(kind: "image" | "video", strategyFmts: { id: string; name: string }[]): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const f of strategyFmts) {
    if (formatKind(f.id) === kind && !seen.has(f.id)) { seen.add(f.id); out.push({ id: f.id, name: f.name }); }
  }
  for (const f of FORMAT_VAULT) {
    if (formatKind(f.id) === kind && !seen.has(f.id)) { seen.add(f.id); out.push({ id: f.id, name: f.name }); }
  }
  return out;
}

// Image formats that make strong swipeable carousels (multi-point, text-forward).
// When carousels are enabled for a site, one eligible image slot each day becomes a
// carousel brief (kind "carousel") instead of a single image.
const CAROUSEL_FORMATS = new Set(["listicle", "mistakes", "comparison", "tier_list", "explainer", "myth"]);
const CAROUSEL_SETTING = "carousel_plan";

// Sites that have opted carousels into their plan (owner toggle; default: none, so
// this changes nothing until switched on in the Content Director). Read by the grid
// builder for EVERY caller — the UI, Tess's tool, the REST/MCP API, the daily pipeline.
export async function getCarouselPlanSites(): Promise<Set<string>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, CAROUSEL_SETTING));
  const sites = (row?.value as { sites?: string[] } | undefined)?.sites;
  return new Set(Array.isArray(sites) ? sites.map(String) : []);
}
export async function setCarouselPlanSite(site: string, enabled: boolean): Promise<boolean> {
  const cur = await getCarouselPlanSites();
  if (enabled) cur.add(site);
  else cur.delete(site);
  const value = { sites: [...cur] };
  await db.insert(settings).values({ key: CAROUSEL_SETTING, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return enabled;
}

export async function buildContentCalendar(opts: {
  site: string;
  niche?: string;
  days?: number;
  imagesPerDay?: number;
  videosPerDay?: number;
  startAt?: string;
  createdBy?: string;
  source?: "youtube" | "gsc" | "blend"; // "gsc" = the site's own Search Console demand; "blend" = both
}): Promise<GridResult> {
  const site = opts.site;
  const source = opts.source ?? "youtube";
  const days = Math.min(30, Math.max(3, opts.days ?? 30));
  const imagesPerDay = Math.min(8, Math.max(1, opts.imagesPerDay ?? 5)); // matches the 5 overnight image slots
  const videosPerDay = Math.min(3, Math.max(0, opts.videosPerDay ?? 1)); // matches the 1 daily video
  const carouselOn = (await getCarouselPlanSites()).has(site); // opt-in; off by default

  // Build the strategy from the chosen SIGNAL. "gsc" mines the site's own Search
  // Console demand (real queries + a target URL per brief); "youtube" reuses the
  // outlier-mining strategy (cached from a recent Analyze, or freshly analyzed).
  // Both emit the same NicheStrategy shape, so everything below is identical.
  let strategy: NicheStrategy;
  // Per-subtopic anchors, aligned 1:1 with strategy.subtopics. Set for gsc/blend
  // (GSC query+URL or a YouTube outlier); null = the YouTube path picks an outlier
  // per cell by format (the original behaviour).
  let anchors: (Record<string, unknown> | null)[] | null = null;
  let niche: string;
  if (source === "gsc") {
    const demand = await buildDemandStrategy(site);
    if (demand.subtopics.length < 3) {
      return { planRef: "", site, niche: demand.niche, days, imageCount: 0, videoCount: 0, note: demand.note ?? "Not enough Google Search demand to build a plan yet." };
    }
    strategy = demand;
    anchors = demand.clusters as unknown as (Record<string, unknown> | null)[];
    niche = demand.niche;
  } else if (source === "blend") {
    const ytNiche = (opts.niche ?? "").trim();
    const gscStrat = await buildDemandStrategy(site);
    const ytStrat = ytNiche ? await analyzeNiche(ytNiche, { site, allowCache: true }) : null;
    const ytOutliers = ytNiche ? await getOutliers(ytNiche, 60) : [];
    const gscOk = gscStrat.subtopics.length >= 3;
    const ytOk = !!ytStrat && ytStrat.subtopics.length >= 2 && ytStrat.formats.length >= 1 && ytOutliers.length > 0;
    if (!gscOk && !ytOk) {
      return { planRef: "", site, niche: "Blended (Search + YouTube)", days, imageCount: 0, videoCount: 0, note: gscStrat.note ?? "Neither Google Search nor YouTube has enough data yet. Add a niche and Research it, or connect Search Console." };
    }
    if (gscOk && !ytOk) {
      // Only Search has data — behave like the gsc source.
      strategy = gscStrat;
      anchors = gscStrat.clusters as unknown as (Record<string, unknown> | null)[];
      niche = gscStrat.niche;
    } else if (!gscOk && ytStrat) {
      // Only YouTube has data — behave like the youtube source.
      strategy = ytStrat;
      anchors = null;
      niche = ytNiche;
    } else if (ytStrat) {
      const merged = mergeBlendBriefs(gscStrat, ytStrat, ytOutliers, 0.6);
      strategy = { niche: "Blended (Search + YouTube)", analyzedVideos: ytOutliers.length, summary: merged.summary, subtopics: merged.subs, formats: merged.formats, hookPatterns: merged.hookPatterns, model: null };
      anchors = merged.anchors;
      niche = strategy.niche;
    } else {
      strategy = gscStrat;
      anchors = gscStrat.clusters as unknown as (Record<string, unknown> | null)[];
      niche = gscStrat.niche;
    }
  } else {
    niche = (opts.niche ?? "").trim();
    strategy = await analyzeNiche(niche, { site, allowCache: true });
    if (strategy.subtopics.length < 2 || strategy.formats.length < 1) {
      return { planRef: "", site, niche, days, imageCount: 0, videoCount: 0, note: strategy.note ?? "Not enough strategy to build a grid. Run research_niche first." };
    }
  }

  const subs = strategy.subtopics;
  const imgPool = formatPool("image", strategy.formats);
  const vidPool = formatPool("video", strategy.formats);
  // Only needed when anchors is null (the per-cell YouTube outlier match).
  const outliers = anchors ? [] : await getOutliers(niche, 60);
  const start = opts.startAt ? new Date(opts.startAt) : new Date(Date.now() + 86_400_000);
  start.setUTCHours(0, 0, 0, 0);

  const planRef = `CD${Math.floor(100000 + Math.random() * 900000)}`;
  const rows: (typeof contentPlanItems.$inferInsert)[] = [];

  const cell = (i: number, k: number, kind: "image" | "video", pool: { id: string; name: string }[], hour: number, allowCarousel = false) => {
    const sub = subs[k % subs.length];
    const fmt = pool.length ? pool[k % pool.length] : { id: kind === "video" ? "spotlight" : "listicle", name: kind === "video" ? "Spotlight" : "Listicle" };
    // Turn an eligible image slot into a swipeable Instagram carousel brief when the
    // site has opted in; every other slot is unchanged.
    const asCarousel = allowCarousel && kind === "image" && CAROUSEL_FORMATS.has(fmt.id);
    const rowKind = asCarousel ? "carousel" : kind;
    const platform = asCarousel ? "instagram" : (FORMAT_PLATFORM[fmt.id] ?? "instagram");
    const when = new Date(start);
    when.setUTCDate(when.getUTCDate() + i);
    when.setUTCHours(PLATFORM_HOUR[platform] ?? hour, 0, 0, 0);
    // Anchor the brief: a GSC demand cluster (real query + target URL) or a proven
    // YouTube outlier. Both live in the same sourceVideo jsonb (a tagged union) so
    // no migration is needed. When anchors is preset (gsc/blend) it is aligned to
    // the subtopic; otherwise (youtube) pick an outlier by format at cell time.
    let anchor: Record<string, unknown> | null;
    if (anchors) {
      const a = anchors[k % anchors.length];
      anchor = a ? { ...a } : null;
    } else {
      const v = outliers.find((o) => o.format === fmt.id) ?? outliers[k % Math.max(1, outliers.length)] ?? null;
      anchor = v ? { title: v.title, url: v.url, outlierScore: v.outlierScore } : null;
    }
    rows.push({
      planRef, site, niche,
      dayIndex: i,
      dayDate: when.toISOString().slice(0, 10),
      subtopic: sub.title,
      formatId: fmt.id,
      formatName: fmt.name,
      platform,
      kind: rowKind,
      priority: Math.max(0, Math.min(100, Math.round(sub.strength))), // strongest subtopics generate first across all niches
      angle: sub.pattern || null,
      sourceVideo: anchor,
      status: "planned",
    });
  };

  let imgK = 0;
  let vidK = 0;
  for (let i = 0; i < days; i++) {
    for (let j = 0; j < imagesPerDay; j++) cell(i, imgK++, "image", imgPool, 17, carouselOn && j === 0);
    for (let j = 0; j < videosPerDay; j++) cell(i, vidK++, "video", vidPool, 16);
  }

  // Batch the inserts (180 rows) so building a full plan stays fast.
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(contentPlanItems).values(rows.slice(i, i + 100));
  }
  const imageCount = rows.filter((r) => r.kind === "image" || r.kind === "carousel").length; // carousels are image posts
  const videoCount = rows.filter((r) => r.kind === "video").length;
  const carouselCount = rows.filter((r) => r.kind === "carousel").length;

  await db.insert(contentPlans).values({
    ref: planRef,
    site,
    niche,
    status: "active",
    createdBy: opts.createdBy ?? "tess",
    summary: {
      days,
      imagesPerDay,
      videosPerDay,
      imageCount,
      videoCount,
      carouselCount,
      source,
      summary: strategy.summary,
      subtopics: subs.map((s) => ({ rank: s.rank, title: s.title, saturation: s.saturation })),
      formats: strategy.formats.map((f) => ({ id: f.id, name: f.name, winShare: f.winShare })),
      hookPatterns: strategy.hookPatterns,
    },
  });

  return { planRef, site, niche, days, imageCount, videoCount };
}

export type PlanItem = {
  id: string;
  planRef: string;
  niche: string | null;
  dayIndex: number;
  dayDate: string | null;
  subtopic: string;
  formatId: string | null;
  formatName: string | null;
  platform: string | null;
  kind: string;
  priority: number;
  status: string;
  postRef: string | null;
  sourceVideo: { title?: string; url?: string; outlierScore?: number | null; kind?: string; query?: string; position?: number; impressions?: number; pool?: string } | null;
};

function toPlanItem(r: typeof contentPlanItems.$inferSelect): PlanItem {
  return {
    id: r.id,
    planRef: r.planRef,
    niche: r.niche,
    dayIndex: r.dayIndex,
    dayDate: r.dayDate,
    subtopic: r.subtopic,
    formatId: r.formatId,
    formatName: r.formatName,
    platform: r.platform,
    kind: r.kind,
    priority: r.priority,
    status: r.status,
    postRef: r.postRef,
    sourceVideo: (r.sourceVideo as PlanItem["sourceVideo"]) ?? null,
  };
}

export async function getPlanItems(planRef: string): Promise<PlanItem[]> {
  const rows = await db.select().from(contentPlanItems).where(eq(contentPlanItems.planRef, planRef)).orderBy(asc(contentPlanItems.dayIndex));
  return rows.map(toPlanItem);
}

/** The most recent active plan's items for a site (for the Content Director UI). */
export async function getLatestPlanItems(site: string): Promise<{ planRef: string | null; items: PlanItem[] }> {
  const [plan] = await db.select().from(contentPlans).where(and(eq(contentPlans.site, site), eq(contentPlans.status, "active"))).orderBy(desc(contentPlans.createdAt)).limit(1);
  if (!plan?.ref) return { planRef: null, items: [] };
  return { planRef: plan.ref, items: await getPlanItems(plan.ref) };
}

// The next still-unmade brief for a site (optionally of one medium). Ordered for
// DAILY VARIETY: by dayIndex first (the grid lays each day out with DIFFERENT
// subtopics), then priority (subtopic strength) as the tiebreak — so Tess rotates
// across subtopics day to day, strongest first, instead of exhausting one subtopic
// for a week. Spans EVERY plan for the site (all niches share one pool); the
// generic pillars/rotation are only the fallback when the pool is empty.
export async function nextPlannedItem(site: string, kind?: "image" | "video"): Promise<PlanItem | null> {
  const conds = [eq(contentPlanItems.site, site), eq(contentPlanItems.status, "planned")];
  if (kind) conds.push(eq(contentPlanItems.kind, kind));
  const [row] = await db.select().from(contentPlanItems).where(and(...conds))
    .orderBy(asc(contentPlanItems.dayIndex), desc(contentPlanItems.priority), asc(contentPlanItems.createdAt)).limit(1);
  return row ? toPlanItem(row) : null;
}

// The whole live backlog for a site across ALL its plans (every niche), ordered
// for daily variety (dayIndex, then priority) — the SAME order Tess generates in,
// so the UI shows exactly what's coming next. Planned items first, then in-flight.
export async function getSiteBacklog(site: string, limit = 2000): Promise<PlanItem[]> {
  const rows = await db.select().from(contentPlanItems).where(eq(contentPlanItems.site, site))
    .orderBy(asc(contentPlanItems.dayIndex), desc(contentPlanItems.priority), asc(contentPlanItems.createdAt)).limit(limit);
  const order: Record<string, number> = { planned: 0, generating: 1, failed: 2, queued: 3, generated: 4 };
  return rows.map(toPlanItem).sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));
}

export async function getContentPlan(ref: string) {
  const [plan] = await db.select().from(contentPlans).where(eq(contentPlans.ref, ref.trim())).limit(1);
  if (!plan) return null;
  return { ...plan, items: await getPlanItems(ref.trim()) };
}

/** Planned (not-yet-made) briefs left for a site, by medium. */
export async function countPlannedBriefs(site: string): Promise<{ image: number; video: number; total: number }> {
  const rows = await db
    .select({ kind: contentPlanItems.kind, c: sql<number>`count(*)::int` })
    .from(contentPlanItems)
    .where(and(eq(contentPlanItems.site, site), eq(contentPlanItems.status, "planned")))
    .groupBy(contentPlanItems.kind);
  let image = 0, video = 0;
  for (const r of rows) { if (r.kind === "video") video += Number(r.c); else image += Number(r.c); }
  return { image, video, total: image + video };
}

/** Notify the admin when a site's planned-brief backlog runs low (or empty) so a
 * new plan can be built before Tess falls back to the generic pillars. Deduped to
 * at most once per 18h per site (settings.content_backlog_warned). Called from the
 * daily pipeline as it consumes briefs. */
export async function flagLowBacklogIfNeeded(site: string): Promise<void> {
  const { image, video, total } = await countPlannedBriefs(site);
  if (total > LOW_BACKLOG_THRESHOLD) return;
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "content_backlog_warned"));
  const warned = (row?.value as Record<string, string>) ?? {};
  if (warned[site] && Date.now() - new Date(warned[site]).getTime() < 18 * 3_600_000) return; // warned recently
  const name = SITE_META[site as SiteKey]?.name ?? site;
  const days = Math.max(1, Math.round(image / 5));
  await db.insert(notifications).values(
    total === 0
      ? { severity: "warning", title: `📭 Content backlog empty — ${name}`, body: `No planned briefs left, so Tess is now falling back to the generic content pillars. Open Content Director, research a niche and Build a plan to refill the backlog.`, module: "content" }
      : { severity: "info", title: `📉 Content backlog running low — ${name}`, body: `Only ${total} planned briefs left (${image} image, ${video} video — about ${days} day${days === 1 ? "" : "s"} at the current pace). Build another plan in Content Director soon so Tess keeps posting on-strategy.`, module: "content" },
  );
  warned[site] = new Date().toISOString();
  await db.insert(settings).values({ key: "content_backlog_warned", value: warned }).onConflictDoUpdate({ target: settings.key, set: { value: warned, updatedAt: new Date() } });
}

export async function listContentPlans(site?: string) {
  const rows = site
    ? await db.select().from(contentPlans).where(eq(contentPlans.site, site)).orderBy(desc(contentPlans.createdAt)).limit(20)
    : await db.select().from(contentPlans).orderBy(desc(contentPlans.createdAt)).limit(20);
  return rows;
}
