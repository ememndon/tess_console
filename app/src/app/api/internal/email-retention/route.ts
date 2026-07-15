import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { purgeOldEmail } from "@/lib/dns-check";

// Internal email-retention purge — support mail holds personal data,
// so cached messages are pruned past the configured window. Daily cron, guarded.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const result = await purgeOldEmail();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
