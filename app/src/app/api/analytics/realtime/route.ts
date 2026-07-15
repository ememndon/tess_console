import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getRealtime } from "@/lib/analytics";
import { SITE_KEYS, type SiteScope } from "@/lib/site-scope";

// Lightweight, fast-polled endpoint for the analytics live strip. Returning just
// the real-time slice (active count + last events) lets the client refresh every
// few seconds without re-rendering the whole dashboard. Session-gated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const raw = new URL(req.url).searchParams.get("scope") ?? "all";
  const scope: SiteScope = raw === "all" || (SITE_KEYS as string[]).includes(raw) ? (raw as SiteScope) : "all";

  const data = await getRealtime(scope);
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
