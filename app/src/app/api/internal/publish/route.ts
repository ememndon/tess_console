import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { publishDuePosts } from "@/lib/publish";

// Internal publisher trigger — called by the cron from inside the
// container. Deterministic: publishes due posts to autonomous channels and writes
// handoff files; records its run in the Jobs Monitor.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const started = Date.now();
  let r: Awaited<ReturnType<typeof publishDuePosts>>;
  try {
    r = await publishDuePosts();
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  const dur = Date.now() - started;
  const summary = `published ${r.published}, handoff ${r.handoff}, failed ${r.failed}, skipped ${r.skipped}`;
  await db.execute(sql`
    INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
    VALUES ('social-publish', now() - (${dur} * interval '1 millisecond'), now(), 'ok', ${summary})
  `);
  await db.execute(sql`
    UPDATE jobs SET last_run_at = now(), last_status = 'ok', last_duration_ms = ${dur}, last_output = ${summary}
    WHERE name = 'social-publish'
  `);
  return Response.json({ ok: true, ...r });
}
