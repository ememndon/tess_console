"use server";

import { eq } from "drizzle-orm";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/db";
import { socialPosts, socialMedia } from "@/lib/db/schema";
import { MEDIA_ROOT } from "@/lib/banner";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { runCaptionStudio, regenerateCaption, type CaptionSource, type CaptionStudioOutput } from "@/lib/caption/studio";
import { CAPTION_PLATFORMS, type CaptionPlatform, type CaptionResult, type CaptionTone } from "@/lib/caption-platforms";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Strip the media root so an absolute stored path becomes a /api/media/<rel> URL.
const toRel = (abs: string) => (abs.startsWith(MEDIA_ROOT + "/") ? abs.slice(MEDIA_ROOT.length + 1) : abs);

// The image/video attached to a post, so Caption Studio can show what it's
// captioning. Prefers an image; falls back to the first media (e.g. a video).
// Cache-busted with the media row id so a re-rendered banner isn't served stale.
async function postPreview(
  postId: string,
): Promise<{ previewUrl: string; previewType: "image" | "video" } | null> {
  const media = await db.select().from(socialMedia).where(eq(socialMedia.postId, postId));
  if (!media.length) return null;
  const chosen = media.find((m) => m.type === "image") ?? media[0];
  const type = chosen.type === "video" ? "video" : "image";
  return { previewUrl: `/api/media/${toRel(chosen.path)}?v=${String(chosen.id).slice(0, 8)}`, previewType: type };
}

// Preview a Post ID before generating: confirms it exists, which site it belongs
// to, whether it's a video (→ keyframe vision), a short label, and a thumbnail of
// the post's image/video so you can see at a glance what you're captioning.
export async function resolveCaptionPost(
  ref: string,
): Promise<{
  ok: boolean;
  site?: string;
  siteName?: string;
  kind?: string;
  label?: string;
  previewUrl?: string;
  previewType?: "image" | "video";
  error?: string;
}> {
  if (!(await requireOperator())) return { ok: false, error: "Not authorized." };
  const clean = ref.replace(/[^0-9]/g, "");
  if (!clean) return { ok: false, error: "Enter a Post ID." };
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
  if (!post) return { ok: false, error: `No post #${clean} found.` };
  const data = (post.data as Record<string, unknown>) ?? {};
  const label = str(data.subtopic) || str(data.topic) || str(data.feature) || str(data.headline) || `#${clean}`;
  const preview = await postPreview(post.id);
  return {
    ok: true,
    site: post.site,
    siteName: SITE_META[post.site as SiteKey]?.name ?? post.site,
    kind: post.kind,
    label,
    previewUrl: preview?.previewUrl,
    previewType: preview?.previewType,
  };
}

// Generate per-platform captions for a Post ID or a typed description. (Image and
// video uploads go through /api/console/caption-upload because of their size.)
export async function runCaptions(input: {
  source: CaptionSource;
  platforms: CaptionPlatform[];
  tone?: CaptionTone;
  locale?: string;
}): Promise<CaptionStudioOutput> {
  if (!(await requireOperator())) return { ok: false, results: [], error: "Not authorized." };
  if (input.source.kind !== "post" && input.source.kind !== "text") {
    return { ok: false, results: [], error: "Uploads use a different endpoint." };
  }
  const platforms = input.platforms.filter((p): p is CaptionPlatform => (CAPTION_PLATFORMS as readonly string[]).includes(p));
  if (!platforms.length) return { ok: false, results: [], error: "Pick at least one platform." };
  const out = await runCaptionStudio({ source: input.source, platforms, tone: input.tone, locale: input.locale });
  // Persist on the post so the results survive leaving the page (post source only —
  // typed/uploaded sources have no post to attach to).
  if (out.ok && input.source.kind === "post") await persistCaptions(input.source.ref, out.results).catch(() => {});
  return out;
}

// Persist/load per-platform captions on the source post (data.captions). Keeps the
// Caption Studio results across reloads, like the YouTube pack.
async function persistCaptions(ref: string, results: CaptionResult[]): Promise<void> {
  const clean = ref.replace(/[^0-9]/g, "");
  if (!clean) return;
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
  if (!post) return;
  const data = (post.data as Record<string, unknown>) ?? {};
  await db.update(socialPosts).set({ data: { ...data, captions: { results: results.slice(0, 12), builtAt: new Date().toISOString() } } }).where(eq(socialPosts.id, post.id));
}

export async function getSavedCaptions(ref: string): Promise<CaptionResult[] | null> {
  if (!(await requireOperator())) return null;
  const clean = ref.replace(/[^0-9]/g, "");
  if (!clean) return null;
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
  const cap = (post?.data as Record<string, unknown> | undefined)?.captions as { results?: CaptionResult[] } | undefined;
  return Array.isArray(cap?.results) && cap.results.length ? cap.results : null;
}

// Save edited/regenerated captions back to the post (post source only).
export async function saveCaptions(ref: string, results: CaptionResult[]): Promise<{ ok: boolean }> {
  if (!(await requireOperator())) return { ok: false };
  if (!Array.isArray(results)) return { ok: false };
  await persistCaptions(ref, results).catch(() => {});
  return { ok: true };
}

// Regenerate a single platform card (post / text sources). Upload sources
// regenerate by re-calling the upload route with one platform.
export async function regenerateOne(
  source: CaptionSource,
  platform: CaptionPlatform,
  opts: { tone?: CaptionTone; locale?: string },
): Promise<CaptionResult> {
  const fail = (error: string): CaptionResult => ({ platform, caption: "", hashtags: [], hookScore: null, hookReason: "", error });
  if (!(await requireOperator())) return fail("Not authorized.");
  if (source.kind !== "post" && source.kind !== "text") return fail("Use the upload endpoint to regenerate this.");
  try {
    return await regenerateCaption(source, platform, opts);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Regeneration failed.");
  }
}
