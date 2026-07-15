import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaJobs } from "@/lib/db/schema";
import { reResolveBRoll } from "@/lib/demo/scenario";
import type { DemoScenario, BRoll } from "@/lib/demo/types";

// Re-render an existing demo with FRESH stock B-roll but the SAME script + voiceover —
// so it costs no LLM and no TTS (the voiceover cache hits on the identical lines). It
// copies a source job's scenario, re-resolves only the b-roll clips (on-brand per the
// site's curated queries — e.g. CheckInvest's Nigeria/finance terms), and enqueues a
// new render. Internal-key guarded; reachable only on the compose network.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const jobId = sp.get("job")?.trim();
  if (!jobId) return Response.json({ error: "pass ?job=<sourceJobId>" }, { status: 400 });

  const [src] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, jobId)).limit(1);
  if (!src) return Response.json({ error: "source job not found" }, { status: 404 });

  const scenario = src.scenario as DemoScenario;
  const bRoll = (scenario.bRoll ?? []) as BRoll[];
  if (!bRoll.length) return Response.json({ error: "source scenario has no b-roll to re-resolve" }, { status: 400 });

  const newBRoll = await reResolveBRoll(bRoll, scenario.site);
  const newScenario = { ...scenario, bRoll: newBRoll };
  const formats = sp.get("formats") ? (JSON.parse(sp.get("formats")!) as string[]) : (src.formats as string[]);

  const [job] = await db
    .insert(mediaJobs)
    .values({
      site: src.site,
      recipeId: src.recipeId,
      feature: src.feature,
      url: src.url,
      scenario: newScenario,
      formats,
      voice: src.voice,
      music: src.music,
      status: "pending",
      requestedBy: "rebroll",
      createdBy: "tess",
    })
    .returning({ id: mediaJobs.id });

  return Response.json({
    ok: true,
    jobId: job.id,
    bRoll: newBRoll.map((b) => ({ kind: b.kind ?? "video", credit: b.credit, url: b.videoUrl })),
  });
}
