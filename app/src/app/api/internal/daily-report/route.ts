import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildDailyReport, deliverDailyReport, buildWeeklyReview } from "@/lib/agent/report";

// Tess's morning report. Plain code on a cron: builds the deterministic
// report and delivers it to the owner (email + Telegram). Runs regardless of
// Tess's pause state (the optional LLM recommendations section self-skips if paused).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  // Preview: build a report and return it without sending (safe to call anytime).
  // ?weekly=1 previews the weekly strategic review instead of the daily.
  if (sp.get("dry") === "1") {
    const report = sp.get("weekly") === "1" ? await buildWeeklyReview() : await buildDailyReport();
    return Response.json({ ok: true, dry: true, subject: report.subject, text: report.text }, { headers: { "cache-control": "no-store" } });
  }

  const started = Date.now();
  try {
    const report = await buildDailyReport();
    const sent = await deliverDailyReport(report);
    // Mondays (UTC): also deliver the deeper weekly strategic review. Never let
    // the weekly failing break the daily.
    let weekly = false;
    if (new Date().getUTCDay() === 1) {
      try { await deliverDailyReport(await buildWeeklyReview()); weekly = true; } catch { /* skip */ }
    }
    const durMs = Date.now() - started;
    const summary = `sent — email:${sent.email ? "yes" : "no"} telegram:${sent.telegram ? "yes" : "no"}${weekly ? " +weekly" : ""}`;
    await recordRun("ok", durMs, summary);
    return Response.json({ ok: true, ...sent, weekly }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const durMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await recordRun("failed", durMs, msg.slice(0, 300)).catch(() => {});
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function recordRun(status: "ok" | "failed", durMs: number, output: string) {
  await db.execute(sql`
    INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
    VALUES ('daily-report', now() - (${durMs} * interval '1 millisecond'), now(), ${status}, ${output})
  `);
  await db.execute(sql`
    UPDATE jobs SET last_run_at = now(), last_status = ${status}, last_duration_ms = ${durMs}, last_output = ${output}
    WHERE name = 'daily-report'
  `);
}
