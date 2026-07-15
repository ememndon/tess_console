import type { NextRequest } from "next/server";
import { verifyWebhookSecret, handleUpdate } from "@/lib/agent/telegram-bot";

// Telegram command channel webhook. Bypasses the Caddy dev wall (it has
// its own secret-token check) so Telegram's servers can reach it. Self-secured by
// the X-Telegram-Bot-Api-Secret-Token header set at registration time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!(await verifyWebhookSecret(secret))) {
    return new Response("forbidden", { status: 403 });
  }
  let update: unknown = null;
  try {
    update = await req.json();
  } catch {
    return Response.json({ ok: true }); // ignore malformed; never make Telegram retry
  }
  // Process best-effort; always 200 so Telegram doesn't requeue.
  try {
    await handleUpdate(update as Parameters<typeof handleUpdate>[0]);
  } catch {
    /* swallow — a thrown handler must not turn into a retry loop */
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
