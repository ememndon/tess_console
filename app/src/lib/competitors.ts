import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { sites } from "./db/schema";
import type { SiteScope } from "./site-scope";

// Competitor tracker queries.

const siteCond = (scope: SiteScope, col = "site"): SQL =>
  scope === "all" ? sql`true` : sql`${sql.raw(col)} = ${scope}`;

type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

export type CompetitorSet = { site: string; competitors: string[] };

export async function getCompetitorSets(scope: SiteScope): Promise<CompetitorSet[]> {
  const res = await db.select({ key: sites.key, competitors: sites.competitors }).from(sites);
  return res
    .filter((s) => scope === "all" || s.key === scope)
    .map((s) => ({ site: s.key, competitors: (s.competitors as string[]) ?? [] }));
}

export type CompetitorStat = { site: string; competitor: string; total: number; new7d: number; lastDiscovered: string | null };

export async function getCompetitorStats(scope: SiteScope): Promise<CompetitorStat[]> {
  const res = await rows(sql`
    SELECT site, competitor, count(*)::int AS total,
      count(*) FILTER (WHERE discovered_at >= now() - interval '7 days')::int AS new7d,
      max(discovered_at) AS last_discovered
    FROM competitor_pages
    WHERE ${siteCond(scope)}
    GROUP BY site, competitor
    ORDER BY new7d DESC, total DESC
  `);
  return res.map((r) => ({
    site: String(r.site),
    competitor: String(r.competitor),
    total: Number(r.total),
    new7d: Number(r.new7d),
    lastDiscovered: r.last_discovered ? new Date(r.last_discovered as string).toISOString() : null,
  }));
}

export type Publication = { site: string; competitor: string; url: string; title: string | null; discoveredAt: string };

export async function getRecentPublications(scope: SiteScope, limit = 60): Promise<Publication[]> {
  const res = await rows(sql`
    SELECT site, competitor, url, title, discovered_at
    FROM competitor_pages
    WHERE ${siteCond(scope)}
    ORDER BY discovered_at DESC, id DESC
    LIMIT ${limit}
  `);
  return res.map((r) => ({
    site: String(r.site),
    competitor: String(r.competitor),
    url: String(r.url),
    title: r.title == null ? null : String(r.title),
    discoveredAt: new Date(r.discovered_at as string).toISOString(),
  }));
}
