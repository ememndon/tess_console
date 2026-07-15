import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { contentPages, gscDaily, emailMessages, mailboxes, socialPosts, notifications, emailDrafts, auditLog, jobs } from "./db/schema";
import { SITE_KEYS, SITE_META, type SiteKey, type SiteScope } from "./site-scope";
import { getVisitorsToday, getTimeseries } from "./analytics";
import { getMonitors } from "./health";
import { needsReplyWhere } from "./email-needs-reply";

export type SiteOverview = {
  site: SiteKey;
  name: string;
  domain: string;
  visitorsToday: number;
  visitors7d: number[]; // last 7 daily unique-visitor counts (oldest → today) for the sparkline
  visitorsDeltaPct: number | null; // today vs yesterday, % (null when yesterday was 0)
  uptimeStatus: "up" | "down" | "unknown" | "unconfigured";
  uptime24h: number | null;
  indexedPages: number;
  clicks7d: number;
  needsReply: number;
  scheduledPosts: number;
};

export type GlobalOverview = {
  critical: number;
  warning: number;
  pendingApprovals: number;
  jobsFailing: number;
  consoleStatus: string;
  visitorsToday: number; // total across the in-scope sites
  visitors7d: number[]; // combined last-7-day series for the hero sparkline
  visitorsDeltaPct: number | null;
  recent: { actor: string; action: string; target: string | null; at: string }[];
};

const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;

// Day-over-day % change from a daily series (today vs yesterday). Null when there's
// no prior day or yesterday was zero (so we never divide by zero or fake a number).
function deltaPct(series: number[]): number | null {
  if (series.length < 2) return null;
  const today = series[series.length - 1];
  const prev = series[series.length - 2];
  if (!prev) return null;
  return Math.round(((today - prev) / prev) * 100);
}

export async function getOverview(scope: SiteScope): Promise<{ sites: SiteOverview[]; global: GlobalOverview }> {
  const keys = scope === "all" ? SITE_KEYS : [scope as SiteKey];
  const ymd7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const monitors = await getMonitors();
  const monByKey = new Map(monitors.http.map((m) => [m.key, m]));

  const sites: SiteOverview[] = [];
  for (const site of keys) {
    const [visitorsToday, series, indexed, clicks, needs, sched] = await Promise.all([
      getVisitorsToday(site),
      getTimeseries(site, 7),
      db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(contentPages).where(and(eq(contentPages.site, site), eq(contentPages.indexed, true))),
      db.select({ n: sql<number>`coalesce(sum(${gscDaily.clicks}),0)`.mapWith(Number) }).from(gscDaily).where(and(eq(gscDaily.site, site), gte(gscDaily.day, ymd7))),
      db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(emailMessages).innerJoin(mailboxes, eq(emailMessages.mailboxId, mailboxes.id)).where(and(eq(mailboxes.site, site), needsReplyWhere)),
      db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(socialPosts).where(and(eq(socialPosts.site, site), eq(socialPosts.status, "scheduled"))),
    ]);
    const visitors7d = series.map((p) => p.visitors);
    const m = monByKey.get(site);
    sites.push({
      site,
      name: SITE_META[site].name,
      domain: SITE_META[site].domain,
      visitorsToday,
      visitors7d,
      visitorsDeltaPct: deltaPct(visitors7d),
      uptimeStatus: m?.status ?? "unknown",
      uptime24h: m?.uptime24h ?? null,
      indexedPages: n(indexed),
      clicks7d: n(clicks),
      needsReply: n(needs),
      scheduledPosts: n(sched),
    });
  }

  // Combined visitor trend for the hero (sum the per-site daily series day-by-day).
  const dayCount = sites[0]?.visitors7d.length ?? 0;
  const globalSeries = Array.from({ length: dayCount }, (_, i) => sites.reduce((sum, s) => sum + (s.visitors7d[i] ?? 0), 0));
  const totalVisitorsToday = sites.reduce((sum, s) => sum + s.visitorsToday, 0);

  const alertRows = await db
    .select({ severity: notifications.severity, c: sql<number>`count(*)`.mapWith(Number) })
    .from(notifications)
    .where(sql`${notifications.readAt} is null`)
    .groupBy(notifications.severity);
  const sev: Record<string, number> = {};
  for (const r of alertRows) sev[r.severity] = r.c;

  // "Replies to approve" = the number of conversations/items awaiting an approved
  // reply, NOT raw draft rows. Collapse every pending draft to the message it
  // replies to (compose drafts, which have no inReplyTo, count once by their own id)
  // so a thread that accrued several drafts still counts as one thing to approve.
  const drafts = await db
    .select({ n: sql<number>`count(distinct coalesce(${emailDrafts.inReplyTo}::text, ${emailDrafts.id}::text))`.mapWith(Number) })
    .from(emailDrafts)
    .where(eq(emailDrafts.status, "pending"));
  const failing = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(jobs).where(eq(jobs.lastStatus, "failed"));
  // The Overview "Recent activity" strip should read as real cross-module business
  // activity, so hide recorder/render-pipeline plumbing (demo.enqueue/complete,
  // capture.session, media.*) that would otherwise dominate the top rows while a
  // showcase batch is filming. The full Audit Log page still shows every action.
  const recent = await db
    .select()
    .from(auditLog)
    .where(sql`${auditLog.action} NOT LIKE 'demo.%' AND ${auditLog.action} NOT LIKE 'capture.%' AND ${auditLog.action} NOT LIKE 'media.%'`)
    .orderBy(desc(auditLog.id))
    .limit(7);

  return {
    sites,
    global: {
      critical: sev.critical ?? 0,
      warning: sev.warning ?? 0,
      pendingApprovals: n(drafts),
      jobsFailing: n(failing),
      consoleStatus: monByKey.get("console")?.status ?? "unknown",
      visitorsToday: totalVisitorsToday,
      visitors7d: globalSeries,
      visitorsDeltaPct: deltaPct(globalSeries),
      recent: recent.map((r) => ({ actor: r.actorName, action: r.action, target: r.target, at: r.createdAt.toISOString() })),
    },
  };
}
