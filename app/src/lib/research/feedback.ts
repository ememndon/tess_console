import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { socialPosts, gscQueries, settings, notifications } from "../db/schema";
import { SITE_KEYS, SITE_META, type SiteKey } from "../site-scope";

// The FREE feedback loop — the one thing the YouTube engine structurally cannot
// have. Weeks after a GSC-anchored post was made, re-read Search Console: did the
// query it targeted climb? Winners (pages that rose) are stored so the next plan
// DOUBLES DOWN on them, and the owner gets a short "what worked" notification.

export type FeedbackWinner = { site: string; query: string; url: string | null; fromPos: number; nowPos: number; delta: number };
export type FeedbackResult = { site: string; analyzed: number; improved: number; slipped: number; winners: FeedbackWinner[]; note?: string };

const MIN_AGE_DAYS = 21; // give a post time to have an effect before remeasuring
const IMPROVE_DELTA = 3; // positions gained to count as "worked"
const SLIP_DELTA = -3;

/** Winning target URLs for a site (pages whose anchored query climbed after a
 * post) — read by the demand engine to boost those clusters next plan. */
export async function getGscWinners(site: string): Promise<Set<string>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "gsc_feedback"));
  const v = (row?.value as Record<string, { urls?: string[] }> | undefined) ?? {};
  return new Set((v[site]?.urls ?? []).filter(Boolean));
}

/** Re-measure GSC for each site's GSC-anchored posts, record winners, notify. */
export async function runGscFeedback(site?: string): Promise<FeedbackResult[]> {
  const sites = site && (SITE_KEYS as readonly string[]).includes(site) ? [site] : (SITE_KEYS as readonly string[]).slice();
  const results: FeedbackResult[] = [];
  const store: Record<string, { urls: string[]; at: string }> = {};

  // Preserve any winners already stored for sites we are not re-running now.
  const [existing] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "gsc_feedback"));
  const prev = (existing?.value as Record<string, { urls: string[]; at: string }> | undefined) ?? {};
  Object.assign(store, prev);

  for (const s of sites) {
    // Current position per query (the rolling GSC snapshot).
    const cur = await db.select({ q: gscQueries.query, pos: gscQueries.position }).from(gscQueries).where(eq(gscQueries.site, s));
    const nowPos = new Map<string, number>();
    for (const r of cur) if (r.pos != null) nowPos.set(r.q.trim().toLowerCase(), r.pos);

    // Generated posts anchored to a GSC brief, old enough to have had an effect.
    const posts = await db
      .select({ data: socialPosts.data })
      .from(socialPosts)
      .where(
        and(
          eq(socialPosts.site, s),
          sql`(${socialPosts.data} -> 'sourceVideo' ->> 'kind') = 'gsc'`,
          sql`${socialPosts.createdAt} < now() - make_interval(days => ${MIN_AGE_DAYS})`,
        ),
      );

    // Best delta per query (a query can back several posts).
    const best = new Map<string, FeedbackWinner>();
    for (const p of posts) {
      const a = (p.data as Record<string, unknown> | null)?.sourceVideo as { query?: string; url?: string; position?: number } | undefined;
      const query = a?.query?.trim();
      const from = Number(a?.position);
      if (!query || !Number.isFinite(from)) continue;
      const now = nowPos.get(query.toLowerCase());
      if (now == null) continue; // no current data for this query
      const delta = Math.round((from - now) * 10) / 10; // positive = climbed (lower position number)
      const w: FeedbackWinner = { site: s, query, url: a?.url ?? null, fromPos: Math.round(from), nowPos: Math.round(now), delta };
      const cur0 = best.get(query.toLowerCase());
      if (!cur0 || delta > cur0.delta) best.set(query.toLowerCase(), w);
    }

    const all = [...best.values()];
    const winners = all.filter((w) => w.delta >= IMPROVE_DELTA).sort((a, b) => b.delta - a.delta);
    const slipped = all.filter((w) => w.delta <= SLIP_DELTA).length;
    results.push({ site: s, analyzed: all.length, improved: winners.length, slipped, winners: winners.slice(0, 10) });

    // Store winning URLs so the next plan doubles down on responsive pages.
    const urls = [...new Set(winners.map((w) => w.url).filter((u): u is string => !!u))];
    if (urls.length || all.length) store[s] = { urls, at: new Date().toISOString() };

    // Notify the owner when posts moved the needle.
    if (winners.length > 0) {
      const name = SITE_META[s as SiteKey]?.name ?? s;
      const top = winners[0];
      await db.insert(notifications).values({
        severity: "info",
        module: "content",
        title: `📈 Search feedback — ${name}`,
        body: `${winners.length} of ${all.length} Search-anchored post${all.length === 1 ? "" : "s"} lifted their Google ranking. Top: "${top.query}" rose ${top.delta} spot${top.delta === 1 ? "" : "s"} (position ${top.fromPos} to ${top.nowPos}). The next plan will double down on the pages that responded.`,
      });
    }
  }

  await db
    .insert(settings)
    .values({ key: "gsc_feedback", value: store })
    .onConflictDoUpdate({ target: settings.key, set: { value: store, updatedAt: new Date() } });

  return results;
}
