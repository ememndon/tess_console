import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { syncAllMailboxes } from "@/lib/mail/sync";
import { runAutopilot } from "@/lib/agent/autopilot";

// Internal inbox sync trigger. Called every few minutes by cron from
// inside the container (localhost), guarded by a shared secret. Plain code, not
// the AI agent — runs regardless of Tess's pause state. Records its own Jobs run.
// When the sync pulls in NEW actionable mail, it nudges Tess's autopilot so she
// drafts a reply right away (within the 5-min sync cycle) instead of waiting for
// the 30-min heartbeat. runAutopilot self-gates on pause/budget/throttle, so this
// is a no-op while she's paused.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const result = await syncAllMailboxes();
    const newActionable = result.perBox.reduce((n, r) => n + (r.actionable ?? 0), 0);
    let autopilot: unknown = undefined;
    if (newActionable > 0) {
      autopilot = await runAutopilot().catch((e) => ({ ran: false, reason: e instanceof Error ? e.message : String(e) }));
    }
    return Response.json({ ...result, newActionable, autopilot }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
