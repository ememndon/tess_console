import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { runAutopilot } from "@/lib/agent/autopilot";

// Tess's autonomous heartbeat. A host cron pokes this every 30 min.
// It no-ops cheaply when she's paused, throttled, or there's nothing to do — the
// LLM only runs when the deterministic scan finds work. Records its own job run.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  const started = Date.now();
  try {
    const r = await runAutopilot();
    const durMs = Date.now() - started;
    const summary = r.ran ? `ran — ${r.handled ? "handled" : "attempted"}` : r.reason;
    await record("ok", durMs, summary);
    return Response.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const durMs = Date.now() - started;
    const msg = e instanceof Error ? e.message : String(e);
    await record("failed", durMs, msg.slice(0, 300)).catch(() => {});
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function record(status: "ok" | "failed", durMs: number, output: string) {
  await db.execute(sql`INSERT INTO job_runs (job_name, started_at, finished_at, status, output) VALUES ('agent-tick', now() - (${durMs} * interval '1 millisecond'), now(), ${status}, ${output})`);
  await db.execute(sql`UPDATE jobs SET last_run_at = now(), last_status = ${status}, last_duration_ms = ${durMs}, last_output = ${output} WHERE name = 'agent-tick'`);
}
