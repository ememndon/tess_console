import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { runDnsChecks } from "@/lib/dns-check";

// Internal SPF/DKIM/DMARC/MX verification trigger. Daily cron from
// inside the container, shared-secret guarded. Read-only DNS lookups.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-internal-key");
  if (!safeKeyEqual(key)) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const result = await runDnsChecks();
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
