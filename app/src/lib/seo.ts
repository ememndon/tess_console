import "server-only";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { secrets, settings } from "./db/schema";
import { ALGO_UPDATES } from "./analytics";
import type { SiteScope } from "./site-scope";

// SEO Center queries. The GSC-powered views (search performance,
// index coverage, opportunities, backlinks) light up once Search Console is
// connected; what's here works from sitemaps + the analytics stream now.

// `col` qualifies the site column — needed when a query joins a subquery that also
// exposes `site` (otherwise a scoped filter is ambiguous and Postgres errors).
const siteCond = (scope: SiteScope, col = "site"): SQL => (scope === "all" ? sql`true` : sql`${sql.raw(col)} = ${scope}`);
type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

export type Directory = {
  id: string;
  name: string;
  url: string;
  category: string;
  site: string;
  status: "todo" | "submitted" | "listed" | "rejected" | "na";
  link: string | null;
  notes: string | null;
};

export async function getDirectories(scope: SiteScope): Promise<Directory[]> {
  const res = await rows(sql`
    SELECT id, name, url, category, site, status, link, notes
    FROM directory_listings
    WHERE ${siteCond(scope)}
    ORDER BY category, name, site
  `);
  return res.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    url: String(r.url),
    category: String(r.category),
    site: String(r.site),
    status: r.status as Directory["status"],
    link: r.link == null ? null : String(r.link),
    notes: r.notes == null ? null : String(r.notes),
  }));
}

export type ContentPage = {
  site: string;
  url: string;
  path: string;
  views30d: number;
  indexed: boolean | null;
  lastmod: string | null;
};

export async function getContentInventory(scope: SiteScope): Promise<{
  pages: ContentPage[];
  summary: { total: number; withTraffic: number; noTraffic: number; indexUnknown: number };
}> {
  const res = await rows(sql`
    SELECT cp.site, cp.url, cp.path, cp.lastmod, cp.indexed, coalesce(pv.views, 0)::int AS views
    FROM content_pages cp
    LEFT JOIN (
      SELECT site, path, count(*) AS views FROM events
      WHERE type='pageview' AND created_at >= now() - interval '30 days'
      GROUP BY site, path
    ) pv ON pv.site = cp.site AND pv.path = cp.path
    WHERE ${siteCond(scope, "cp.site")}
    ORDER BY views DESC, cp.path
    LIMIT 2000
  `);
  const pages: ContentPage[] = res.map((r) => ({
    site: String(r.site),
    url: String(r.url),
    path: String(r.path),
    views30d: Number(r.views),
    indexed: r.indexed == null ? null : Boolean(r.indexed),
    lastmod: r.lastmod ? new Date(r.lastmod as string).toISOString() : null,
  }));
  const withTraffic = pages.filter((p) => p.views30d > 0).length;
  return {
    pages,
    summary: {
      total: pages.length,
      withTraffic,
      noTraffic: pages.length - withTraffic,
      indexUnknown: pages.filter((p) => p.indexed == null).length,
    },
  };
}

export type GscSiteCfg = { enabled: boolean; property?: string; note?: string };
export type GscConnection = {
  keySet: boolean;
  connected: boolean; // key present and last test passed
  sites: Record<string, GscSiteCfg>;
};

export async function getGscConnection(): Promise<GscConnection> {
  const [s] = await db.select({ status: secrets.status }).from(secrets).where(eq(secrets.key, "gsc_service_account"));
  const [cfg] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "gsc_sites"));
  return {
    keySet: !!s,
    connected: s?.status === "ok",
    sites: (cfg?.value as Record<string, GscSiteCfg>) ?? {},
  };
}

// ── GSC-powered queries (populated by the sync) ──────────────────────────────

export type GscPoint = { t: string; clicks: number; impressions: number };
export type GscPerformance = {
  points: GscPoint[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  prevClicks: number;
  prevImpressions: number;
};

// Search performance over a selectable window (days). The trend points and all
// KPIs respect the window; the previous-period comparison uses the same length.
// gsc_daily holds ~16 months of per-day rows, so any range resolves from storage.
export async function getGscPerformance(scope: SiteScope, days = 28): Promise<GscPerformance> {
  const pts = await rows(sql`
    SELECT day::text AS t, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions
    FROM gsc_daily
    WHERE ${siteCond(scope)} AND day >= current_date - make_interval(days => ${days})
    GROUP BY day ORDER BY day
  `);
  const [tot] = await rows(sql`
    SELECT
      sum(clicks) FILTER (WHERE day >= current_date - make_interval(days => ${days}))::int AS c,
      sum(impressions) FILTER (WHERE day >= current_date - make_interval(days => ${days}))::int AS i,
      sum(clicks) FILTER (WHERE day >= current_date - make_interval(days => ${days * 2}) AND day < current_date - make_interval(days => ${days}))::int AS cprev,
      sum(impressions) FILTER (WHERE day >= current_date - make_interval(days => ${days * 2}) AND day < current_date - make_interval(days => ${days}))::int AS iprev,
      (sum(position * impressions) FILTER (WHERE day >= current_date - make_interval(days => ${days}))
        / nullif(sum(impressions) FILTER (WHERE day >= current_date - make_interval(days => ${days})), 0)) AS pos
    FROM gsc_daily WHERE ${siteCond(scope)}
  `);
  const clicks = Number(tot?.c ?? 0);
  const impressions = Number(tot?.i ?? 0);
  return {
    points: pts.map((r) => ({ t: String(r.t), clicks: Number(r.clicks), impressions: Number(r.impressions) })),
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: tot?.pos == null ? null : Number(tot.pos),
    prevClicks: Number(tot?.cprev ?? 0),
    prevImpressions: Number(tot?.iprev ?? 0),
  };
}

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };

// Top queries/pages over a selectable window, aggregated from the per-day
// breakdown tables. CTR and position are impression-weighted (rates can't be
// summed). gsc_query_daily/gsc_page_daily hold ~90 days, so any pill resolves.
async function gscTopDaily(
  scope: SiteScope,
  table: "gsc_query_daily" | "gsc_page_daily",
  col: string,
  days: number,
  limit: number,
): Promise<GscRow[]> {
  const res = await rows(sql`
    SELECT ${sql.raw(col)} AS key,
      sum(clicks)::int AS clicks,
      sum(impressions)::int AS impressions,
      sum(clicks)::float / nullif(sum(impressions), 0) AS ctr,
      sum(position * impressions) / nullif(sum(impressions), 0) AS position
    FROM ${sql.raw(table)}
    WHERE ${siteCond(scope)} AND day >= current_date - make_interval(days => ${days})
    GROUP BY ${sql.raw(col)}
    ORDER BY sum(clicks) DESC, sum(impressions) DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({
    key: String(r.key),
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  }));
}

export const getTopQueries = (s: SiteScope, days = 28, limit = 25) => gscTopDaily(s, "gsc_query_daily", "query", days, limit);
export const getTopGscPages = (s: SiteScope, days = 28, limit = 25) => gscTopDaily(s, "gsc_page_daily", "page", days, limit);

export type Opportunity = GscRow & { site: string };

export async function getOpportunities(scope: SiteScope, limit = 25): Promise<Opportunity[]> {
  const res = await rows(sql`
    SELECT site, query AS key, clicks, impressions, ctr, position
    FROM gsc_queries
    WHERE ${siteCond(scope)} AND position BETWEEN 8 AND 25 AND impressions > 0
    ORDER BY impressions * (26 - position) DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({
    site: String(r.site),
    key: String(r.key),
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    ctr: Number(r.ctr ?? 0),
    position: Number(r.position ?? 0),
  }));
}

export type IndexCoverage = { site: string; total: number; indexed: number };

export async function getIndexCoverage(scope: SiteScope): Promise<IndexCoverage[]> {
  const res = await rows(sql`
    SELECT site, count(*)::int AS total, count(*) FILTER (WHERE indexed)::int AS indexed
    FROM content_pages WHERE ${siteCond(scope)} GROUP BY site ORDER BY site
  `);
  return res.map((r) => ({ site: String(r.site), total: Number(r.total), indexed: Number(r.indexed) }));
}

// CTR opportunities: queries already ranking on page 1 (≤10) with real
// impressions but a weak click-through — the title/meta isn't winning the click.
// Distinct from striking-distance (8–25), which is about ranking, not CTR.
export async function getCtrOpportunities(scope: SiteScope, limit = 10): Promise<Opportunity[]> {
  const res = await rows(sql`
    SELECT site, query AS key, clicks, impressions, ctr, position
    FROM gsc_queries
    WHERE ${siteCond(scope)} AND position <= 10 AND impressions >= 30
      AND (clicks::float / nullif(impressions, 0)) < 0.03
    ORDER BY impressions DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({
    site: String(r.site), key: String(r.key),
    clicks: Number(r.clicks), impressions: Number(r.impressions),
    ctr: Number(r.ctr ?? 0), position: Number(r.position ?? 0),
  }));
}

// ── Diagnosis ────────────────────────────────────────────────────────────────
// The dashboard answers "what does Search Console show?". This answers "WHY did
// search traffic move?" — the SEO analog of getTrafficDiagnosis. Period-over-
// period: which QUERIES and PAGES gained/lost clicks, which queries SLIPPED in
// rank, where you rank but don't get the click (CTR gaps), striking-distance
// wins, index gaps, overlapping Google updates — and whether GSC is even
// connected for the site (so a disconnected site never reads as "zero traffic").

export type GscMover = {
  key: string;
  curClicks: number; prevClicks: number; clicksDelta: number;
  curImpr: number; prevImpr: number;
  curPos: number | null; prevPos: number | null; posDelta: number | null;
};

const pct = (cur: number, prev: number): number | null =>
  prev === 0 ? (cur > 0 ? 100 : null) : Math.round(((cur - prev) / prev) * 1000) / 10;

// Per-query/page change between the last `days` and the `days` before it:
// clicks, impressions and impression-weighted position in each window.
async function gscMovers(scope: SiteScope, table: "gsc_query_daily" | "gsc_page_daily", col: string, days: number): Promise<GscMover[]> {
  const res = await rows(sql`
    WITH cur AS (
      SELECT ${sql.raw(col)} AS key, sum(clicks)::int AS c, sum(impressions)::int AS i,
        sum(position * impressions) / nullif(sum(impressions), 0) AS pos
      FROM ${sql.raw(table)}
      WHERE ${siteCond(scope)} AND day >= current_date - make_interval(days => ${days})
      GROUP BY ${sql.raw(col)}
    ), prev AS (
      SELECT ${sql.raw(col)} AS key, sum(clicks)::int AS c, sum(impressions)::int AS i,
        sum(position * impressions) / nullif(sum(impressions), 0) AS pos
      FROM ${sql.raw(table)}
      WHERE ${siteCond(scope)} AND day >= current_date - make_interval(days => ${days * 2})
        AND day < current_date - make_interval(days => ${days})
      GROUP BY ${sql.raw(col)}
    )
    SELECT coalesce(cur.key, prev.key) AS key,
      coalesce(cur.c, 0)::int AS cur_clicks, coalesce(prev.c, 0)::int AS prev_clicks,
      coalesce(cur.i, 0)::int AS cur_impr, coalesce(prev.i, 0)::int AS prev_impr,
      cur.pos AS cur_pos, prev.pos AS prev_pos
    FROM cur FULL OUTER JOIN prev ON cur.key = prev.key
    WHERE coalesce(cur.key, prev.key) IS NOT NULL
    ORDER BY greatest(coalesce(cur.i, 0), coalesce(prev.i, 0)) DESC
    LIMIT 250
  `);
  return res.map((r) => {
    const curPos = r.cur_pos == null ? null : Math.round(Number(r.cur_pos) * 10) / 10;
    const prevPos = r.prev_pos == null ? null : Math.round(Number(r.prev_pos) * 10) / 10;
    const curClicks = Number(r.cur_clicks), prevClicks = Number(r.prev_clicks);
    return {
      key: String(r.key),
      curClicks, prevClicks, clicksDelta: curClicks - prevClicks,
      curImpr: Number(r.cur_impr), prevImpr: Number(r.prev_impr),
      curPos, prevPos,
      posDelta: curPos != null && prevPos != null ? Math.round((curPos - prevPos) * 10) / 10 : null,
    };
  });
}

export type SeoDiagnosis = {
  scope: SiteScope;
  days: number;
  connection: { keySet: boolean; connected: boolean; sites: { site: string; enabled: boolean; property: string | null; note: string | null }[] };
  performance: { clicks: number; prevClicks: number; clicksDeltaPct: number | null; impressions: number; prevImpressions: number; impressionsDeltaPct: number | null; ctr: number; position: number | null; points: GscPoint[] };
  biggestDrop: { from: string; to: string; fromClicks: number; toClicks: number; dropPct: number } | null;
  queryMovers: GscMover[];
  pageMovers: GscMover[];
  positionSlips: GscMover[];
  positionGains: GscMover[];
  ctrOpportunities: Opportunity[];
  strikingDistance: Opportunity[];
  index: { coverage: IndexCoverage[]; contentPages: number; noTraffic: number; indexUnknown: number };
  algoUpdates: { date: string; label: string }[];
  notes: string[];
};

export async function getSeoDiagnosis(scope: SiteScope, days = 28): Promise<SeoDiagnosis> {
  const conn = await getGscConnection();
  const sitesInScope = scope === "all" ? Object.keys(conn.sites) : [scope as string];
  const connection = {
    keySet: conn.keySet,
    connected: conn.connected,
    sites: sitesInScope.map((s) => ({ site: s, enabled: !!conn.sites[s]?.enabled, property: conn.sites[s]?.property ?? null, note: conn.sites[s]?.note ?? null })),
  };

  const [perf, qMovers, pMovers, striking, ctrOpps, inventory, coverage] = await Promise.all([
    getGscPerformance(scope, days),
    gscMovers(scope, "gsc_query_daily", "query", days),
    gscMovers(scope, "gsc_page_daily", "page", days),
    getOpportunities(scope, 8),
    getCtrOpportunities(scope, 8),
    getContentInventory(scope),
    getIndexCoverage(scope),
  ]);

  const queryMovers = [...qMovers].sort((a, b) => Math.abs(b.clicksDelta) - Math.abs(a.clicksDelta)).slice(0, 8);
  const pageMovers = [...pMovers].sort((a, b) => Math.abs(b.clicksDelta) - Math.abs(a.clicksDelta)).slice(0, 8);
  const positionSlips = qMovers
    .filter((m) => m.posDelta != null && m.posDelta >= 2 && m.curImpr >= 20)
    .sort((a, b) => (b.posDelta as number) * b.curImpr - (a.posDelta as number) * a.curImpr)
    .slice(0, 8);
  const positionGains = qMovers
    .filter((m) => m.posDelta != null && m.posDelta <= -2 && m.curImpr >= 20)
    .sort((a, b) => (a.posDelta as number) * a.curImpr - (b.posDelta as number) * b.curImpr)
    .slice(0, 5);

  // Biggest single day-over-day clicks drop — where the cliff is.
  let biggestDrop: SeoDiagnosis["biggestDrop"] = null;
  for (let i = 1; i < perf.points.length; i++) {
    const a = perf.points[i - 1], b = perf.points[i];
    if (a.clicks <= 0 || b.clicks >= a.clicks) continue;
    const dropPct = Math.round(((a.clicks - b.clicks) / a.clicks) * 1000) / 10;
    if (!biggestDrop || dropPct > biggestDrop.dropPct) biggestDrop = { from: a.t, to: b.t, fromClicks: a.clicks, toClicks: b.clicks, dropPct };
  }

  const windowStartMs = Date.now() - (days + 14) * 86_400_000;
  const algoUpdates = ALGO_UPDATES.filter((u) => new Date(`${u.date}T00:00:00Z`).getTime() >= windowStartMs);

  const clicksDeltaPct = pct(perf.clicks, perf.prevClicks);
  const impressionsDeltaPct = pct(perf.impressions, perf.prevImpressions);

  const notes: string[] = [];
  if (!conn.connected) notes.push("Search Console key isn't connected (or last test failed) — search numbers may be empty or stale; reconnect before trusting them.");
  for (const s of connection.sites) {
    if (!s.enabled) notes.push(`GSC is not connected for ${s.site}${s.note ? ` (${s.note})` : ""} — its search performance is unavailable, so treat its SEO numbers as "unknown", not zero.`);
  }
  if (clicksDeltaPct != null && clicksDeltaPct <= -15) notes.push(`Search clicks down ${Math.abs(clicksDeltaPct)}% vs the prior ${days}d (${perf.prevClicks} → ${perf.clicks}).`);
  if (clicksDeltaPct != null && clicksDeltaPct >= 25) notes.push(`Search clicks up ${clicksDeltaPct}% (${perf.prevClicks} → ${perf.clicks}) — see which queries/pages drove it and double down.`);
  if (impressionsDeltaPct != null && impressionsDeltaPct <= -20 && (clicksDeltaPct ?? 0) <= -10) notes.push(`Impressions also down ${Math.abs(impressionsDeltaPct)}% — this is a visibility/ranking loss, not just a CTR dip.`);
  if (positionSlips[0]) { const s = positionSlips[0]; notes.push(`Biggest rank slip: "${s.key}" #${s.prevPos}→#${s.curPos} (${s.curImpr} impressions) — refresh that page/intent to recover it.`); }
  if (ctrOpps[0]) { const c = ctrOpps[0]; notes.push(`Rank-but-no-click: "${c.key}" sits at #${Math.round(c.position)} on ${c.impressions} impressions but ${(c.ctr * 100).toFixed(1)}% CTR — rewrite the title/meta description.`); }
  if (striking[0]) { const o = striking[0]; notes.push(`Striking distance: "${o.key}" at #${Math.round(o.position)} with ${o.impressions} impressions — a small content push could move it onto page 1.`); }
  if (inventory.summary.noTraffic >= 10) notes.push(`${inventory.summary.noTraffic} content pages have had no traffic in 30d — prune, merge, or improve them.`);
  const idxGap = coverage.find((c) => c.total > 0 && c.indexed < c.total * 0.8);
  if (idxGap) notes.push(`Only ${idxGap.indexed}/${idxGap.total} pages indexed on ${idxGap.site} — inspect the gap in GSC and submit the missing URLs.`);
  if (algoUpdates.length) notes.push(`A Google update overlaps this window (${algoUpdates.map((u) => u.label).join(", ")}); a broad clicks/impressions shift here may be algorithmic.`);

  return {
    scope, days, connection,
    performance: { clicks: perf.clicks, prevClicks: perf.prevClicks, clicksDeltaPct, impressions: perf.impressions, prevImpressions: perf.prevImpressions, impressionsDeltaPct, ctr: perf.ctr, position: perf.position, points: perf.points },
    biggestDrop,
    queryMovers, pageMovers, positionSlips, positionGains,
    ctrOpportunities: ctrOpps, strikingDistance: striking,
    index: { coverage, contentPages: inventory.summary.total, noTraffic: inventory.summary.noTraffic, indexUnknown: inventory.summary.indexUnknown },
    algoUpdates, notes,
  };
}

export async function getSeoOverview(scope: SiteScope) {
  const [r] = await rows(sql`
    SELECT
      (SELECT count(*) FROM content_pages WHERE ${siteCond(scope)})::int AS content_pages,
      (SELECT count(DISTINCT host) FROM embed_registry WHERE ${siteCond(scope)})::int AS embed_domains,
      (SELECT count(*) FROM directory_listings WHERE ${siteCond(scope)} AND status='listed')::int AS dirs_listed,
      (SELECT count(*) FROM directory_listings WHERE ${siteCond(scope)})::int AS dirs_total,
      (SELECT count(*) FROM competitor_pages WHERE ${siteCond(scope)})::int AS competitor_pages
  `);
  return {
    contentPages: Number(r?.content_pages ?? 0),
    embedDomains: Number(r?.embed_domains ?? 0),
    dirsListed: Number(r?.dirs_listed ?? 0),
    dirsTotal: Number(r?.dirs_total ?? 0),
    competitorPages: Number(r?.competitor_pages ?? 0),
  };
}
