import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { feedback } from "./db/schema";
import type { SiteScope } from "./site-scope";

// Feedback module data: widget submissions with triage states.
export type FeedbackStatus = "new" | "seen" | "actioned";

// Rating is "1".."5" from the emoji widget (1 = worst) or legacy "helpful"/
// "not_helpful". Negative = 1–2 stars or an explicit not_helpful.
export function isNegativeRating(rating: string | null): boolean {
  if (!rating) return false;
  if (rating === "not_helpful") return true;
  const n = Number(rating);
  return Number.isFinite(n) && n >= 1 && n <= 2;
}

// Submissions since `since`, newest first — used by Tess's reports/digest.
export async function recentFeedback(scope: SiteScope, since: Date, limit = 50) {
  const conds = [gte(feedback.createdAt, since)];
  if (scope !== "all") conds.push(eq(feedback.site, scope));
  return db.select().from(feedback).where(and(...conds)).orderBy(desc(feedback.createdAt)).limit(limit);
}

export async function listFeedback(scope: SiteScope, status: FeedbackStatus | "all", limit = 200) {
  const conds = [];
  if (scope !== "all") conds.push(eq(feedback.site, scope));
  if (status !== "all") conds.push(eq(feedback.status, status));
  return db
    .select()
    .from(feedback)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(feedback.createdAt))
    .limit(limit);
}

export async function feedbackCounts(scope: SiteScope) {
  const where = scope === "all" ? sql`true` : sql`site = ${scope}`;
  const res = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status='new')::int AS new,
      count(*) FILTER (WHERE status='seen')::int AS seen,
      count(*) FILTER (WHERE status='actioned')::int AS actioned,
      count(*)::int AS total
    FROM feedback WHERE ${where}
  `)) as unknown as Record<string, unknown>[];
  const r = res[0] ?? {};
  return {
    new: Number(r.new ?? 0),
    seen: Number(r.seen ?? 0),
    actioned: Number(r.actioned ?? 0),
    total: Number(r.total ?? 0),
  };
}

// ── Diagnosis ────────────────────────────────────────────────────────────────
// The dashboard lists submissions + triage states. This answers "are people
// happy, is it changing, and WHERE is the pain?" — satisfaction rate vs the prior
// period, the pages drawing the most negative feedback, the verbatim recent
// complaints, and the untriaged backlog age. So Tess names the unhappy page and
// recommends a fix, not just "3 new feedback items".

const POS = sql`rating IN ('4','5','helpful')`;
const NEG = sql`rating IN ('1','2','not_helpful')`;
const exec = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Record<string, unknown>[];
const num = (v: unknown): number => (v == null ? 0 : Number(v));

export type FeedbackDiagnosis = {
  scope: SiteScope;
  days: number;
  total: number; positive: number; negative: number; neutral: number;
  satisfactionRate: number | null;
  prevSatisfactionRate: number | null;
  satisfactionDeltaPts: number | null;
  byPath: { path: string; total: number; negative: number }[];
  bySite: { site: string; total: number; negative: number }[];
  recentNegatives: { site: string; path: string | null; rating: string | null; message: string | null; country: string | null; at: string }[];
  backlog: { newCount: number; oldestNewDays: number | null };
  notes: string[];
};

export async function getFeedbackDiagnosis(scope: SiteScope, days = 30): Promise<FeedbackDiagnosis> {
  const where = scope === "all" ? sql`true` : sql`site = ${scope}`;

  const [totRow] = await exec(sql`
    SELECT
      count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days}))::int AS total,
      count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days}) AND ${POS})::int AS pos,
      count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days}) AND ${NEG})::int AS neg,
      count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days}) AND rating = '3')::int AS neu,
      count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}) AND ${POS})::int AS ppos,
      count(*) FILTER (WHERE created_at >= now() - make_interval(days => ${days * 2}) AND created_at < now() - make_interval(days => ${days}) AND ${NEG})::int AS pneg
    FROM feedback WHERE ${where} AND created_at >= now() - make_interval(days => ${days * 2})
  `);

  const pathRows = await exec(sql`
    SELECT coalesce(path, '(unknown)') AS path, count(*)::int AS total,
      count(*) FILTER (WHERE ${NEG})::int AS negative
    FROM feedback WHERE ${where} AND created_at >= now() - make_interval(days => ${days})
    GROUP BY path ORDER BY negative DESC, total DESC LIMIT 8
  `);

  const siteRows = scope === "all"
    ? await exec(sql`
        SELECT site, count(*)::int AS total, count(*) FILTER (WHERE ${NEG})::int AS negative
        FROM feedback WHERE created_at >= now() - make_interval(days => ${days})
        GROUP BY site ORDER BY negative DESC, total DESC`)
    : [];

  const negRows = await exec(sql`
    SELECT site, path, rating, message, country, created_at AS at
    FROM feedback WHERE ${where} AND ${NEG} AND created_at >= now() - make_interval(days => ${days})
    ORDER BY created_at DESC LIMIT 10
  `);

  const [backRow] = await exec(sql`
    SELECT count(*) FILTER (WHERE status='new')::int AS new_count,
      extract(day FROM now() - min(created_at) FILTER (WHERE status='new'))::int AS oldest_days
    FROM feedback WHERE ${where}
  `);

  const total = num(totRow?.total), positive = num(totRow?.pos), negative = num(totRow?.neg), neutral = num(totRow?.neu);
  const ppos = num(totRow?.ppos), pneg = num(totRow?.pneg);
  const rate = (p: number, n: number) => (p + n > 0 ? Math.round((p / (p + n)) * 1000) / 10 : null);
  const satisfactionRate = rate(positive, negative);
  const prevSatisfactionRate = rate(ppos, pneg);
  const satisfactionDeltaPts = satisfactionRate != null && prevSatisfactionRate != null ? Math.round((satisfactionRate - prevSatisfactionRate) * 10) / 10 : null;

  const byPath = pathRows.map((r) => ({ path: String(r.path), total: num(r.total), negative: num(r.negative) }));
  const bySite = siteRows.map((r) => ({ site: String(r.site), total: num(r.total), negative: num(r.negative) }));
  const recentNegatives = negRows.map((r) => ({ site: String(r.site), path: r.path == null ? null : String(r.path), rating: r.rating == null ? null : String(r.rating), message: r.message == null ? null : String(r.message).slice(0, 300), country: r.country == null ? null : String(r.country), at: new Date(r.at as string).toISOString() }));
  const backlog = { newCount: num(backRow?.new_count), oldestNewDays: backRow?.oldest_days == null ? null : num(backRow.oldest_days) };

  const notes: string[] = [];
  if (total === 0) notes.push(`No feedback in the last ${days}d.`);
  else {
    if (satisfactionRate != null) notes.push(`Satisfaction ${satisfactionRate}% (${positive} positive / ${negative} negative) over ${days}d.`);
    if (satisfactionDeltaPts != null && satisfactionDeltaPts <= -10) notes.push(`Satisfaction dropped ${Math.abs(satisfactionDeltaPts)} pts vs the prior ${days}d (${prevSatisfactionRate}% → ${satisfactionRate}%) — something got worse; read the recent complaints.`);
    const worst = byPath.find((p) => p.negative >= 3);
    if (worst) notes.push(`Most complaints on ${worst.path} (${worst.negative} negative of ${worst.total}) — review that page for a bug or confusing UX, then recommend() a fix.`);
    if (scope === "all" && bySite[0]?.negative >= 3) notes.push(`${bySite[0].site} is drawing the most negative feedback (${bySite[0].negative}) — focus there.`);
  }
  if (backlog.newCount > 0) notes.push(`${backlog.newCount} feedback item(s) untriaged${backlog.oldestNewDays != null ? `, oldest ${backlog.oldestNewDays}d` : ""} — triage them (mark seen/actioned).`);

  return { scope, days, total, positive, negative, neutral, satisfactionRate, prevSatisfactionRate, satisfactionDeltaPts, byPath, bySite, recentNegatives, backlog, notes };
}
