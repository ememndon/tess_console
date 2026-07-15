"use server";

import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialPosts, socialTargets, socialMedia, socialConfig, brandProfiles, notifications, tessFiles } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { renderBanner, MEDIA_ROOT } from "@/lib/banner";
import { renderAiImage, generateAiBackgroundBytes } from "@/lib/image-gen";
import { renderVideo } from "@/lib/video";
import { fetchStockPhoto, stockQueryFor } from "@/lib/stock-media";
import { writeHandoff } from "@/lib/handoff";
import { generateCaption, generateBannerCopy, generateCaptionVariants } from "@/lib/generate";
import { reviewPost } from "@/lib/social/review";
import { notePreference } from "@/lib/agent/feedback";
import { newPostRef } from "@/lib/social";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { PLATFORMS, type Platform } from "@/lib/social-types";

export type CreatePostInput = {
  site: string;
  kind: "text" | "banner" | "video" | "ai_image";
  caption: string;
  headline?: string;
  subtitle?: string;
  badge?: string;
  imagePrompt?: string; // for kind "ai_image" (Gemini Nano Banana)
  platforms: Platform[];
  scheduleAt?: string | null; // ISO; null/empty = prepare now
};

// Hashtags are NOT folded into the caption — they live in their own field on the
// draft (see the post dialog), so the caption stays clean and the owner copies
// hashtags separately. Only the disclaimer (if any) is appended to the caption.
function fullCaption(caption: string, nfa: boolean): string {
  const parts = [caption.trim()];
  if (nfa) parts.push("Not financial advice.");
  return parts.filter(Boolean).join("\n\n");
}

export async function createPost(input: CreatePostInput): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(input.site)) return { ok: false, message: "Unknown brand." };
  const platforms = input.platforms.filter((p) => (PLATFORMS as readonly string[]).includes(p));
  if (platforms.length === 0) return { ok: false, message: "Pick at least one channel." };
  const caption = input.caption.trim();
  if (input.kind === "text" && !caption) return { ok: false, message: "Write a caption." };
  if ((input.kind === "banner" || input.kind === "video") && !(input.headline?.trim() || caption))
    return { ok: false, message: `Add a headline for the ${input.kind}.` };
  if (input.kind === "ai_image" && !(input.imagePrompt?.trim() || caption))
    return { ok: false, message: "Describe the image you want Tess to generate." };
  // AI images are stored as image posts ("banner" kind in the DB).
  const dbKind = input.kind === "ai_image" ? "banner" : input.kind;

  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, input.site));
  const hashtags = (brand?.hashtags as string[]) ?? [];
  const nfa = !!brand?.notFinancialAdvice;
  const scheduledAt = input.scheduleAt ? new Date(input.scheduleAt) : null;

  const [post] = await db
    .insert(socialPosts)
    .values({
      ref: await newPostRef(),
      site: input.site,
      kind: dbKind,
      caption: fullCaption(caption, nfa),
      status: scheduledAt ? "scheduled" : "ready",
      scheduledAt,
      createdBy: user.name,
    })
    .returning();

  const mediaPaths: string[] = [];
  if (input.kind === "ai_image") {
    const r = await renderAiImage(post.id, (input.imagePrompt || caption).trim());
    await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
    mediaPaths.push(r.path);
  } else if (input.kind === "banner") {
    const r = await renderBanner(post.id, {
      site: input.site,
      title: (input.headline || caption).trim(),
      subtitle: input.subtitle?.trim() || undefined,
      badge: input.badge?.trim() || undefined,
      hashtags,
    });
    await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
    mediaPaths.push(r.path);
  } else if (input.kind === "video") {
    const r = await renderVideo(post.id, {
      site: input.site,
      title: (input.headline || caption).trim(),
      badge: input.badge?.trim() || undefined,
      hashtags,
    });
    await db.insert(socialMedia).values({ postId: post.id, type: "video", path: r.path, width: r.width, height: r.height });
    mediaPaths.push(r.path);
    // The YouTube Pack is generated manually during review (Generate YouTube Pack
    // button), not automatically here — keeps the heavy thumbnail/face work off the
    // render path.
  }

  const cfg = await db.select().from(socialConfig).where(eq(socialConfig.site, input.site));
  for (const p of platforms) {
    const mode = cfg.find((c) => c.platform === p)?.mode ?? "handoff";
    await db.insert(socialTargets).values({ postId: post.id, platform: p, mode, status: "queued" });
  }

  if (!scheduledAt) await preparePost(post.id);

  await audit({ actorId: user.id, actorName: user.name, action: "social.compose", target: post.id, detail: { site: input.site, kind: input.kind, platforms } });
  revalidatePath("/social");
  return { ok: true, message: scheduledAt ? "Scheduled." : "Prepared — handoff items are in the queue." };
}

export type ManualImageSource = "design" | "ai" | "stock" | "upload";
export type ManualPostInput = {
  site: string;
  type: "text" | "image";
  imageSource?: ManualImageSource;
  uploadFileId?: string; // tess_files id (from /api/tess-files) for "upload"
  overlayText?: boolean; // upload: composite the headline/subhead onto the image (default true)
  caption?: string;
  generateCaption?: boolean; // let Tess write the caption
  headline?: string; // on-image header text
  subtitle?: string; // on-image subheading text
  targetUrl?: string; // the page being promoted
  comments?: string; // extra instructions for Tess
  hashtags?: string; // optional; blank = brand default set
  platforms: Platform[];
  scheduleAt?: string | null;
};

// Read an uploaded image (stored in tess_files as base64) back into raw bytes.
async function readUploadedImage(fileId: string): Promise<Buffer> {
  const [f] = await db.select().from(tessFiles).where(eq(tessFiles.id, fileId));
  if (!f) throw new Error("Uploaded image not found — re-upload and try again.");
  if (!String(f.mime).startsWith("image/")) throw new Error("That upload is not an image.");
  return Buffer.from(f.data as string, "base64");
}

// Manual post builder behind the Social Studio "Create" tab. One action covering
// text + image posts, with the image from a branded design, an AI backdrop, a
// stock photo, or the owner's own upload — the headline/subhead are composited
// on top as real type (same engine as the daily pipeline). Created as a draft
// (or scheduled) for review.
export async function createManualPost(input: ManualPostInput): Promise<{ ok: boolean; message: string; postId?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(input.site)) return { ok: false, message: "Unknown brand." };
  const platforms = input.platforms.filter((p) => (PLATFORMS as readonly string[]).includes(p));
  if (platforms.length === 0) return { ok: false, message: "Pick at least one channel." };

  const siteName = SITE_META[input.site as SiteKey]?.name ?? input.site;
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, input.site));
  const nfa = !!brand?.notFinancialAdvice;
  const targetUrl = input.targetUrl?.trim();
  const comments = input.comments?.trim();
  const primary = platforms.includes("linkedin") ? "linkedin" : "x";

  // ── Caption: use what was typed, or generate it from the page + comments. ──
  const topic = (input.headline?.trim() || targetUrl || `${siteName} post`).slice(0, 200);
  const guidance = [comments, targetUrl ? `The post promotes this page: ${targetUrl}` : ""].filter(Boolean).join(" ");
  let captionBody = (input.caption ?? "").trim();
  let numericOk = true;
  let genTags: string[] | null = null;
  if (input.generateCaption || !captionBody) {
    try {
      const r = await generateCaption({ site: input.site, topic, guidance, platform: primary });
      captionBody = r.caption.trim();
      numericOk = r.guard.ok;
      if (r.hashtags.length) genTags = r.hashtags;
    } catch (e) {
      return { ok: false, message: `Caption generation failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` };
    }
  }
  if (input.type === "text" && !captionBody) return { ok: false, message: "Write a caption or let Tess generate one." };
  const finalCaption = [captionBody, targetUrl || "", nfa ? "Not financial advice." : ""].filter(Boolean).join("\n\n");

  // ── On-image copy (only when text will be drawn on the image). ──
  const willOverlay = input.type === "image" && ((input.imageSource ?? "design") !== "upload" || input.overlayText !== false);
  let headline = input.headline?.trim() ?? "";
  let subhead = input.subtitle?.trim() ?? "";
  if (willOverlay && !headline) {
    try {
      const copy = await generateBannerCopy({ site: input.site, topic, guidance });
      headline = copy.headline;
      if (!subhead) subhead = copy.subhead;
    } catch {
      headline = topic;
    }
  }

  const scheduledAt = input.scheduleAt ? new Date(input.scheduleAt) : null;
  // Owner override wins; otherwise use the post-relevant tags Tess generated.
  const tags = input.hashtags?.trim() ? normalizeHashtags(input.hashtags) : genTags;
  const dbKind = input.type === "image" ? "banner" : "text";

  const [post] = await db
    .insert(socialPosts)
    .values({
      ref: await newPostRef(),
      site: input.site,
      kind: dbKind,
      caption: finalCaption,
      status: scheduledAt ? "scheduled" : "draft",
      scheduledAt,
      createdBy: user.name,
      data: { source: "manual", imageSource: input.imageSource ?? null, targetUrl: targetUrl ?? null, ...(tags ? { hashtags: tags } : {}) },
    })
    .returning();

  // ── Render the image. ──
  const imageOutcome = input.type === "image" ? (input.imageSource ?? "design") : "text";
  if (input.type === "image") {
    const spec = (bgImage?: Buffer) => ({ site: input.site, title: headline || topic, subtitle: subhead || undefined, bgImage });
    try {
      const src = input.imageSource ?? "design";
      if (src === "design") {
        const r = await renderBanner(post.id, spec());
        await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
      } else if (src === "ai") {
        const scene = `A premium, editorial brand backdrop for ${siteName} about "${headline || topic}"${comments ? `. ${comments}` : ""}. One clear focal point with calm negative space on the left for a headline overlay.`;
        const { data } = await generateAiBackgroundBytes(scene);
        const r = await renderBanner(post.id, spec(data));
        await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
      } else if (src === "stock") {
        const s = await fetchStockPhoto(stockQueryFor(input.site, headline || topic));
        if (!s) throw new Error("No stock photo matched — try a different headline/URL or another image source.");
        const r = await renderBanner(post.id, spec(s.data));
        await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
      } else {
        if (!input.uploadFileId) throw new Error("Upload an image first.");
        const buf = await readUploadedImage(input.uploadFileId);
        if (input.overlayText === false) {
          const dir = path.join(MEDIA_ROOT, "social", post.id);
          await fs.mkdir(dir, { recursive: true });
          const file = path.join(dir, `upload-${Date.now()}.png`);
          const meta = await sharp(buf).metadata().catch(() => ({ width: null, height: null }) as { width: number | null; height: number | null });
          await sharp(buf).png().toFile(file);
          await db.insert(socialMedia).values({ postId: post.id, type: "image", path: file, width: meta.width ?? null, height: meta.height ?? null });
        } else {
          const r = await renderBanner(post.id, spec(buf));
          await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
        }
      }
    } catch (e) {
      await db.delete(socialPosts).where(eq(socialPosts.id, post.id)); // an image post with no image is useless
      return { ok: false, message: `Image generation failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}` };
    }
  }

  // ── Quality guard + channel targets. ──
  const review = reviewPost({ caption: captionBody, headline: willOverlay ? headline || topic : undefined, subhead: subhead || undefined, image: imageOutcome, numericOk });
  await db
    .update(socialPosts)
    .set({ data: { source: "manual", imageSource: input.imageSource ?? null, targetUrl: targetUrl ?? null, review, ...(tags ? { hashtags: tags } : {}) } })
    .where(eq(socialPosts.id, post.id));

  const cfg = await db.select().from(socialConfig).where(eq(socialConfig.site, input.site));
  for (const p of platforms) {
    const mode = cfg.find((c) => c.platform === p)?.mode ?? "handoff";
    await db.insert(socialTargets).values({ postId: post.id, platform: p, mode, status: "queued" });
  }

  await audit({ actorId: user.id, actorName: user.name, action: "social.manual_create", target: post.id, detail: { site: input.site, type: input.type, imageSource: input.imageSource ?? null, platforms } });
  revalidatePath("/social");
  return {
    ok: true,
    postId: post.id,
    message: scheduledAt ? "Created and scheduled — review it in the Queue." : "Created as a draft — review it in the Queue, then Post now.",
  };
}

// Prepare a post now: handoff targets get their outbox files + a notification;
// autonomous targets stay queued for the publisher (live once accounts connect).
async function preparePost(postId: string) {
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return;
  const targets = await db.select().from(socialTargets).where(eq(socialTargets.postId, postId));
  const media = await db.select().from(socialMedia).where(eq(socialMedia.postId, postId));
  const mediaPaths = media.map((m) => m.path);
  let handoff = 0;

  for (const t of targets) {
    if (t.mode === "handoff") {
      await writeHandoff({ site: post.site, platform: t.platform, postId, caption: post.caption ?? "", mediaPaths });
      await db.update(socialTargets).set({ status: "handoff" }).where(eq(socialTargets.id, t.id));
      handoff++;
    }
  }

  // Safety net: a post with NO manual target (e.g. a Content Director / daily
  // draft created without channels) would otherwise be marked "done" on the next
  // publisher run and vanish. Route it to manual posting so its image + caption
  // always land in the "Ready for manual posting" widget instead of being lost.
  const willAutoPublish = targets.some((t) => t.mode === "autonomous");
  if (handoff === 0 && !willAutoPublish) {
    const planned = (post.data as { platform?: string } | null)?.platform ?? "";
    const platform = ((PLATFORMS as readonly string[]).includes(planned) ? planned : "facebook") as Platform;
    await db.insert(socialTargets).values({ postId, platform, mode: "handoff", status: "handoff" });
    await writeHandoff({ site: post.site, platform, postId, caption: post.caption ?? "", mediaPaths });
    handoff++;
  }

  if (handoff > 0) {
    await db.insert(notifications).values({
      severity: "info",
      title: "📥 Content ready for manual posting",
      body: `${handoff} item(s) prepared for ${post.site}. Open Social Studio → Queue to grab the caption and media.`,
      module: "social",
    });
  }
}

export async function draftWithTess(
  site: string,
  topic: string,
): Promise<{ ok: boolean; caption?: string; warning?: string; message?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!topic.trim()) return { ok: false, message: "Type a topic or rough idea first." };
  if (!(SITE_KEYS as string[]).includes(site)) return { ok: false, message: "Unknown brand." };
  try {
    const { caption, guard } = await generateCaption({ site, topic: topic.trim() });
    return { ok: true, caption, warning: guard.ok ? undefined : `Check these numbers — not from a verified source: ${guard.offending.join(", ")}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Generation failed." };
  }
}

// Generate a few caption options for the Create tab; the owner picks the best.
export async function suggestCaptions(input: { site: string; headline?: string; targetUrl?: string; comments?: string }): Promise<{ ok: boolean; options?: string[]; message?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(input.site)) return { ok: false, message: "Unknown brand." };
  const topic = (input.headline?.trim() || input.targetUrl?.trim() || "the page").slice(0, 200);
  const guidance = [input.comments?.trim(), input.targetUrl?.trim() ? `The post promotes this page: ${input.targetUrl.trim()}` : ""].filter(Boolean).join(" ");
  try {
    const options = await generateCaptionVariants({ site: input.site, topic, guidance });
    if (options.length === 0) return { ok: false, message: "Couldn't generate options — try again." };
    return { ok: true, options };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : "Generation failed.").slice(0, 140) };
  }
}

function nextSlots(n: number, slotTimes: string[], startAt?: string): Date[] {
  const out: Date[] = [];
  const now = new Date();
  const base = startAt && new Date(startAt) > now ? new Date(startAt) : now;
  let day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  for (let guard = 0; out.length < n && guard < 90; guard++) {
    for (const t of slotTimes) {
      if (out.length >= n) break;
      const [h, m] = t.split(":").map(Number);
      const dt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h || 0, m || 0));
      if (dt.getTime() > base.getTime()) out.push(dt);
    }
    day = new Date(day.getTime() + 86_400_000);
  }
  return out;
}

// Batch pre-generation: generate a caption per topic and schedule
// them across the brand's upcoming slots, so publishing never stalls when Tess's
// LLM is paused (publishing is deterministic code). Times are treated as UTC.
export async function batchGenerate(input: {
  site: string;
  topics: string[];
  startAt?: string;
}): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(input.site)) return { ok: false, message: "Unknown brand." };
  const topics = input.topics.map((t) => t.trim()).filter(Boolean).slice(0, 14);
  if (topics.length === 0) return { ok: false, message: "Add at least one topic (one per line)." };

  const cfgs = await db.select().from(socialConfig).where(eq(socialConfig.site, input.site));
  const enabled = cfgs.filter((c) => c.enabled);
  if (enabled.length === 0) return { ok: false, message: "No channels enabled for this brand — enable some first." };

  const slotTimes = [...new Set(enabled.flatMap((c) => (c.times as string[]) ?? []))].sort();
  const slots = nextSlots(topics.length, slotTimes.length ? slotTimes : ["09:00", "17:00"], input.startAt);
  const batch = crypto.randomUUID().slice(0, 8);
  let made = 0;

  for (let i = 0; i < topics.length; i++) {
    let caption: string;
    try {
      caption = (await generateCaption({ site: input.site, topic: topics[i] })).caption;
    } catch {
      continue; // skip a topic that fails to generate; keep the batch going
    }
    const [post] = await db
      .insert(socialPosts)
      .values({ ref: await newPostRef(), site: input.site, kind: "text", caption, status: "scheduled", scheduledAt: slots[i], createdBy: user.name, batch })
      .returning();
    for (const c of enabled) {
      await db.insert(socialTargets).values({ postId: post.id, platform: c.platform, mode: c.mode, status: "queued" });
    }
    made++;
  }

  await audit({ actorId: user.id, actorName: user.name, action: "social.batch", target: input.site, detail: { batch, made } });
  revalidatePath("/social");
  return made > 0
    ? { ok: true, message: `Scheduled ${made} post${made > 1 ? "s" : ""} across upcoming slots.` }
    : { ok: false, message: "Generation failed for all topics — check the DeepSeek connection." };
}

// Normalize a free-text hashtags field into a clean "#a #b #c" list.
// (Not exported: a "use server" module may only export async functions.)
function normalizeHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`);
}

// Edit a queued/scheduled post from the detail dialog: caption, schedule, hashtags.
export async function updatePost(
  postId: string,
  patch: { caption?: string; scheduledAt?: string | null; hashtags?: string },
): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return { ok: false, message: "Post not found." };
  if (["published", "done"].includes(post.status)) return { ok: false, message: "This post has already been published." };

  const set: Record<string, unknown> = {};
  if (patch.caption !== undefined) {
    const c = patch.caption.trim();
    if (!c) return { ok: false, message: "Caption can't be empty." };
    set.caption = c;
    // Learn from the owner reshaping a Tess-drafted caption.
    const original = (post.caption ?? "").trim();
    if (post.createdBy === "tess" && c !== original && original) {
      await notePreference(`The admin edited a Tess-drafted caption. Before: "${original.slice(0, 160)}" → After: "${c.slice(0, 160)}". Lean toward the admin's wording, length and tone next time.`);
    }
  }
  if (patch.scheduledAt !== undefined) {
    const at = patch.scheduledAt ? new Date(patch.scheduledAt) : null;
    if (patch.scheduledAt && Number.isNaN(at!.getTime())) return { ok: false, message: "Invalid date." };
    set.scheduledAt = at;
    set.status = at ? "scheduled" : "ready";
  }
  if (patch.hashtags !== undefined) {
    const tags = normalizeHashtags(patch.hashtags);
    set.data = { ...((post.data as Record<string, unknown>) ?? {}), hashtags: tags };
  }
  if (Object.keys(set).length === 0) return { ok: false, message: "Nothing to change." };

  await db.update(socialPosts).set(set).where(eq(socialPosts.id, postId));
  await audit({ actorId: user.id, actorName: user.name, action: "social.post_update", target: postId, detail: Object.keys(set) });
  revalidatePath("/social");
  return { ok: true, message: "Post updated." };
}

// Edit the headline/subhead baked into a banner image and re-render it. Powers
// the post-detail "Banner text" editor. Use "\n" in the headline to force a line
// break. (The social caption is edited separately via updatePost.)
export async function updateBannerText(ref: string, headline: string, subhead: string, style?: import("@/lib/banner").BannerTextStyle, background?: import("@/lib/banner-edit").BackgroundChoice): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const { editBannerText } = await import("@/lib/banner-edit");
  const r = await editBannerText(ref, { headline, subhead, style, background });
  if (r.ok) {
    await audit({ actorId: user.id, actorName: user.name, action: "social.edit_image", target: ref });
    revalidatePath("/social");
  }
  return { ok: r.ok, message: r.message };
}

// "Prepare / post now": clear the schedule so the publisher picks it up on its
// next run, and write the handoff files for any manual-mode targets immediately.
export async function preparePostNow(postId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return { ok: false, message: "Post not found." };
  if (["published", "done"].includes(post.status)) return { ok: false, message: "Already published." };
  await db.update(socialPosts).set({ scheduledAt: null, status: "ready" }).where(eq(socialPosts.id, postId));
  await preparePost(postId);
  await audit({ actorId: user.id, actorName: user.name, action: "social.prepare_now", target: postId });
  revalidatePath("/social");
  return { ok: true, message: "Approved — it's now in 'Ready for manual posting' (Queue tab) with the image and caption to download." };
}

export async function markTargetPosted(targetId: string) {
  const user = await requireOperator();
  if (!user) return;
  await db.update(socialTargets).set({ status: "posted", postedAt: new Date() }).where(eq(socialTargets.id, targetId));
  await audit({ actorId: user.id, actorName: user.name, action: "social.posted_manual", target: targetId });
  revalidatePath("/social");
}

export async function deletePost(postId: string) {
  const user = await requireOperator();
  if (!user) return;
  await db.delete(socialPosts).where(eq(socialPosts.id, postId));
  await audit({ actorId: user.id, actorName: user.name, action: "social.delete", target: postId });
  revalidatePath("/social");
}

// Bulk delete from the "Upcoming & recent" list (select-and-delete). The queue
// fills fast — Tess generates ~16 posts/day and done posts linger — so the owner
// needs to clear them out in one go rather than opening each post's dialog.
export async function deletePosts(postIds: string[]): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not authorized." };
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: "Nothing selected." };
  await db.delete(socialPosts).where(inArray(socialPosts.id, ids));
  await audit({ actorId: user.id, actorName: user.name, action: "social.delete_bulk", target: `${ids.length} posts`, detail: { ids } });
  revalidatePath("/social");
  return { ok: true, message: `Deleted ${ids.length} post${ids.length === 1 ? "" : "s"}.` };
}
