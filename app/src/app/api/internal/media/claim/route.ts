import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { secrets } from "@/lib/db/schema";
import { decryptSecret } from "@/lib/vault";

// Demo Studio worker → claims one pending render job atomically (FOR UPDATE SKIP
// LOCKED so only one worker ever gets a given job). Guarded by INTERNAL_SYNC_KEY;
// reachable only on the compose network (the tess-media container), never via Caddy.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cloud TTS engines need a provider key. We deliver the DECRYPTED key in the claim
// response (only for the claimed job, only over the internal network) so the vault
// stays the single source of truth and the worker never holds long-lived secrets.
const TTS_KEY_FOR: Record<string, string> = {
  gemini: "gemini_api_key",
  openai: "openai_api_key",
  eleven: "elevenlabs_api_key",
};

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const rows = (await db.execute(sql`
    UPDATE media_jobs SET status = 'running', started_at = now()
    WHERE id = (
      SELECT id FROM media_jobs WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, site, recipe_id AS "recipeId", feature, url, scenario, formats, voice, music, created_by AS "createdBy";
  `)) as unknown as Record<string, unknown>[];
  const job = rows[0] ?? null;

  if (job) {
    const provider = String(job.voice || "").split(":")[0];
    const keyName = TTS_KEY_FOR[provider];
    if (keyName) {
      const [row] = await db.select().from(secrets).where(eq(secrets.key, keyName));
      if (row?.valueEnc) {
        try {
          job.ttsKey = decryptSecret(row.valueEnc);
        } catch {
          /* leave unset — the worker will fail the job with a clear message */
        }
      }
    }
  }
  return Response.json({ job });
}
