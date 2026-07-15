import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { gscQueries, contentPages } from "../db/schema";
import { formatById } from "./formats";
import { getGscWinners } from "./feedback";
import type { NicheStrategy, Subtopic, FormatPick, HookPattern } from "./analyze";

// The Search-demand engine: turn the site's OWN Google Search Console demand into
// content briefs. Reads the real queries the site already appears for, clusters
// near-duplicates, joins each cluster to the exact ranking page, and emits the
// same NicheStrategy shape the grid builder already consumes, plus a per-subtopic
// ANCHOR ({query, url, position}) so every draft answers a real search and links
// the exact tool. Pure first-party data, no external API, no LLM call.

export type DemandTier = "striking" | "ctr" | "demand";

// The anchor stored (as a tagged union) in the existing contentPlanItems.sourceVideo
// jsonb — so no schema migration is needed to carry a GSC brief instead of a video.
export type DemandAnchor = {
  kind: "gsc";
  query: string;
  url: string | null;
  title: string | null;
  position: number;
  impressions: number;
  pool: DemandTier;
};

// A NicheStrategy the grid can build a plan from, with the anchors aligned 1:1 to
// its subtopics (subtopics[i] ↔ clusters[i]).
export type DemandStrategy = NicheStrategy & { clusters: DemandAnchor[] };

// Words that carry no topic signal for a tool site (so "rate calculator" and
// "calculate rate" cluster on "rate").
const STOP = new Set([
  "the", "for", "and", "calculator", "calculators", "calculate", "calculated", "calculation", "calculating",
  "how", "what", "why", "when", "where", "with", "your", "you", "from", "into", "are", "per", "best", "free",
  "online", "near", "vs", "or", "a", "an", "of", "in", "to", "is", "it", "on", "by", "my", "me", "do", "does",
]);

function tokens(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
}
// Light plural stemming so "funds"/"fund" and "molecules"/"molecule" match.
function stem(t: string): string {
  return t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}
function sigTokens(q: string): string[] {
  return tokens(q).filter((t) => t.length >= 3 && !STOP.has(t) && /[a-z]/.test(t)).map(stem);
}
// Drop math-expression / gibberish queries ("3 x^2 +30 x +75=") that have no real
// topic words — they would make nonsense posts.
function isJunk(q: string): boolean {
  if (sigTokens(q).length < 1) return true;
  return (q.match(/[a-z]/gi) || []).length < 3;
}

type Raw = { query: string; clicks: number; impressions: number; ctr: number; position: number; tier: DemandTier; sig: string[] };

function tierOf(impr: number, ctr: number, pos: number): DemandTier {
  if (pos >= 8 && pos <= 25) return "striking"; // near page one — highest intent to lift
  if (pos <= 10 && impr >= 30 && ctr < 0.03) return "ctr"; // ranks but loses the click
  return "demand"; // real demand the site already appears for
}
const TIER_BOOST: Record<DemandTier, number> = { striking: 1.6, ctr: 1.3, demand: 1.0 };
const clampPos = (p: number) => Math.max(1, Math.min(25, p));
const rawScore = (r: Raw) => r.impressions * (26 - clampPos(r.position)) * TIER_BOOST[r.tier];

type Cluster = {
  rep: Raw;
  members: Raw[];
  impressions: number;
  bestPos: number;
  tier: DemandTier;
  score: number;
  page: { url: string; title: string | null } | null;
};

/** Cluster a site's Search Console demand into ranked topic clusters, each joined
 * to its best-matching content page. Ordered by opportunity (impressions × how
 * close to page one, boosted for striking-distance / CTR-gap tiers). */
export async function getDemandClusters(site: string, limit = 60): Promise<Cluster[]> {
  const rows = await db
    .select()
    .from(gscQueries)
    .where(and(eq(gscQueries.site, site), gt(gscQueries.impressions, 0)))
    .orderBy(desc(gscQueries.impressions))
    .limit(400);

  const raws: Raw[] = [];
  for (const r of rows) {
    const q = r.query.trim();
    if (!q || isJunk(q)) continue;
    const impr = r.impressions;
    const ctr = r.ctr ?? (impr ? r.clicks / impr : 0);
    const pos = r.position ?? 100;
    raws.push({ query: q, clicks: r.clicks, impressions: impr, ctr, position: pos, tier: tierOf(impr, ctr, pos), sig: sigTokens(q) });
  }
  raws.sort((a, b) => rawScore(b) - rawScore(a));

  // Greedy cluster: highest-scoring queries seed clusters; a later query joins the
  // first cluster whose SEED tokens it shares (seed-only, so clusters stay tight).
  const clusters: Cluster[] = [];
  const seedToken = new Map<string, Cluster>();
  for (const r of raws) {
    let target: Cluster | null = null;
    for (const t of r.sig) { const c = seedToken.get(t); if (c) { target = c; break; } }
    if (!target) {
      target = { rep: r, members: [], impressions: 0, bestPos: r.position, tier: r.tier, score: 0, page: null };
      clusters.push(target);
      for (const t of r.sig) if (!seedToken.has(t)) seedToken.set(t, target);
    }
    target.members.push(r);
    target.impressions += r.impressions;
    target.bestPos = Math.min(target.bestPos, r.position);
    if (TIER_BOOST[r.tier] > TIER_BOOST[target.tier]) target.tier = r.tier;
  }

  // Join each cluster to the page whose slug/title best overlaps its query tokens.
  // Skip generic nav/utility pages (about, terms, contact, blog root...) — they are
  // never good content targets and cause weak matches ("what about 10%" -> /about).
  const NAV_DENY = /^\/(about|terms|terms-of-service|privacy|privacy-policy|contact|contact-us|faq|cookies?|cookie-policy|disclaimer|sitemap|login|signup|register|search|widget|get-widget|blog)(\/|$)/i;
  const pages = (await db
    .select({ url: contentPages.url, path: contentPages.path, title: contentPages.title })
    .from(contentPages)
    .where(eq(contentPages.site, site))
  ).filter((p) => !NAV_DENY.test(p.path));
  const pageToks = pages.map((p) => ({
    url: p.url,
    path: p.path,
    title: p.title,
    toks: new Set([...sigTokens(p.path.replace(/[/-]/g, " ")), ...sigTokens(p.title ?? "")]),
  }));

  for (const c of clusters) {
    // Match against the REPRESENTATIVE query's tokens (what becomes the post's
    // subtopic), not every member's — otherwise one stray member drags the page
    // match off (e.g. "rate calculator" mislinking to the roth-ira page).
    const csig = c.rep.sig;
    const head = csig.slice().sort((a, b) => b.length - a.length)[0] ?? "";
    const singleTok = csig.length <= 1;
    let best: { url: string; title: string | null } | null = null;
    let bestOverlap = 0;
    let bestLen = Number.POSITIVE_INFINITY;
    for (const p of pageToks) {
      let overlap = 0;
      for (const t of csig) if (p.toks.has(t)) overlap++;
      if (overlap === 0) continue;
      // Qualify a page when: it shares 2+ words (strong), or the query has a short/
      // single head word (common tool words like "rate"/"binary"), or the topic-head
      // word itself is present. This blocks weak single side-word matches (e.g.
      // "weight of molecules" -> ideal-WEIGHT) while allowing brand-prefixed multi-
      // word matches (e.g. "stanbic mutual funds" -> mutual-fund).
      const ok = overlap >= 2 || head.length < 6 || singleTok || p.toks.has(head);
      if (!ok) continue;
      // Prefer more token overlap; break ties toward the more specific (shorter) path.
      if (overlap > bestOverlap || (overlap === bestOverlap && p.path.length < bestLen)) {
        best = { url: p.url, title: p.title ?? null };
        bestOverlap = overlap;
        bestLen = p.path.length;
      }
    }
    c.page = bestOverlap > 0 ? best : null;
    c.score = c.members.reduce((s, m) => s + m.impressions * (26 - clampPos(m.position)), 0) * TIER_BOOST[c.tier];
  }

  clusters.sort((a, b) => b.score - a.score);
  return clusters.slice(0, limit);
}

// A curated format set that suits demand/answer content on a tool site (the grid
// rotates image vs video from these; formatKind splits them). winShare just
// orders the pools, strongest first.
function demandFormats(): FormatPick[] {
  const mk = (id: string, winShare: number): FormatPick => {
    const d = formatById(id);
    return { id, name: d?.name ?? id, whyWinning: d?.whyItWorks ?? "", template: d?.template ?? "", winShare, exampleTitles: [] };
  };
  return [
    mk("problem_solution", 90), mk("howto", 86), mk("comparison", 80), mk("explainer", 78),
    mk("listicle", 72), mk("qa", 68), mk("spotlight", 64), mk("myth", 58),
  ];
}

/** Build a full content strategy from a site's Search Console demand — the same
 * shape analyzeNiche returns, plus the aligned GSC anchors. Returns a note (and no
 * subtopics) when the site has too little search data to plan from. */
export async function buildDemandStrategy(site: string): Promise<DemandStrategy> {
  const pool = await getDemandClusters(site, 120);
  const base: NicheStrategy = { niche: "Google Search demand", analyzedVideos: 0, summary: "", subtopics: [], formats: [], hookPatterns: [], model: null };

  // DOUBLE DOWN: boost clusters whose page previously CLIMBED after a post (from
  // the feedback loop), so the plan keeps supporting pages that respond.
  const winners = await getGscWinners(site).catch(() => new Set<string>());
  if (winners.size) for (const c of pool) if (c.page && winners.has(c.page.url)) c.score *= 1.4;

  // Keep only clusters worth a post: either the query maps to a real page, or it
  // is a specific multi-word search with some volume. Drops noise like "yes",
  // "in naira", a stray typo — which otherwise become empty posts. Then cap how
  // many briefs can share one page so a single tool cannot dominate the month.
  const usable = pool
    .filter((c) => c.page !== null || (c.rep.sig.length >= 2 && c.impressions >= 5))
    .sort((a, b) => b.score - a.score);
  const perUrl = new Map<string, number>();
  const clusters: typeof usable = [];
  for (const c of usable) {
    if (c.page) {
      const n = perUrl.get(c.page.url) ?? 0;
      if (n >= 3) continue; // at most 3 briefs per page
      perUrl.set(c.page.url, n + 1);
    }
    clusters.push(c);
    if (clusters.length >= 60) break;
  }
  if (clusters.length < 3) {
    return { ...base, clusters: [], note: `Only ${clusters.length} usable Google searches found for this site. Connect or refresh Search Console, or use the YouTube source.` };
  }

  const maxScore = Math.max(...clusters.map((c) => c.score), 1);
  const strikeCount = clusters.filter((c) => c.tier === "striking").length;

  const subtopics: Subtopic[] = clusters.map((c, i) => {
    const pos = Math.round(c.bestPos);
    const tool = c.page?.title ? `the ${c.page.title} page` : "the matching tool";
    return {
      rank: i + 1,
      title: c.rep.query,
      pattern: `A real Google search with ${c.impressions} impression${c.impressions === 1 ? "" : "s"}; the site currently shows around position ${pos}. Answer this search directly and link ${tool}.`,
      hookStyle: "Restate the exact search as the headline, then answer it fast.",
      exampleTitles: c.members.slice(0, 3).map((m) => m.query),
      strength: Math.max(1, Math.round((c.score / maxScore) * 100)),
      winningCount: c.members.length,
      saturation: c.tier === "striking" ? "medium" : "low",
      difficultyNote:
        c.tier === "striking"
          ? `Close to page one (around ${pos}); a focused post plus an internal link can lift it.`
          : `Around position ${pos} today; social traffic and a clear answer can build it.`,
    };
  });

  const clustersAnchors: DemandAnchor[] = clusters.map((c) => ({
    kind: "gsc",
    query: c.rep.query,
    url: c.page?.url ?? null,
    title: c.page?.title ?? null,
    position: Math.round(c.bestPos),
    impressions: c.impressions,
    pool: c.tier,
  }));

  const summary = `Built from ${clusters.length} real Google searches your pages already appear for, ${strikeCount} of them in striking distance near the top of page one. Every post answers a real query and links the exact page.`;
  const hookPatterns: HookPattern[] = [
    { pattern: "[the exact search]? Here is the fast answer.", example: `${clusters[0].rep.query}? Here is the fast answer.` },
    { pattern: "The quickest way to [do the thing].", example: "The quickest way to get the number you need." },
    { pattern: "Everyone asks this. Here is the real answer.", example: "Everyone asks this. Here is the real answer." },
  ];

  return { ...base, summary, subtopics, formats: demandFormats(), hookPatterns, clusters: clustersAnchors };
}

// ── Blend: mix Google-Search demand with YouTube outliers into one plan ────────
type Brief = { s: Subtopic; a: Record<string, unknown> | null };

function dedupFormats(list: FormatPick[]): FormatPick[] {
  const seen = new Set<string>();
  const out: FormatPick[] = [];
  for (const f of list) if (f.id && !seen.has(f.id)) { seen.add(f.id); out.push(f); }
  return out.sort((a, b) => b.winShare - a.winShare);
}

/** Interleave GSC subtopics (each with its query+URL anchor) and YouTube subtopics
 * (each anchored to a representative outlier) into ONE ranked list, at ~gscShare
 * GSC, dropping YouTube topics that duplicate a GSC one. The returned subs/anchors
 * are aligned 1:1 so the grid builder consumes them exactly like a single source. */
export function mergeBlendBriefs(
  gsc: { subtopics: Subtopic[]; clusters: DemandAnchor[]; formats: FormatPick[]; hookPatterns: HookPattern[] },
  yt: { subtopics: Subtopic[]; formats: FormatPick[]; hookPatterns: HookPattern[] },
  outliers: { title: string; url: string; outlierScore: number | null }[],
  gscShare = 0.6,
): { subs: Subtopic[]; anchors: (Record<string, unknown> | null)[]; formats: FormatPick[]; hookPatterns: HookPattern[]; summary: string; gscCount: number; ytCount: number } {
  const gscBriefs: Brief[] = gsc.subtopics.map((s, i) => ({ s, a: (gsc.clusters[i] as unknown as Record<string, unknown>) ?? null }));

  // Anchor each YouTube subtopic to a representative outlier (token match, else by rank).
  const ytBriefs: Brief[] = yt.subtopics.map((s, i) => {
    const toks = new Set(sigTokens(s.title));
    const best = outliers.find((o) => sigTokens(o.title).some((t) => toks.has(t))) ?? outliers[i % Math.max(1, outliers.length)] ?? null;
    return { s, a: best ? { title: best.title, url: best.url, outlierScore: best.outlierScore } : null };
  });

  // Cross-lane dedup: drop a YouTube subtopic that substantially overlaps a GSC one.
  const gscTokSets = gscBriefs.map((b) => new Set(sigTokens(b.s.title)));
  const ytKept = ytBriefs.filter((b) => {
    const t = sigTokens(b.s.title);
    if (!t.length) return true;
    const need = Math.max(1, Math.ceil(t.length / 2));
    return !gscTokSets.some((g) => t.filter((x) => g.has(x)).length >= need);
  });

  // Interleave by quota (deterministic ~gscShare fraction GSC).
  const merged: Brief[] = [];
  let gi = 0, yi = 0;
  while (gi < gscBriefs.length || yi < ytKept.length) {
    const total = merged.length;
    const takeGsc = gi < gscBriefs.length && (yi >= ytKept.length || Math.floor((total + 1) * gscShare) > Math.floor(total * gscShare));
    if (takeGsc) merged.push(gscBriefs[gi++]);
    else if (yi < ytKept.length) merged.push(ytKept[yi++]);
    else if (gi < gscBriefs.length) merged.push(gscBriefs[gi++]);
    else break;
  }

  const subs = merged.map((b, i) => ({ ...b.s, rank: i + 1 }));
  const anchors = merged.map((b) => b.a);
  const formats = dedupFormats([...gsc.formats, ...yt.formats]);
  const hookPatterns = [...gsc.hookPatterns, ...yt.hookPatterns].slice(0, 6);
  const summary = `Blended plan: ${gscBriefs.length} Google Search topic${gscBriefs.length === 1 ? "" : "s"} grounded in your real demand, mixed with ${ytKept.length} YouTube trend${ytKept.length === 1 ? "" : "s"}. Search topics link the exact ranking page; YouTube topics ride proven demand.`;
  return { subs, anchors, formats, hookPatterns, summary, gscCount: gscBriefs.length, ytCount: ytKept.length };
}
