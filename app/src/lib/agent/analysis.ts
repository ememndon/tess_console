import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { gscDaily, emailMessages } from "@/lib/db/schema";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { needsReplyWhere } from "@/lib/email-needs-reply";

// Support mail that's been waiting too long for a reply (inbound, actionable,
// unanswered, not junk/trash — older than `hours`).
export async function getOverdueSupportCount(hours = 12): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 3_600_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(emailMessages)
    .where(and(needsReplyWhere, lt(emailMessages.internalDate, cutoff)));
  return row?.n ?? 0;
}

// Simple GSC-clicks anomaly per site: latest recorded day vs the trailing avg.
// Flags moves of ±50%+ on a meaningful baseline (avg ≥ 5 clicks/day).
export type Anomaly = { site: string; direction: "up" | "down"; detail: string };
export async function getAnomalies(): Promise<Anomaly[]> {
  const out: Anomaly[] = [];
  for (const site of SITE_KEYS) {
    const rows = await db
      .select({ day: gscDaily.day, clicks: gscDaily.clicks })
      .from(gscDaily)
      .where(eq(gscDaily.site, site))
      .orderBy(sql`${gscDaily.day} DESC`)
      .limit(8);
    if (rows.length < 4) continue;
    const latest = rows[0];
    const base = rows.slice(1, 8);
    const avg = base.reduce((s, r) => s + r.clicks, 0) / base.length;
    if (avg < 5) continue;
    const delta = (latest.clicks - avg) / avg;
    if (Math.abs(delta) < 0.5) continue;
    out.push({
      site: SITE_META[site as SiteKey]?.name ?? site,
      direction: delta > 0 ? "up" : "down",
      detail: `GSC clicks ${latest.clicks} on ${String(latest.day)} vs ${avg.toFixed(0)}/day baseline (${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%)`,
    });
  }
  return out;
}

// Last-7-days vs prior-7-days GSC clicks per site (for the weekly review).
export type WeeklyTrend = { site: string; name: string; last7: number; prev7: number; deltaPct: number | null };
export async function getWeeklyTrends(): Promise<WeeklyTrend[]> {
  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const d7 = ymd(new Date(today.getTime() - 7 * 86_400_000));
  const d14 = ymd(new Date(today.getTime() - 14 * 86_400_000));
  const out: WeeklyTrend[] = [];
  for (const site of SITE_KEYS) {
    const [last] = await db.select({ n: sql<number>`coalesce(sum(${gscDaily.clicks}),0)`.mapWith(Number) }).from(gscDaily).where(and(eq(gscDaily.site, site), sql`${gscDaily.day} >= ${d7}`));
    const [prev] = await db.select({ n: sql<number>`coalesce(sum(${gscDaily.clicks}),0)`.mapWith(Number) }).from(gscDaily).where(and(eq(gscDaily.site, site), sql`${gscDaily.day} >= ${d14} AND ${gscDaily.day} < ${d7}`));
    const last7 = last?.n ?? 0;
    const prev7 = prev?.n ?? 0;
    out.push({ site, name: SITE_META[site as SiteKey]?.name ?? site, last7, prev7, deltaPct: prev7 > 0 ? Math.round((100 * (last7 - prev7)) / prev7) : null });
  }
  return out;
}
