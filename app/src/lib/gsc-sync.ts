import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { gscDaily, gscQueries, gscPages, gscQueryDaily, gscPageDaily, settings } from "./db/schema";
import { getSecretValue } from "./secrets";
import { gscListSites, gscSearchAnalytics, domainMatchesProperty, type SearchRow } from "./gsc";
import { SITE_META, SITE_KEYS } from "./site-scope";

// GSC data sync: backfills ~16 months of daily totals and refreshes
// a 28-day snapshot of queries and pages per connected site, then marks content
// pages that appear in Search as indexed. Triggered daily by cron via the
// internal route; safe to re-run (idempotent upserts).

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86_400_000));

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Roll a [date, key] breakdown up into a flat snapshot over rows on/after `since`
// (YYYY-MM-DD lexical compare). CTR and position are impression-weighted — you
// can't sum rates. `keyIdx` is which dimension to group by (1 = query/page).
type SnapRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };
function rollUp(rows: SearchRow[], since: string, keyIdx: number): SnapRow[] {
  const m = new Map<string, { c: number; i: number; pw: number }>();
  for (const r of rows) {
    if (r.keys[0] < since) continue;
    const k = r.keys[keyIdx];
    const e = m.get(k) ?? { c: 0, i: 0, pw: 0 };
    e.c += Math.round(r.clicks);
    e.i += Math.round(r.impressions);
    e.pw += r.position * r.impressions;
    m.set(k, e);
  }
  return [...m.entries()].map(([key, e]) => ({
    key,
    clicks: e.c,
    impressions: e.i,
    ctr: e.i > 0 ? e.c / e.i : 0,
    position: e.i > 0 ? e.pw / e.i : 0,
  }));
}

// Paginate Search Analytics up to a cap (GSC returns ≤ rowLimit per call).
async function fetchAll(
  key: string,
  property: string,
  body: Parameters<typeof gscSearchAnalytics>[2],
  cap: number,
): Promise<SearchRow[]> {
  const out: SearchRow[] = [];
  let startRow = 0;
  while (out.length < cap) {
    const rows = await gscSearchAnalytics(key, property, { ...body, rowLimit: 1000, startRow });
    out.push(...rows);
    if (rows.length < 1000) break;
    startRow += 1000;
  }
  return out.slice(0, cap);
}

export type SyncResult = { ok: boolean; error?: string; perSite?: Record<string, unknown> };

export async function syncGsc(): Promise<SyncResult> {
  const started = Date.now();
  const key = await getSecretValue("gsc_service_account");
  if (!key) return { ok: false, error: "No service-account key configured." };

  const [cfgRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "gsc_sites"));
  const cfg = (cfgRow?.value as Record<string, { enabled: boolean; property?: string }>) ?? {};

  let accessible: Awaited<ReturnType<typeof gscListSites>>;
  try {
    accessible = await gscListSites(key);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not list GSC properties." };
  }

  const endDate = ymd(new Date());
  const startDate = daysAgo(480); // ~16 months
  const win90 = daysAgo(90); // per-day query/page breakdown horizon (covers all range pills)
  const win28 = daysAgo(28); // flat snapshot window for opportunities + index-marking
  const perSite: Record<string, unknown> = {};

  for (const site of SITE_KEYS) {
    const c = cfg[site];
    if (!c?.enabled) {
      perSite[site] = { skipped: "disabled" };
      continue;
    }
    const domain = SITE_META[site].domain;
    // Resolve the property: configured value if the SA can see it, else auto-match the domain.
    let property =
      c.property && accessible.some((s) => s.siteUrl === c.property) ? c.property : undefined;
    if (!property) {
      const matches = accessible.filter((s) => domainMatchesProperty(domain, s.siteUrl));
      property = matches.find((s) => s.siteUrl.startsWith("sc-domain:"))?.siteUrl ?? matches[0]?.siteUrl;
    }
    if (!property) {
      perSite[site] = { skipped: "service account not granted on this property" };
      continue;
    }

    try {
      // 1) Daily totals — backfill ~16 months (one query returns the full series).
      const daily = await gscSearchAnalytics(key, property, {
        startDate,
        endDate,
        dimensions: ["date"],
        rowLimit: 1000,
      });
      for (const part of chunk(daily, 500)) {
        await db
          .insert(gscDaily)
          .values(
            part.map((r) => ({
              site,
              day: r.keys[0],
              clicks: Math.round(r.clicks),
              impressions: Math.round(r.impressions),
              ctr: r.ctr,
              position: r.position,
            })),
          )
          .onConflictDoUpdate({
            target: [gscDaily.site, gscDaily.day],
            set: {
              clicks: sql`excluded.clicks`,
              impressions: sql`excluded.impressions`,
              ctr: sql`excluded.ctr`,
              position: sql`excluded.position`,
            },
          });
      }

      // 2) Queries — per-day breakdown over 90d (drives range-selectable Top
      //    Queries); the flat 28d snapshot (opportunity finder) is rolled up
      //    from the same rows, so this is still one API fetch per dimension.
      const queriesDaily = await fetchAll(key, property, { startDate: win90, endDate, dimensions: ["date", "query"] }, 25000);
      await db.delete(gscQueryDaily).where(eq(gscQueryDaily.site, site));
      for (const part of chunk(queriesDaily, 500)) {
        await db
          .insert(gscQueryDaily)
          .values(
            part.map((r) => ({
              site,
              day: r.keys[0],
              query: r.keys[1].slice(0, 480),
              clicks: Math.round(r.clicks),
              impressions: Math.round(r.impressions),
              ctr: r.ctr,
              position: r.position,
            })),
          )
          .onConflictDoNothing();
      }
      const queries = rollUp(queriesDaily, win28, 1);
      await db.delete(gscQueries).where(eq(gscQueries.site, site));
      for (const part of chunk(queries, 500)) {
        await db
          .insert(gscQueries)
          .values(part.map((r) => ({ site, query: r.key.slice(0, 480), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })))
          .onConflictDoNothing();
      }

      // 3) Pages — per-day breakdown over 90d + rolled-up 28d snapshot.
      const pagesDaily = await fetchAll(key, property, { startDate: win90, endDate, dimensions: ["date", "page"] }, 25000);
      await db.delete(gscPageDaily).where(eq(gscPageDaily.site, site));
      for (const part of chunk(pagesDaily, 500)) {
        await db
          .insert(gscPageDaily)
          .values(
            part.map((r) => ({
              site,
              day: r.keys[0],
              page: r.keys[1].slice(0, 480),
              clicks: Math.round(r.clicks),
              impressions: Math.round(r.impressions),
              ctr: r.ctr,
              position: r.position,
            })),
          )
          .onConflictDoNothing();
      }
      const pages = rollUp(pagesDaily, win28, 1);
      await db.delete(gscPages).where(eq(gscPages.site, site));
      for (const part of chunk(pages, 500)) {
        await db
          .insert(gscPages)
          .values(part.map((r) => ({ site, page: r.key.slice(0, 480), clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })))
          .onConflictDoNothing();
      }

      // 4) Mark content-inventory pages that appear in Search as indexed.
      await db.execute(sql`
        UPDATE content_pages cp SET indexed = true, gsc_clicks = gp.clicks
        FROM gsc_pages gp WHERE gp.site = ${site} AND cp.site = ${site} AND gp.page = cp.url
      `);

      perSite[site] = { property, days: daily.length, queries: queries.length, pages: pages.length };
    } catch (e) {
      perSite[site] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  const durMs = Date.now() - started;
  const summary = Object.entries(perSite)
    .map(([s, v]) => {
      const o = v as Record<string, unknown>;
      if (o.error) return `${s}:error`;
      if (o.skipped) return `${s}:${o.skipped === "disabled" ? "off" : "ungranted"}`;
      return `${s}:${o.days}d/${o.queries}q/${o.pages}p`;
    })
    .join("  ");

  // Record run in the Jobs Monitor + a sync-status setting.
  await db.execute(sql`
    INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
    VALUES ('gsc-sync', now() - (${durMs} * interval '1 millisecond'), now(), 'ok', ${summary})
  `);
  await db.execute(sql`
    UPDATE jobs SET last_run_at = now(), last_status = 'ok', last_duration_ms = ${durMs}, last_output = ${summary}
    WHERE name = 'gsc-sync'
  `);
  await db
    .insert(settings)
    .values({ key: "gsc_sync_status", value: { at: new Date().toISOString(), perSite } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { at: new Date().toISOString(), perSite }, updatedAt: new Date() } });

  return { ok: true, perSite };
}
