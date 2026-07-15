import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaJobs, socialPosts, socialMedia } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { newPostRef } from "@/lib/social";
import { SITE_META, type SiteKey } from "@/lib/site-scope";

// Demo Studio worker → reports a finished render. The worker has already written the
// media files into the shared ./media volume; here the APP is the sole DB writer:
// it creates the Social Studio DRAFT (kind=video), attaches the media, marks the job
// done, and notifies the owner to review & post. Nothing is auto-posted (guardrail #1).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaIn = { type: string; path: string; width?: number; height?: number };

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    jobId?: string;
    media?: MediaIn[];
    caption?: string;
    durationSec?: number;
  } | null;
  if (!body?.jobId) return new Response("jobId required", { status: 400 });

  const [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, body.jobId)).limit(1);
  if (!job) return new Response("job not found", { status: 404 });

  const scenario = (job.scenario ?? {}) as { caption?: string; hashtags?: unknown; bare?: boolean };
  const hashtags = Array.isArray(scenario.hashtags) ? (scenario.hashtags as string[]) : [];
  const baseCaption = (body.caption || scenario.caption || job.feature).trim();
  const caption = hashtags.length ? `${baseCaption}\n\n${hashtags.join(" ")}` : baseCaption;
  const media = Array.isArray(body.media) ? body.media : [];

  // Console-showcase (bare) renders are an internal pipeline, not social content: they
  // film the console itself for the portfolio video. Skip the Social Studio draft, the
  // media rows, and the "demo ready" notification (an 18-section batch would otherwise
  // flood the queue + notifications and steal the newest-video slot section 6 relies on).
  // The rendered file already lives in the shared media volume; just mark the job done.
  if (scenario.bare) {
    await db
      .update(mediaJobs)
      .set({ status: "done", result: `rendered ${media.length} files`, finishedAt: new Date() })
      .where(eq(mediaJobs.id, job.id));
    await audit({
      actorName: "tess-media",
      action: "demo.complete",
      target: job.recipeId,
      detail: { jobId: job.id, files: media.length, bare: true },
    });
    return Response.json({ ok: true, bare: true });
  }

  const ref = await newPostRef();
  const [post] = await db
    .insert(socialPosts)
    .values({
      ref,
      site: job.site,
      kind: "video",
      caption,
      status: "draft",
      createdBy: job.createdBy || "tess",
      data: {
        source: "demo",
        recipeId: job.recipeId,
        feature: job.feature,
        hashtags,
        durationSec: body.durationSec ?? null,
        jobId: job.id,
      },
    })
    .returning({ id: socialPosts.id });

  for (const m of media) {
    if (!m?.path) continue;
    await db.insert(socialMedia).values({
      postId: post.id,
      type: m.type === "image" ? "image" : "video",
      path: m.path,
      width: m.width ?? null,
      height: m.height ?? null,
    });
  }

  await db
    .update(mediaJobs)
    .set({ status: "done", postId: post.id, result: `rendered ${media.length} files`, finishedAt: new Date() })
    .where(eq(mediaJobs.id, job.id));

  await audit({
    actorName: "tess-media",
    action: "demo.complete",
    target: job.recipeId,
    detail: { jobId: job.id, postId: post.id, files: media.length },
  });

  const videoCount = media.filter((m) => m.type !== "image").length;
  await notify({
    severity: "info",
    title: `🎬 Demo video ready — ${SITE_META[job.site as SiteKey]?.name ?? job.site}`,
    body: `"${job.feature}" — ${videoCount} video format${videoCount === 1 ? "" : "s"} drafted in Social Studio. Review & post.`,
    module: "demo",
  });

  // NOTE: the YouTube Pack (titles + SEO description + thumbnails) is NOT built
  // automatically here. The owner generates it manually during review via the
  // "Generate YouTube Pack" button, so the heavy thumbnail/face-restoration work
  // never runs on the back of a video render.

  return Response.json({ ok: true, postId: post.id });
}
