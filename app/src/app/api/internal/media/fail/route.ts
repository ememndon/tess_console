import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaJobs } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { SITE_META, type SiteKey } from "@/lib/site-scope";

// Demo Studio worker → reports a failed render so the job doesn't hang in 'running'.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { jobId?: string; error?: string } | null;
  if (!body?.jobId) return new Response("jobId required", { status: 400 });

  const [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, body.jobId)).limit(1);
  if (!job) return new Response("job not found", { status: 404 });

  const err = (body.error || "render failed").slice(0, 1000);
  await db.update(mediaJobs).set({ status: "failed", result: err, finishedAt: new Date() }).where(eq(mediaJobs.id, job.id));
  await audit({ actorName: "tess-media", action: "demo.fail", target: job.recipeId, detail: { jobId: job.id, error: err.slice(0, 200) } });
  await notify({
    severity: "warning",
    title: `🎬 Demo render failed — ${SITE_META[job.site as SiteKey]?.name ?? job.site}`,
    body: `"${job.feature}" couldn't render: ${err.slice(0, 200)}`,
    module: "demo",
  });
  return Response.json({ ok: true });
}
