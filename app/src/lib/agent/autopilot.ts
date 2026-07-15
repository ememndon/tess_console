import "server-only";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, notifications, emailMessages, settings } from "@/lib/db/schema";
import { getMonitors, getVpsHealth } from "@/lib/health";
import { getPendingDraftCount } from "@/lib/inbox";
import { needsReplyWhere } from "@/lib/email-needs-reply";
import { recentFeedback, isNegativeRating } from "@/lib/feedback";
import { getOverdueSupportCount } from "./analysis";
import { isTessPaused } from "./control";
import { budgetStatus } from "./cost";
import { notify } from "@/lib/notify";
import { runTess } from "./run";

// Tess's autonomous heartbeat. A host cron pokes /api/internal/agent-tick
// every 30 min; this builds a cheap, deterministic situation digest and — only if
// something actually needs attention and she isn't paused/over-budget — invokes her
// reasoning loop to handle it with her tools. The LLM is NOT called when idle, to
// respect Groq's free-tier limits. Self-throttles after repeated failures.

type AutopilotState = { consecutiveFails: number; lastRunAt?: string; lastResult?: string; throttleAlertedAt?: string };

async function getState(): Promise<AutopilotState> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "autopilot_state"));
  return (row?.value as AutopilotState) ?? { consecutiveFails: 0 };
}
async function setState(s: AutopilotState): Promise<void> {
  await db.insert(settings).values({ key: "autopilot_state", value: s }).onConflictDoUpdate({ target: settings.key, set: { value: s, updatedAt: new Date() } });
}

export type Digest = { needsAttention: boolean; lines: string[] };

// Deterministic scan — no LLM. Returns the list of things worth Tess's attention.
export async function buildDigest(): Promise<Digest> {
  const lines: string[] = [];
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);

  const [failingJobs, freshAlerts, actionableMail, pendingDrafts, monitors, vps, overdueMail, recentFb] = await Promise.all([
    db.select({ name: jobs.name, out: jobs.lastOutput }).from(jobs).where(eq(jobs.lastStatus, "failed")),
    db.select({ id: notifications.id, title: notifications.title, severity: notifications.severity })
      .from(notifications)
      .where(and(isNull(notifications.readAt), ne(notifications.severity, "info"), gte(notifications.createdAt, twoHoursAgo))),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(emailMessages).where(needsReplyWhere),
    getPendingDraftCount(),
    getMonitors().catch(() => null),
    getVpsHealth().catch(() => null),
    getOverdueSupportCount(12),
    recentFeedback("all", twoHoursAgo, 20),
  ]);

  if (failingJobs.length) lines.push(`Failing jobs: ${failingJobs.map((j) => j.name).join(", ")}.`);
  if (freshAlerts.length) lines.push(`${freshAlerts.length} unhandled alert(s) in the last 2h: ${freshAlerts.slice(0, 5).map((a) => `[${a.severity}] ${a.title}`).join("; ")}.`);

  const mailToDraft = (actionableMail[0]?.n ?? 0) - pendingDrafts;
  if (mailToDraft > 0) lines.push(`${mailToDraft} support email(s) need a reply and have no draft yet.`);
  if (overdueMail > 0) lines.push(`${overdueMail} support email(s) have been waiting over 12h — prioritize drafting a reply.`);

  const negFb = recentFb.filter((f) => isNegativeRating(f.rating));
  if (negFb.length) {
    const sample = negFb.find((f) => f.message)?.message?.replace(/\s+/g, " ").slice(0, 120);
    lines.push(`${negFb.length} new negative user feedback in the last 2h${sample ? ` (e.g. "${sample}")` : ""} — review it and recommend a fix or response.`);
  }

  const down = (monitors?.http ?? []).filter((h) => h.status === "down");
  if (down.length) lines.push(`Sites/monitors DOWN: ${down.map((h) => h.key).join(", ")}.`);
  if (monitors?.rate?.status === "down") lines.push(`CheckInvestNg rate pipeline is stale${monitors.rate.error ? ` (${monitors.rate.error})` : ""}.`);

  if (vps) {
    if (vps.diskUsedPct >= 85) lines.push(`Disk is ${vps.diskUsedPct}% full.`);
    // lastBackupAt is epoch SECONDS (see collect-vps-health.sh / site-health page); convert to ms before comparing.
    if (vps.lastBackupAt && Date.now() - vps.lastBackupAt * 1000 > 30 * 3600_000) lines.push("Nightly backup looks overdue (>30h).");
  }

  return { needsAttention: lines.length > 0, lines };
}

export type TickResult = { ran: boolean; reason: string; handled?: boolean };

export async function runAutopilot(): Promise<TickResult> {
  if (await isTessPaused()) return { ran: false, reason: "paused" };

  const state = await getState();
  // Self-throttle: after 2 straight failures, back off and alert once.
  if (state.consecutiveFails >= 2) {
    const last = state.throttleAlertedAt ? Date.parse(state.throttleAlertedAt) : 0;
    if (Date.now() - last > 6 * 3600_000) {
      await notify({ severity: "warning", title: "⚠️ Tess autopilot throttled", body: `Paused autonomous runs after ${state.consecutiveFails} consecutive failures (last: ${state.lastResult ?? "unknown"}). She still responds to you directly. Resolve and she resumes automatically.`, module: "agent" });
      await setState({ ...state, throttleAlertedAt: new Date().toISOString() });
    }
    return { ran: false, reason: "throttled" };
  }

  const budget = await budgetStatus();
  const digest = await buildDigest();
  if (!digest.needsAttention) {
    await setState({ ...state, consecutiveFails: 0, lastRunAt: new Date().toISOString(), lastResult: "idle — nothing needed attention" });
    return { ran: false, reason: "idle" };
  }

  const text = [
    "AUTONOMOUS OPERATIONS CHECK (every 30 min). Current situation from a deterministic scan:",
    ...digest.lines.map((l) => `- ${l}`),
    "",
    "Handle what you can within your authority, using your tools:",
    "- Draft replies to unanswered support mail (they queue for the admin to send).",
    "- Investigate and act on alerts; mark handled ones read; run a stuck job if that fixes it.",
    "- For routine server issues use vps_action; for risky ones queue_approval.",
    "- Send the admin clear recommendations for anything you can't do yourself (e.g. site content).",
    "Be efficient and concise. When done, briefly summarize what you did.",
  ].join("\n");

  const res = await runTess({ text, channel: "autonomous", author: "autopilot" });

  const next: AutopilotState = {
    consecutiveFails: res.ok ? 0 : state.consecutiveFails + 1,
    lastRunAt: new Date().toISOString(),
    lastResult: (res.reply || "").slice(0, 300),
    throttleAlertedAt: res.ok ? undefined : state.throttleAlertedAt,
  };
  await setState(next);
  return { ran: true, reason: budget.degraded ? "ran (degrade mode)" : "ran", handled: res.ok };
}
