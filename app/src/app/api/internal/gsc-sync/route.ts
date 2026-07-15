import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { syncGsc } from "@/lib/gsc-sync";

// Internal GSC sync trigger. Called by the daily cron from inside the
// container (localhost), guarded by a shared secret. Not exposed through the dev
// wall. The sync records its own run in the Jobs Monitor.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const result = await syncGsc();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
