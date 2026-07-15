import "server-only";
import { and, gte, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialTargets, emailMessages, notifications, settings, mailboxes, users } from "@/lib/db/schema";
import { getOverview } from "@/lib/overview";
import { getSecretValue } from "@/lib/secrets";
import { tgSendMessage } from "@/lib/telegram";
import { mailboxPassword } from "@/lib/mail/mailboxes";
import { sendMail } from "@/lib/mail/smtp";
import { needsReplyWhere } from "@/lib/email-needs-reply";
import { recentFeedback, isNegativeRating } from "@/lib/feedback";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { COPY_STANDARD, enforceNoDashPunctuation } from "@/lib/design";
import { getAnomalies, getOverdueSupportCount, getWeeklyTrends } from "./analysis";
import { budgetStatus, usageThisMonth } from "./cost";
import { resolveForTask } from "./routing";
import { generateRouted } from "./complete";
import { isTessPaused } from "./control";

// Tess's daily morning report (owner requirement). Deterministic figures
// first — every number comes from a query, never invented. An optional
// LLM "recommended actions" paragraph is appended only when a model is available
// and we're inside budget; it's fed ONLY these figures and told not to add numbers.
export type DailyReport = { subject: string; text: string };

export async function buildDailyReport(): Promise<DailyReport> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [{ sites, global }, postsRow, emailsOutRow, alertRows, repliesRow, budget, usage] = await Promise.all([
    getOverview("all"),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(socialTargets).where(gte(socialTargets.postedAt, since)),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(emailMessages).where(and(eq(emailMessages.direction, "outbound"), gte(emailMessages.createdAt, since))),
    db.select({ severity: notifications.severity, c: sql<number>`count(*)`.mapWith(Number) }).from(notifications).where(gte(notifications.createdAt, since)).groupBy(notifications.severity),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(emailMessages).where(needsReplyWhere),
    budgetStatus(),
    usageThisMonth(),
  ]);

  const postsPublished = postsRow[0]?.n ?? 0;
  const emailsSent = emailsOutRow[0]?.n ?? 0;
  const repliesWaiting = repliesRow[0]?.n ?? 0;
  const alerts: Record<string, number> = {};
  for (const r of alertRows) alerts[r.severity] = r.c;
  const alertsRaised = (alerts.info ?? 0) + (alerts.warning ?? 0) + (alerts.critical ?? 0);

  const [anomalies, overdue, fbRecent] = await Promise.all([getAnomalies(), getOverdueSupportCount(12), recentFeedback("all", since, 50)]);
  const fbNegative = fbRecent.filter((f) => isNegativeRating(f.rating));

  const dateStr = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  const lines: string[] = [];
  lines.push(`Tess morning report, ${dateStr} (UTC)`);
  lines.push("");

  // Per-site traffic + ops snapshot.
  lines.push("SITES");
  for (const s of sites) {
    const up = s.uptimeStatus === "up" ? "up" : s.uptimeStatus;
    lines.push(`• ${s.name}: ${s.visitorsToday} visitors today · ${s.clicks7d} GSC clicks (7d) · ${s.indexedPages} indexed · uptime ${up}${s.needsReply ? ` · ${s.needsReply} replies needed` : ""}`);
  }
  lines.push("");

  // Last 24h activity.
  lines.push("LAST 24 HOURS");
  lines.push(`• Posts published: ${postsPublished}`);
  lines.push(`• Emails sent: ${emailsSent}`);
  lines.push(`• Support mail awaiting a reply: ${repliesWaiting}`);
  lines.push(`• Alerts raised: ${alertsRaised}${alertsRaised ? ` (${alerts.critical ?? 0} critical, ${alerts.warning ?? 0} warning, ${alerts.info ?? 0} info)` : ""}`);
  lines.push("");

  // Standing attention items.
  lines.push("NEEDS ATTENTION");
  lines.push(`• Pending approvals: ${global.pendingApprovals}`);
  lines.push(`• Unread critical/warning alerts: ${global.critical} / ${global.warning}`);
  lines.push(`• Failing jobs: ${global.jobsFailing}`);
  lines.push(`• Support mail overdue (>12h): ${overdue}`);
  lines.push(`• Console status: ${global.consoleStatus}`);
  lines.push("");

  // Traffic anomalies worth a look.
  if (anomalies.length) {
    lines.push("ANOMALIES");
    for (const a of anomalies) lines.push(`• ${a.site}: ${a.direction === "up" ? "📈" : "📉"} ${a.detail}`);
    lines.push("");
  }

  // User feedback (resume builder + on-site widgets).
  if (fbRecent.length) {
    lines.push("FEEDBACK (last 24h)");
    lines.push(`• New submissions: ${fbRecent.length}${fbNegative.length ? ` · ${fbNegative.length} negative` : ""}`);
    for (const f of fbNegative.slice(0, 5)) {
      const site = SITE_META[f.site as SiteKey]?.name ?? f.site;
      const label = f.rating === "not_helpful" ? "not helpful" : Number.isFinite(Number(f.rating)) ? `${f.rating}/5` : (f.rating ?? "?");
      lines.push(`   - ${site} [${label}]: "${(f.message || "(no comment)").replace(/\s+/g, " ").slice(0, 140)}"`);
    }
    lines.push("");
  }

  // Budget / usage.
  lines.push("BUDGET");
  lines.push(`• Paid AI: $${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(0)} this month (${budget.pct}%)${budget.degraded ? " (DEGRADE MODE)" : ""}`);
  if (usage.length) {
    const byProvider = usage.filter((u) => u.tokensIn + u.tokensOut > 0).map((u) => `${u.provider} $${u.costUsd.toFixed(2)}`).join(", ");
    if (byProvider) lines.push(`• By model: ${byProvider}`);
  }

  // Optional LLM recommendations — only inside budget and not paused.
  const recs = await maybeRecommendations({ sites, postsPublished, emailsSent, repliesWaiting, alerts, pendingApprovals: global.pendingApprovals, jobsFailing: global.jobsFailing, budget });
  if (recs) {
    lines.push("");
    lines.push("RECOMMENDED ACTIONS");
    lines.push(recs);
  }

  return { subject: `Tess morning report: ${dateStr}`, text: lines.join("\n") };
}

// Weekly strategic review (delivered Mondays): a deeper, opinionated per-site
// brief built on the real numbers + 7-day-over-7-day trend, written in advisor
// mode. Reuses deliverDailyReport for delivery.
export async function buildWeeklyReview(): Promise<DailyReport> {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const weekAgo = new Date(Date.now() - 7 * 24 * 3_600_000);
  const [{ sites }, trends, anomalies, fb] = await Promise.all([getOverview("all"), getWeeklyTrends(), getAnomalies(), recentFeedback("all", weekAgo, 200)]);
  const facts = {
    sites: sites.map((s) => {
      const t = trends.find((x) => x.site === s.site);
      const mine = fb.filter((f) => f.site === s.site);
      const neg = mine.filter((f) => isNegativeRating(f.rating));
      return {
        site: s.name,
        visitorsToday: s.visitorsToday,
        gscClicks7d: s.clicks7d,
        indexedPages: s.indexedPages,
        repliesNeeded: s.needsReply,
        scheduledPosts: s.scheduledPosts,
        uptime: s.uptimeStatus,
        clicksLast7: t?.last7 ?? 0,
        clicksPrev7: t?.prev7 ?? 0,
        weekOverWeekPct: t?.deltaPct ?? null,
        feedbackCount7d: mine.length,
        feedbackNegative7d: neg.length,
        feedbackComments: mine.filter((f) => f.message).slice(0, 6).map((f) => `[${f.rating === "not_helpful" ? "neg" : `${f.rating}/5`}] ${f.message!.replace(/\s+/g, " ").slice(0, 160)}`),
      };
    }),
    anomalies: anomalies.map((a) => `${a.site}: ${a.detail}`),
  };
  const system = [
    "You are Tess, operations manager for three sites: Calculatry, GlobalResumeHub, CheckInvest. Write the owner's WEEKLY strategic review.",
    "Be a sharp advisor, not a dashboard. For EACH site: 1 to 2 sentences on how the week went (use the real numbers and the week-over-week trend), then 1 to 2 SPECIFIC, prioritized actions you would take or recommend, with the reasoning. Call out anything that moved a lot.",
    "Pay attention to user feedback (feedbackCount7d / feedbackNegative7d / feedbackComments): if users are unhappy or a theme recurs in the comments, name it and recommend a concrete fix.",
    "End with a short 'TOP 3 THIS WEEK' list across all sites: the highest-leverage moves in priority order.",
    "Write in plain, simple English anyone can understand: short everyday words, short sentences, no jargon or fancy business-speak. Plain text, concise, confident. Use ONLY the numbers provided, never invent figures.",
    COPY_STANDARD,
  ].join("\n");
  let body = "";
  try {
    body = enforceNoDashPunctuation((await generateRouted({ taskId: "daily_report", system, user: `This week's figures:\n${JSON.stringify(facts, null, 2)}`, maxTokens: 800, preferModel: "cerebras" })).text.trim());
  } catch (e) {
    body = `(Weekly review generation unavailable: ${e instanceof Error ? e.message : String(e)})`;
  }
  return { subject: `Tess weekly review: ${dateStr}`, text: [`Tess weekly strategic review (week ending ${dateStr}, UTC)`, "", body].join("\n") };
}

// Deliver the report to the owner: email (admin) + Telegram (paired chat).
export async function deliverDailyReport(report: DailyReport): Promise<{ email: boolean; telegram: boolean }> {
  let email = false;
  let telegram = false;
  const [destRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "alert_destinations"));
  const dest = (destRow?.value as { telegramChatId?: string; email?: string; fromMailboxId?: string }) ?? {};

  const token = await getSecretValue("telegram_bot_token");
  if (token && dest.telegramChatId) {
    await tgSendMessage(token, dest.telegramChatId, report.text).catch(() => {});
    telegram = true;
  }

  const to = dest.email || (await firstAdminEmail());
  const box = await pickFromMailbox(dest.fromMailboxId);
  if (to && box) {
    await sendMail(box, mailboxPassword(box), { to: [to], subject: report.subject, text: report.text }).catch(() => {});
    email = true;
  }
  return { email, telegram };
}

async function firstAdminEmail(): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin")).limit(1);
  return u?.email ?? null;
}

async function pickFromMailbox(id?: string) {
  if (id) {
    const [b] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
    if (b) return b;
  }
  const [b] = await db.select().from(mailboxes).where(eq(mailboxes.enabled, true)).limit(1);
  return b ?? null;
}

async function maybeRecommendations(facts: unknown): Promise<string | null> {
  try {
    if (await isTessPaused()) return null;
    const b = await budgetStatus();
    if (b.pct >= 100) return null; // hard cap — no paid recommendations
    const model = await resolveForTask("daily_report", false);
    if (!model) return null;
    const system = [
      "You are Tess, the operations manager for three websites. Write a SHORT 'recommended actions' section for the owner's morning report.",
      "Rules: 3 to 5 bullet points max. Use plain, simple English anyone can understand: short everyday words, short sentences, no jargon. Be concrete and prioritized.",
      "NO INVENTED NUMBERS: only reference figures present in the JSON I give you. Do not state any metric not in the data.",
      "No greeting, no sign-off, just the bullets.",
      COPY_STANDARD,
    ].join("\n");
    const { text } = await generateRouted({ taskId: "daily_report", system, user: `Today's figures:\n${JSON.stringify(facts)}`, maxTokens: 400 });
    return enforceNoDashPunctuation(text.trim()) || null;
  } catch {
    return null; // recommendations are best-effort
  }
}
