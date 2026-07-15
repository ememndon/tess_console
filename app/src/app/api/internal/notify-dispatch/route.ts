import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { dispatchUndelivered } from "@/lib/notify";

// Notification delivery dispatcher. Fans out recent bell rows
// that were inserted directly by the deterministic shell-script alerts
// (uptime-check, rate-watchdog, social-publish, inbox-sync) to Telegram/email
// per routing. Plain code, runs every minute even when Tess is paused.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const result = await dispatchUndelivered();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
