import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaJobs } from "@/lib/db/schema";
import { enqueueUrlDemo } from "@/lib/demo/tour";
import { scheduledSiteFor, selectScheduledTarget, VIDEO_RENDER_HOUR_UTC } from "@/lib/demo/schedule";
import { defaultVoiceForSite } from "@/lib/demo/voices";
import { SITE_KEYS, type SiteKey } from "@/lib/site-scope";
import { isTessPaused } from "@/lib/agent/control";
import { isGenerationSuspended } from "@/lib/content-suspend";
import { nextPlannedItem } from "@/lib/research/grid";
import { generatePlanItem } from "@/lib/research/generate-post";

// Weekly demo-video scheduler. Poked once a day by cron
// (scripts/demo-scheduler.sh). Picks today's site + target, writes a fresh brand-voice
// script (LLM), and enqueues ONE render (9:16 + 16:9) as a Social Studio DRAFT — never
// auto-posts (guardrail #1). Because it drives Tess's brain (scriptwriter) and spends
// TTS credits, the AUTONOMOUS daily run honors the global pause and stays idle while
// Tess is paused; the owner's manual/forced/dry runs still work.
// Guarded by INTERNAL_SYNC_KEY; reachable only on the compose network.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const dry = sp.get("dry") === "1";
  const force = sp.get("force") === "1";
  const siteParam = sp.get("site")?.trim();
  const urlParam = sp.get("url")?.trim();
  const now = new Date();

  // Manual override (owner / testing): force a specific site and/or URL outside the
  // weekday rotation — e.g. "render ResumeHub now". When overridden we skip the
  // once-per-day idempotency guard so the owner can re-trigger on demand.
  const override = !!(siteParam || urlParam);

  // Global pause: the autonomous daily run no-ops while Tess is paused, so the cron can
  // be installed now and will only start producing videos once you unpause Tess. Manual
  // (?site/?url), forced (?force=1) and dry (?dry=1) runs by the owner are unaffected.
  if (!dry && !force && !override && (await isTessPaused())) {
    return Response.json({ skipped: true, reason: "paused", detail: "Tess is paused — the demo scheduler stays idle until you unpause Tess." });
  }

  const site = (siteParam && (SITE_KEYS as readonly string[]).includes(siteParam) ? (siteParam as SiteKey) : scheduledSiteFor(now));
  if (!site) return Response.json({ skipped: true, reason: "no site scheduled today (Sunday is off)" });
  // Per-site suspend: skip the automatic daily video for suspended sites (owner can
  // still force=1 manually). Lifted by clearing the site from generation_suspended.
  if (!force && (await isGenerationSuspended(site))) return Response.json({ skipped: true, reason: "generation suspended for this site", site });

  // Timing: one fixed render hour for ALL videos (UTC). With an hourly cron, the
  // autonomous run fires at/after that hour; the once-per-day idempotency guard
  // stops it firing again the same day. Manual/forced/dry runs skip the gate.
  if (!override && !force && !dry && now.getUTCHours() < VIDEO_RENDER_HOUR_UTC) {
    return Response.json({ skipped: true, reason: "before the video render hour", site, renderHourUtc: VIDEO_RENDER_HOUR_UTC, hourNow: now.getUTCHours() });
  }

  // Idempotency FIRST (before selecting/committing a page): never enqueue a second
  // *scheduled* job for this site on the same UTC day (e.g. if the cron double-fires).
  // Skipped for manual/forced runs. Done before selection so a skipped double-fire
  // doesn't consume a slot in the no-repeat rotation.
  if (!override && !force) {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const existing = await db
      .select({ id: mediaJobs.id })
      .from(mediaJobs)
      .where(and(eq(mediaJobs.requestedBy, "scheduler"), eq(mediaJobs.site, site), gte(mediaJobs.createdAt, startOfDay)));
    if (existing.length) {
      return Response.json({ skipped: true, reason: "already queued today", site, jobId: existing[0].id });
    }
  }

  // The Content Director plan GUIDES the daily video: if this site has an unused
  // VIDEO brief, render that (smart pick: feature demo or narrated tour) instead of
  // the generic rotation. Enqueued as requestedBy='scheduler' so the once-per-day
  // idempotency above covers it. Falls through to the rotation when the plan is
  // empty. Skipped for manual (?site/?url) overrides and dry runs.
  if (!override && !dry) {
    const item = await nextPlannedItem(site, "video");
    if (item) {
      const r = await generatePlanItem(item.id, { actor: "Tess (scheduler)", requestedBy: "scheduler", createdBy: "tess" });
      if (r.ok) return Response.json({ ok: true, source: "content-director", site, planRef: item.planRef, subtopic: item.subtopic, jobId: r.jobId });
    }
  }

  // A specific ?url= is taken as-is (no pool/rotation). Otherwise Tess picks a random
  // page from the site's category, never repeating until the round is exhausted.
  // commit=false on dry runs so a preview doesn't advance the rotation cursor.
  const target = urlParam
    ? { url: urlParam, feature: "Manual page", notes: undefined as string | undefined }
    : await selectScheduledTarget(site, { commit: !dry });
  if (!target) {
    return Response.json({ skipped: true, reason: "no pages in this site's category yet (content inventory empty — wait for the nightly crawl)", site });
  }

  const voice = defaultVoiceForSite(site);
  if (dry) {
    return Response.json({ dryRun: true, override, wouldEnqueue: { site, ...target, voice } });
  }

  const res = await enqueueUrlDemo({
    url: target.url,
    site,
    requestedBy: override ? "scheduler-manual" : "scheduler",
    createdBy: "tess",
    actor: override ? "Tess (manual)" : "Tess (scheduler)",
    voice,
    music: "auto",
    notes: target.notes,
  });
  return Response.json({ ok: true, override, site, feature: res.feature, url: target.url, voice, jobId: res.jobId, guard: res.guard });
}
