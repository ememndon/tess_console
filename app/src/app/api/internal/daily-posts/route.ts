import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialPosts } from "@/lib/db/schema";
import { generateDailyPost, POSTS_PER_DAY } from "@/lib/social/daily-plan";
import { SITE_KEYS } from "@/lib/site-scope";
import { isTessPaused } from "@/lib/agent/control";
import { isGenerationSuspended } from "@/lib/content-suspend";

// Daily content pipeline. Poked once an hour 00:00–04:00 UTC by cron
// (scripts/daily-posts.sh). Each run generates ONE post per site for that slot
// (slot = UTC hour 0..4), so all 5 posts/site are queued as Social Studio DRAFTS by
// ~05:00 for the admin to review and schedule manually. Honors the global pause.
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
  const now = new Date();

  // Slot = the day's Nth generation hour. Cron fires at UTC hours 0..4; otherwise
  // pass ?slot= explicitly (for manual/testing).
  const slot = sp.get("slot") != null ? Number(sp.get("slot")) : now.getUTCHours();
  if (!Number.isInteger(slot) || slot < 0 || slot >= POSTS_PER_DAY) {
    return Response.json({ skipped: true, reason: `outside generation window (slot ${slot}); posts generate at UTC hours 0..${POSTS_PER_DAY - 1}` });
  }

  // Pause gate (autonomous run only). Dry + forced runs always work.
  if (!dry && !force && (await isTessPaused())) {
    return Response.json({ skipped: true, reason: "paused", detail: "Tess is paused — the daily post pipeline stays idle until you unpause Tess." });
  }

  const siteParam = sp.get("site");
  const sites = siteParam && (SITE_KEYS as readonly string[]).includes(siteParam) ? [siteParam] : (SITE_KEYS as readonly string[]);

  const results: unknown[] = [];
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const site of sites) {
    // Per-site suspend: skip automatic generation for suspended sites (owner can
    // still force=1 manually). Lifted by clearing the site from generation_suspended.
    if (!force && (await isGenerationSuspended(site))) {
      results.push({ site, slot, skipped: "generation suspended" });
      continue;
    }
    // Idempotency: one pipeline post per site per slot per UTC day (skip on force/dry).
    if (!force && !dry) {
      const existing = await db
        .select({ id: socialPosts.id })
        .from(socialPosts)
        .where(and(eq(socialPosts.site, site), gte(socialPosts.createdAt, startOfDay), sql`(${socialPosts.data} ->> 'source') = 'daily-pipeline'`, sql`(${socialPosts.data} ->> 'slot') = ${String(slot)}`));
      if (existing.length) {
        results.push({ site, slot, skipped: "already generated today" });
        continue;
      }
    }
    try {
      const r = await generateDailyPost({ site, slot, date: now, commit: !dry });
      results.push({ site, slot, pillar: r.pillar, image: r.image, page: r.page, platforms: r.platforms, ref: r.ref, guard: r.guard, ...(dry ? { caption: r.caption } : {}) });
    } catch (e) {
      results.push({ site, slot, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  return Response.json({ ok: true, dry, slot, results });
}
