import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import type { SiteScope } from "./site-scope";

// Dashboard query layer. Served from the raw `events` table so the
// view is always live — retention keeps raw events for the full selectable
// range (≤90 days); the nightly rollups are the durable long-term archive that
// powers any future >90-day trends. All counts cast to int so they arrive as
// JS numbers (postgres returns bigint as string otherwise).

export type Range = 1 | 7 | 30 | 90;
export const RANGES: { value: Range; label: string }[] = [
  { value: 1, label: "24 hours" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

// Confirmed Google algorithm updates — overlaid as annotations on the traffic
// chart and used by getTrafficDiagnosis/getSeoDiagnosis to flag whether a shift
// overlaps an update. Dates are official rollout START dates.
// Last refreshed 2026-06-25 (sources: Search Engine Journal / Search Engine Land);
// top up as Google confirms new core/spam updates.
export const ALGO_UPDATES: { date: string; label: string }[] = [
  { date: "2025-03-13", label: "Mar 2025 Core Update" },
  { date: "2025-06-30", label: "Jun 2025 Core Update" },
  { date: "2025-08-26", label: "Aug 2025 Spam Update" },
  { date: "2025-12-11", label: "Dec 2025 Core Update" },
  { date: "2026-02-05", label: "Feb 2026 Discover Update" },
  { date: "2026-03-24", label: "Mar 2026 Spam Update" },
  { date: "2026-03-27", label: "Mar 2026 Core Update" },
  { date: "2026-05-21", label: "May 2026 Core Update" },
];

const siteCond = (scope: SiteScope): SQL =>
  scope === "all" ? sql`true` : sql`site = ${scope}`;

type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export type Kpis = {
  visitors: number;
  pageviews: number;
  events: number;
  errors: number;
  avgLoadMs: number | null;
  prevVisitors: number;
  prevPageviews: number;
};

export async function getKpis(scope: SiteScope, days: Range): Promise<Kpis> {
  const where = siteCond(scope);
  const [r] = await rows(sql`
    SELECT
      count(DISTINCT visitor_id) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days}))::int AS visitors,
      count(*) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days}))::int AS pageviews,
      count(*) FILTER (WHERE type='event' AND created_at >= now() - make_interval(days => ${days}))::int AS events,
      count(*) FILTER (WHERE type='error' AND created_at >= now() - make_interval(days => ${days}))::int AS errors,
      round(avg(load_ms) FILTER (WHERE type='pageview' AND load_ms IS NOT NULL AND created_at >= now() - make_interval(days => ${days})))::int AS avg_load_ms,
      count(DISTINCT visitor_id) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}))::int AS prev_visitors,
      count(*) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}))::int AS prev_pageviews
    FROM events
    WHERE ${where} AND created_at >= now() - make_interval(days => ${days * 2})
  `);
  return {
    visitors: n(r?.visitors),
    pageviews: n(r?.pageviews),
    events: n(r?.events),
    errors: n(r?.errors),
    avgLoadMs: r?.avg_load_ms == null ? null : n(r.avg_load_ms),
    prevVisitors: n(r?.prev_visitors),
    prevPageviews: n(r?.prev_pageviews),
  };
}

export type TimePoint = { t: string; pageviews: number; visitors: number };

export async function getTimeseries(scope: SiteScope, days: Range): Promise<TimePoint[]> {
  const where = siteCond(scope);
  const hourly = days === 1;
  const unit = hourly ? "hour" : "day";
  const step = hourly ? sql`interval '1 hour'` : sql`interval '1 day'`;
  const span = hourly ? sql`now() - interval '23 hours'` : sql`now() - make_interval(days => ${days - 1})`;
  const res = await rows(sql`
    WITH buckets AS (
      SELECT generate_series(date_trunc(${unit}, ${span}), date_trunc(${unit}, now()), ${step}) AS b
    )
    SELECT
      to_char(buckets.b, ${hourly ? sql`'YYYY-MM-DD"T"HH24:00'` : sql`'YYYY-MM-DD'`}) AS t,
      count(e.id) FILTER (WHERE e.type='pageview')::int AS pageviews,
      count(DISTINCT e.visitor_id) FILTER (WHERE e.type='pageview')::int AS visitors
    FROM buckets
    LEFT JOIN events e
      ON date_trunc(${unit}, e.created_at) = buckets.b AND ${where}
    GROUP BY buckets.b
    ORDER BY buckets.b
  `);
  return res.map((r) => ({ t: String(r.t), pageviews: n(r.pageviews), visitors: n(r.visitors) }));
}

export type Bar = { key: string; count: number; visitors: number };

async function topBy(scope: SiteScope, days: Range, dimensionSql: SQL, filter: SQL, limit = 12): Promise<Bar[]> {
  const where = siteCond(scope);
  const res = await rows(sql`
    SELECT ${dimensionSql} AS key, count(*)::int AS count, count(DISTINCT visitor_id)::int AS visitors
    FROM events
    WHERE ${where} AND created_at >= now() - make_interval(days => ${days}) AND ${filter}
    GROUP BY key
    ORDER BY count DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({ key: String(r.key), count: n(r.count), visitors: n(r.visitors) }));
}

export const getTopPages = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`coalesce(path, '/')`, sql`type='pageview'`);
export const getReferrers = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`CASE WHEN referrer_host = '$direct' THEN 'Direct' ELSE referrer_host END`, sql`type='pageview' AND referrer_host IS NOT NULL`);
export const getUtmSources = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`utm_source`, sql`utm_source IS NOT NULL`);
export const getGeo = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`coalesce(country, 'Unknown')`, sql`type='pageview'`, 20);
export const getDevices = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`coalesce(device, 'unknown')`, sql`type='pageview'`, 6);
export const getBrowsers = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`coalesce(browser, 'Other')`, sql`type='pageview'`, 8);
export const getEventNames = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`name`, sql`type='event' AND name IS NOT NULL`, 30);
export const getNotFound = (s: SiteScope, d: Range) =>
  topBy(s, d, sql`coalesce(path, '/')`, sql`type='not_found'`, 20);

export type ErrorGroup = { message: string; count: number; lastPath: string | null; lastSeen: string };

export async function getErrors(scope: SiteScope, days: Range): Promise<ErrorGroup[]> {
  const where = siteCond(scope);
  const res = await rows(sql`
    SELECT
      coalesce(props->>'message', 'Unknown error') AS message,
      count(*)::int AS count,
      (array_agg(path ORDER BY created_at DESC))[1] AS last_path,
      max(created_at) AS last_seen
    FROM events
    WHERE ${where} AND type='error' AND created_at >= now() - make_interval(days => ${days})
    GROUP BY message
    ORDER BY count DESC
    LIMIT 30
  `);
  return res.map((r) => ({
    message: String(r.message),
    count: n(r.count),
    lastPath: r.last_path == null ? null : String(r.last_path),
    lastSeen: new Date(r.last_seen as string).toISOString(),
  }));
}

export type EventPropValue = { prop: string; val: string; count: number };

export async function getEventProps(scope: SiteScope, days: Range, name: string): Promise<EventPropValue[]> {
  const where = siteCond(scope);
  const res = await rows(sql`
    SELECT kv.key AS prop, kv.value AS val, count(*)::int AS count
    FROM events e, jsonb_each_text(e.props) kv
    WHERE ${where} AND e.type='event' AND e.name=${name}
      AND e.props IS NOT NULL AND e.created_at >= now() - make_interval(days => ${days})
    GROUP BY kv.key, kv.value
    ORDER BY kv.key, count DESC
  `);
  return res.map((r) => ({ prop: String(r.prop), val: String(r.val), count: n(r.count) }));
}

export type Embed = { site: string; host: string; hits: number; firstSeen: string; lastSeen: string };

export async function getEmbeds(scope: SiteScope): Promise<Embed[]> {
  const where = siteCond(scope);
  const res = await rows(sql`
    SELECT site, host, hits, first_seen_at, last_seen_at
    FROM embed_registry
    WHERE ${where}
    ORDER BY last_seen_at DESC
    LIMIT 200
  `);
  return res.map((r) => ({
    site: String(r.site),
    host: String(r.host),
    hits: n(r.hits),
    firstSeen: new Date(r.first_seen_at as string).toISOString(),
    lastSeen: new Date(r.last_seen_at as string).toISOString(),
  }));
}

export type RealtimeEvent = {
  type: string;
  name: string | null;
  path: string | null;
  country: string | null;
  device: string | null;
  site: string;
  createdAt: string;
};

export async function getRealtime(
  scope: SiteScope,
): Promise<{ active: number; recent: RealtimeEvent[] }> {
  const where = siteCond(scope);
  const [a] = await rows(sql`
    SELECT count(DISTINCT visitor_id)::int AS active
    FROM events
    WHERE ${where} AND type='pageview' AND created_at >= now() - interval '5 minutes'
  `);
  const recent = await rows(sql`
    SELECT type, name, path, country, device, site, created_at
    FROM events
    WHERE ${where} AND created_at >= now() - interval '30 minutes'
    ORDER BY created_at DESC
    LIMIT 15
  `);
  return {
    active: n(a?.active),
    recent: recent.map((r) => ({
      type: String(r.type),
      name: r.name == null ? null : String(r.name),
      path: r.path == null ? null : String(r.path),
      country: r.country == null ? null : String(r.country),
      device: r.device == null ? null : String(r.device),
      site: String(r.site),
      createdAt: new Date(r.created_at as string).toISOString(),
    })),
  };
}

// ── Diagnosis ───────────────────────────────────────────────────────────────
// The dashboard answers "what are the numbers?". This answers "WHY did they
// move?" — the analytics analog of getUptimeIncidents. It compares this period
// to the one before it and surfaces what actually changed: which sources/pages/
// countries/devices gained or lost the most, the day the biggest drop landed,
// broken links (404 spikes), error trend, load regressions, and whether a known
// Google update overlaps the window. So Tess can pinpoint a cause, not recite a %.

export type Mover = { key: string; cur: number; prev: number; delta: number };

// Biggest period-over-period movers for one dimension (gainers AND losers,
// ranked by absolute change), comparing the last `days` to the `days` before it.
async function movers(scope: SiteScope, days: Range, dimensionSql: SQL, filter: SQL, limit = 8): Promise<Mover[]> {
  const where = siteCond(scope);
  const res = await rows(sql`
    WITH cur AS (
      SELECT ${dimensionSql} AS key, count(*)::int AS c
      FROM events
      WHERE ${where} AND ${filter} AND created_at >= now() - make_interval(days => ${days})
      GROUP BY key
    ), prev AS (
      SELECT ${dimensionSql} AS key, count(*)::int AS c
      FROM events
      WHERE ${where} AND ${filter}
        AND created_at >= now() - make_interval(days => ${days * 2})
        AND created_at <  now() - make_interval(days => ${days})
      GROUP BY key
    )
    SELECT coalesce(cur.key, prev.key) AS key,
      coalesce(cur.c, 0)::int AS cur, coalesce(prev.c, 0)::int AS prev,
      (coalesce(cur.c, 0) - coalesce(prev.c, 0))::int AS delta
    FROM cur FULL OUTER JOIN prev ON cur.key = prev.key
    WHERE coalesce(cur.key, prev.key) IS NOT NULL
    ORDER BY abs(coalesce(cur.c, 0) - coalesce(prev.c, 0)) DESC, cur DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({ key: String(r.key), cur: n(r.cur), prev: n(r.prev), delta: n(r.delta) }));
}

const pctChange = (cur: number, prev: number): number | null =>
  prev === 0 ? (cur > 0 ? 100 : null) : Math.round(((cur - prev) / prev) * 1000) / 10;

export type TrafficDiagnosis = {
  scope: SiteScope;
  days: Range;
  totals: {
    visitors: number; prevVisitors: number; visitorsDeltaPct: number | null;
    pageviews: number; prevPageviews: number; pageviewsDeltaPct: number | null;
    avgLoadMs: number | null; prevAvgLoadMs: number | null;
    errors: number; prevErrors: number;
  };
  timeseries: TimePoint[];
  biggestDrop: { from: string; to: string; fromPageviews: number; toPageviews: number; dropPct: number } | null;
  movers: { sources: Mover[]; pages: Mover[]; countries: Mover[]; devices: Mover[] };
  broken404: Bar[];
  topErrors: ErrorGroup[];
  algoUpdates: { date: string; label: string }[];
  notes: string[];
};

export async function getTrafficDiagnosis(scope: SiteScope, days: Range): Promise<TrafficDiagnosis> {
  const where = siteCond(scope);
  const [t] = await rows(sql`
    SELECT
      count(DISTINCT visitor_id) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days}))::int AS visitors,
      count(DISTINCT visitor_id) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}))::int AS prev_visitors,
      count(*) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days}))::int AS pageviews,
      count(*) FILTER (WHERE type='pageview' AND created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}))::int AS prev_pageviews,
      round(avg(load_ms) FILTER (WHERE type='pageview' AND load_ms IS NOT NULL AND created_at >= now() - make_interval(days => ${days})))::int AS avg_load_ms,
      round(avg(load_ms) FILTER (WHERE type='pageview' AND load_ms IS NOT NULL AND created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days})))::int AS prev_avg_load_ms,
      count(*) FILTER (WHERE type='error' AND created_at >= now() - make_interval(days => ${days}))::int AS errors,
      count(*) FILTER (WHERE type='error' AND created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}))::int AS prev_errors
    FROM events
    WHERE ${where} AND created_at >= now() - make_interval(days => ${days * 2})
  `);

  const visitors = n(t?.visitors), prevVisitors = n(t?.prev_visitors);
  const pageviews = n(t?.pageviews), prevPageviews = n(t?.prev_pageviews);
  const avgLoadMs = t?.avg_load_ms == null ? null : n(t.avg_load_ms);
  const prevAvgLoadMs = t?.prev_avg_load_ms == null ? null : n(t.prev_avg_load_ms);
  const errors = n(t?.errors), prevErrors = n(t?.prev_errors);

  const [series, sources, pages, countries, devices, broken404, topErrors] = await Promise.all([
    getTimeseries(scope, days),
    movers(scope, days, SOURCE_SQL, sql`type='pageview'`),
    movers(scope, days, sql`coalesce(path, '/')`, sql`type='pageview'`),
    movers(scope, days, sql`coalesce(country, 'Unknown')`, sql`type='pageview'`),
    movers(scope, days, sql`coalesce(device, 'unknown')`, sql`type='pageview'`, 6),
    getNotFound(scope, days),
    getErrors(scope, days),
  ]);

  // Largest single bucket-to-bucket drop in pageviews — where the cliff is.
  let biggestDrop: TrafficDiagnosis["biggestDrop"] = null;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (a.pageviews <= 0 || b.pageviews >= a.pageviews) continue;
    const dropPct = Math.round(((a.pageviews - b.pageviews) / a.pageviews) * 1000) / 10;
    if (!biggestDrop || dropPct > biggestDrop.dropPct) {
      biggestDrop = { from: a.t, to: b.t, fromPageviews: a.pageviews, toPageviews: b.pageviews, dropPct };
    }
  }

  // Google updates landing inside the window (or up to 14d before it — a drop
  // shows up after the rollout), so a search-traffic shift can be tied to one.
  const windowStartMs = Date.now() - (days + 14) * 86_400_000;
  const algoUpdates = ALGO_UPDATES.filter((u) => new Date(`${u.date}T00:00:00Z`).getTime() >= windowStartMs);

  const visitorsDeltaPct = pctChange(visitors, prevVisitors);
  const pageviewsDeltaPct = pctChange(pageviews, prevPageviews);

  const notes: string[] = [];
  if (visitorsDeltaPct != null && visitorsDeltaPct <= -15) notes.push(`Visitors down ${Math.abs(visitorsDeltaPct)}% vs the prior ${days}d (${prevVisitors} → ${visitors}).`);
  if (visitorsDeltaPct != null && visitorsDeltaPct >= 25) notes.push(`Visitors up ${visitorsDeltaPct}% vs the prior ${days}d (${prevVisitors} → ${visitors}) — find what's working and lean in.`);
  const sourceLoss = sources.find((s) => s.delta < 0 && Math.abs(s.delta) >= Math.max(5, prevPageviews * 0.1));
  if (sourceLoss) notes.push(`Biggest source loss: ${sourceLoss.key} (${sourceLoss.prev} → ${sourceLoss.cur} pageviews). Check whether that channel changed.`);
  const pageLoss = pages.find((p) => p.delta < 0 && Math.abs(p.delta) >= Math.max(5, prevPageviews * 0.1));
  if (pageLoss) notes.push(`Biggest page loss: ${pageLoss.key} (${pageLoss.prev} → ${pageLoss.cur}). Verify it still loads, ranks, and is linked.`);
  if (broken404.length && broken404[0].count >= 5) notes.push(`404 hits on ${broken404[0].key} (${broken404[0].count}) — likely a broken/changed link; recommend a redirect or fix.`);
  if (avgLoadMs != null && prevAvgLoadMs != null && avgLoadMs > prevAvgLoadMs * 1.3 && avgLoadMs > 1500) notes.push(`Load time regressed: ${prevAvgLoadMs}ms → ${avgLoadMs}ms — a speed issue can suppress both engagement and rankings.`);
  if (errors > prevErrors * 1.5 && errors >= 10) notes.push(`JS errors up ${prevErrors} → ${errors} — a front-end break may be driving people away.`);
  if (algoUpdates.length) notes.push(`A Google update overlaps this window (${algoUpdates.map((u) => u.label).join(", ")}); a search-traffic change here may be algorithmic — cross-check with get_seo.`);

  return {
    scope, days,
    totals: { visitors, prevVisitors, visitorsDeltaPct, pageviews, prevPageviews, pageviewsDeltaPct, avgLoadMs, prevAvgLoadMs, errors, prevErrors },
    timeseries: series,
    biggestDrop,
    movers: { sources, pages, countries, devices },
    broken404,
    topErrors: topErrors.slice(0, 8),
    algoUpdates,
    notes,
  };
}

/** Unique visitors today (UTC), per scope — feeds the Site Overview tile. */
export async function getVisitorsToday(scope: SiteScope): Promise<number> {
  const where = siteCond(scope);
  const [r] = await rows(sql`
    SELECT count(DISTINCT visitor_id)::int AS v
    FROM events
    WHERE ${where} AND type='pageview' AND created_at >= date_trunc('day', now())
  `);
  return n(r?.v);
}

// ── Per-visitor explorer ──────────────────────────────────────────────────────
// Visitor ids rotate daily (cookieless privacy), so this is a single-day view:
// every visitor for the chosen UTC day, with their acquisition source, geo, device,
// and counts — expandable to a full timeline. Not "boxed" aggregates: one row = one person.

// Acquisition source from the referrer host. referrer_host stores the host, or
// '$direct' when there was none. Maps the big search engines to friendly names.
const SOURCE_SQL: SQL = sql`CASE
  WHEN referrer_host IS NULL OR referrer_host = '$direct' THEN 'Direct'
  WHEN referrer_host ILIKE '%google%' THEN 'Google'
  WHEN referrer_host ILIKE '%bing%' THEN 'Bing'
  WHEN referrer_host ILIKE '%yandex%' THEN 'Yandex'
  WHEN referrer_host ILIKE '%duckduckgo%' THEN 'DuckDuckGo'
  WHEN referrer_host ILIKE '%yahoo%' THEN 'Yahoo'
  WHEN referrer_host ILIKE '%baidu%' THEN 'Baidu'
  WHEN referrer_host ILIKE '%ecosia%' THEN 'Ecosia'
  ELSE referrer_host END`;

const dayStart = (day: string) => `${day}T00:00:00Z`;

export type VisitorRow = {
  visitorId: string;
  firstSeen: string;
  lastSeen: string;
  site: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  source: string | null;
  landing: string | null;
  exit: string | null;
  pageviews: number;
  events: number;
  errors: number;
};

/** Every visitor for the given UTC day (YYYY-MM-DD), newest activity first. */
export async function listVisitors(scope: SiteScope, day: string, limit = 300): Promise<VisitorRow[]> {
  const where = siteCond(scope);
  const start = dayStart(day);
  const res = await rows(sql`
    SELECT
      visitor_id,
      min(created_at) AS first_seen,
      max(created_at) AS last_seen,
      max(site) AS site,
      max(country) AS country,
      max(region) AS region,
      max(city) AS city,
      max(device) AS device,
      max(browser) AS browser,
      max(os) AS os,
      (array_agg(${SOURCE_SQL} ORDER BY created_at ASC))[1] AS source,
      (array_agg(path ORDER BY created_at ASC) FILTER (WHERE type='pageview'))[1] AS landing,
      (array_agg(path ORDER BY created_at DESC) FILTER (WHERE type='pageview'))[1] AS exit,
      count(*) FILTER (WHERE type='pageview')::int AS pageviews,
      count(*) FILTER (WHERE type='event')::int AS events,
      count(*) FILTER (WHERE type='error')::int AS errors
    FROM events
    WHERE ${where} AND visitor_id IS NOT NULL
      AND created_at >= ${start}::timestamptz AND created_at < ${start}::timestamptz + interval '1 day'
    GROUP BY visitor_id
    ORDER BY last_seen DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({
    visitorId: String(r.visitor_id),
    firstSeen: new Date(r.first_seen as string).toISOString(),
    lastSeen: new Date(r.last_seen as string).toISOString(),
    site: r.site == null ? null : String(r.site),
    country: r.country == null ? null : String(r.country),
    region: r.region == null ? null : String(r.region),
    city: r.city == null ? null : String(r.city),
    device: r.device == null ? null : String(r.device),
    browser: r.browser == null ? null : String(r.browser),
    os: r.os == null ? null : String(r.os),
    source: r.source == null ? null : String(r.source),
    landing: r.landing == null ? null : String(r.landing),
    exit: r.exit == null ? null : String(r.exit),
    pageviews: n(r.pageviews),
    events: n(r.events),
    errors: n(r.errors),
  }));
}

export type JourneyEvent = {
  type: string;
  name: string | null;
  path: string | null;
  message: string | null;
  referrerHost: string | null;
  at: string;
};

/** Full ordered timeline for one visitor on the given UTC day. */
export async function getVisitorJourney(scope: SiteScope, visitorId: string, day: string): Promise<JourneyEvent[]> {
  const where = siteCond(scope);
  const start = dayStart(day);
  const res = await rows(sql`
    SELECT type, name, path, props->>'message' AS message, referrer_host, created_at
    FROM events
    WHERE ${where} AND visitor_id = ${visitorId}
      AND created_at >= ${start}::timestamptz AND created_at < ${start}::timestamptz + interval '1 day'
    ORDER BY created_at ASC
    LIMIT 500
  `);
  return res.map((r) => ({
    type: String(r.type),
    name: r.name == null ? null : String(r.name),
    path: r.path == null ? null : String(r.path),
    message: r.message == null ? null : String(r.message),
    referrerHost: r.referrer_host == null ? null : String(r.referrer_host),
    at: new Date(r.created_at as string).toISOString(),
  }));
}

/** Whether any analytics event has ever been received (drives the empty state). */
export async function hasAnyEvents(scope: SiteScope): Promise<boolean> {
  const where = siteCond(scope);
  const [r] = await rows(sql`SELECT 1 AS x FROM events WHERE ${where} LIMIT 1`);
  return !!r;
}
