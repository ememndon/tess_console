import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { contentPlanItems, socialPosts, socialMedia, brandProfiles, settings } from "../db/schema";
import { generateCaption, generateBannerCopy } from "../generate";
import { newPostRef } from "../social";
import { renderBanner, MEDIA_ROOT } from "../banner";
import { fetchStockPhoto, stockQueryFor } from "../stock-media";
import { generateAiBackgroundBytes } from "../image-gen";
import { formatById } from "./formats";
import { listRecipes } from "../demo/recipes";
import { enqueueDemoJob } from "../demo/enqueue";
import { enqueueUrlDemo } from "../demo/tour";
import { SITE_META, type SiteKey } from "../site-scope";
import { audit } from "../audit";

// Turn ONE plan brief into a real DRAFT — an image (banner rendered now) or a
// video (queued on the media worker). Never text. Reuses the strategist caption
// generator + banner renderer + the demo pipeline. Drafts only; never auto-posts.

export type GenCtx = { actor: string; requestedBy: string; createdBy?: string; pipeline?: { source: string; slot?: number } };
export type GenResult = { ok: boolean; kind?: "image" | "video" | "carousel"; postRef?: string; queued?: boolean; jobId?: string; message?: string };

export async function generatePlanItem(itemId: string, ctx: GenCtx): Promise<GenResult> {
  const [item] = await db.select().from(contentPlanItems).where(eq(contentPlanItems.id, itemId)).limit(1);
  if (!item) return { ok: false, message: "Plan item not found." };
  if (item.status === "generated" || item.status === "queued") {
    return { ok: true, kind: item.kind as "image" | "video" | "carousel", postRef: item.postRef ?? undefined, queued: item.status === "queued", message: "Already generated." };
  }

  await db.update(contentPlanItems).set({ status: "generating", updatedAt: new Date() }).where(eq(contentPlanItems.id, itemId));

  const site = item.site;
  const meta = SITE_META[site as SiteKey];
  const def = formatById(item.formatId ?? "");
  const src = (item.sourceVideo as { title?: string; url?: string; outlierScore?: number | null; kind?: string; query?: string; position?: number } | null) ?? null;
  const isGsc = src?.kind === "gsc";
  const guidance = [
    `Subtopic: ${item.subtopic}.`,
    `Video format: ${item.formatName ?? ""}.`,
    def?.template ? `Structure: ${def.template}` : "",
    item.angle ? `Why it wins: ${item.angle}.` : "",
    `Bring a fresh, contrarian angle.`,
    isGsc && src?.query
      ? `This targets a REAL Google search: "${src.query}"${src.position ? ` (the site ranks about position ${Math.round(src.position)})` : ""}. Open by restating that search almost word for word as the hook, then answer it in one or two lines and point to the exact page.`
      : src?.title ? `Inspired by a top performer in this niche: "${src.title}" (match the proven demand, don't copy it).` : "",
    `Target platform: ${item.platform ?? ""}.`,
  ].filter(Boolean).join(" ");

  try {
    if (item.kind === "video") return await generateVideo(item, meta, guidance, ctx);
    if (item.kind === "carousel") return await generateCarouselFromPlan(item, guidance, ctx);
    return await generateImage(item, meta, guidance, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(contentPlanItems).set({ status: "failed", error: msg.slice(0, 240), updatedAt: new Date() }).where(eq(contentPlanItems.id, itemId));
    return { ok: false, message: msg.slice(0, 200) };
  }
}

type Item = typeof contentPlanItems.$inferSelect;

function planScene(site: string, topic: string): string {
  const name = SITE_META[site as SiteKey]?.name ?? site;
  return `A premium, editorial brand backdrop for ${name} evoking the theme of "${topic}". A real photographic or richly illustrated scene with one clear focal point and calm negative space on the left for a headline overlay. No text, no words, no letters in the image.`;
}

// Vary the visual style so Content Director posts don't all look like the same
// site template. Lead with a real STOCK photo or an AI backdrop (both composited
// under the real headline), cross-fall to the other, and only use the plain
// banner as a last resort. Pexels + DeepInfra are configured; each step degrades
// gracefully when a provider is unavailable. Returns the style used.
async function composePlanImage(postId: string, site: string, title: string, subtitle: string | undefined, topic: string): Promise<{ style: string; credit?: string }> {
  const spec = (bgImage?: Buffer) => ({ site, title, subtitle, bgImage });
  const insert = async (r: { path: string; width: number; height: number }) =>
    db.insert(socialMedia).values({ postId, type: "image", path: r.path, width: r.width, height: r.height });
  // Save the raw backdrop so a later header edit can re-composite over the EXACT
  // same photo/scene instead of fetching a different one.
  const saveSrc = async (bg: Buffer) => {
    try { await fs.writeFile(path.join(MEDIA_ROOT, "banners", site, `${postId}.src.png`), bg); } catch { /* best effort */ }
  };
  const stock = async () => {
    const s = await fetchStockPhoto(stockQueryFor(site, topic)).catch(() => null);
    if (!s) return null;
    await saveSrc(s.data);
    await insert(await renderBanner(postId, spec(s.data)));
    return { style: "stock", credit: s.credit };
  };
  const ai = async () => {
    try { const { data } = await generateAiBackgroundBytes(planScene(site, topic)); await saveSrc(data); await insert(await renderBanner(postId, spec(data))); return { style: "ai" as const }; }
    catch { return null; }
  };
  const leadAi = Math.random() < 0.35; // ~35% lead AI, ~65% lead stock — then cross-fall
  const order = leadAi ? [ai, stock] : [stock, ai];
  for (const step of order) { const out = await step(); if (out) return out; }
  await insert(await renderBanner(postId, spec())); // universal fallback
  return { style: "banner" };
}

async function generateImage(item: Item, meta: { name: string; domain: string }, guidance: string, ctx: GenCtx): Promise<GenResult> {
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, item.site));
  const cap = await generateCaption({ site: item.site, topic: item.subtopic, guidance, platform: item.platform ?? undefined, pillar: item.formatName ?? undefined });
  const copy = await generateBannerCopy({ site: item.site, topic: item.subtopic, guidance });
  const nfa = !!brand?.notFinancialAdvice;
  // GSC briefs link the EXACT ranking page (so the post drives clicks to the page
  // that already ranks); everything else links the site homepage.
  const anchor = (item.sourceVideo as { kind?: string; url?: string } | null) ?? null;
  const ctaUrl = anchor?.kind === "gsc" && anchor.url ? anchor.url : `https://${meta.domain}`;
  const finalCaption = [cap.caption, ctaUrl, nfa ? "Not financial advice." : ""].filter(Boolean).join("\n\n");
  const ref = await newPostRef();
  // source defaults to content-director; the daily pipeline overrides it to
  // 'daily-pipeline' + slot so its once-per-slot idempotency still applies.
  const postData: Record<string, unknown> = {
    source: ctx.pipeline?.source ?? "content-director",
    ...(ctx.pipeline?.slot != null ? { slot: ctx.pipeline.slot } : {}),
    planRef: item.planRef,
    planItemId: item.id,
    subtopic: item.subtopic,
    format: item.formatId,
    formatName: item.formatName,
    platform: item.platform,
    kind: "image",
    sourceVideo: item.sourceVideo ?? null,
    ...(cap.hashtags.length ? { hashtags: cap.hashtags } : {}),
  };
  const [post] = await db
    .insert(socialPosts)
    .values({
      ref,
      site: item.site,
      kind: "banner",
      caption: finalCaption,
      status: "draft", // DRAFT only — never auto-publishes; owner posts manually
      // No schedule: it's a draft for the owner to review/schedule. (Using the
      // plan's dayDate filed today's drafts under a future date in the queue.)
      scheduledAt: null,
      createdBy: ctx.createdBy ?? "tess",
      batch: item.planRef,
      data: postData,
    })
    .returning({ id: socialPosts.id });

  const img = await composePlanImage(post.id, item.site, copy.headline || item.subtopic, copy.subhead || undefined, item.subtopic);
  await db.update(socialPosts).set({ data: { ...postData, imageStyle: img.style, headline: copy.headline || item.subtopic, subhead: copy.subhead || "", ...(img.credit ? { imageCredit: img.credit } : {}) } }).where(eq(socialPosts.id, post.id));
  await db.update(contentPlanItems).set({ status: "generated", postRef: ref, postId: post.id, updatedAt: new Date() }).where(eq(contentPlanItems.id, item.id));
  await audit({ actorName: ctx.actor, action: "content.generate", target: ref, detail: { planRef: item.planRef, kind: "image", style: img.style, by: ctx.requestedBy } });
  return { ok: true, kind: "image", postRef: ref };
}

// A carousel plan brief (Content Director opt-in) -> a real draft Instagram carousel
// via the Social Studio generator, plus the plan bookkeeping the pipeline expects.
// Manual handoff only, exactly like every other Content Director draft.
async function generateCarouselFromPlan(item: Item, guidance: string, ctx: GenCtx): Promise<GenResult> {
  const { generateCarousel } = await import("../social/carousel");
  // Rotate the layout across the plan so a month of carousels never looks identical.
  const STYLES = ["bold", "minimal", "editorial"] as const;
  const style = STYLES[Math.abs(item.dayIndex ?? 0) % STYLES.length];
  const r = await generateCarousel({ site: item.site, topic: item.subtopic, guidance, style, createdBy: ctx.createdBy ?? "tess", actor: ctx.actor });
  if (!r.ok || !r.postRef) {
    await db.update(contentPlanItems).set({ status: "failed", error: (r.message ?? "carousel generation failed").slice(0, 240), updatedAt: new Date() }).where(eq(contentPlanItems.id, item.id));
    return { ok: false, message: r.message };
  }
  await db.update(contentPlanItems).set({ status: "generated", postRef: r.postRef, postId: r.postId ?? null, updatedAt: new Date() }).where(eq(contentPlanItems.id, item.id));
  await audit({ actorName: ctx.actor, action: "content.generate", target: r.postRef, detail: { planRef: item.planRef, kind: "carousel", slides: r.slides, by: ctx.requestedBy } });
  return { ok: true, kind: "carousel", postRef: r.postRef };
}

// GlobalResumeHub is a country-pages site, but it ships only ONE demo recipe
// (Canada), and the smart-pick below matched it for almost every subtopic — so
// every resumehub video became the same Canada tour. Instead, ROTATE the toured
// country (persisted in settings so it never repeats two runs running) and
// scroll-tour that country's real guide page.
const RESUMEHUB_COUNTRIES: { slug: string; name: string }[] = [
  { slug: "germany", name: "Germany" },
  { slug: "united-kingdom", name: "the UK" },
  { slug: "canada", name: "Canada" },
  { slug: "united-states", name: "the United States" },
  { slug: "australia", name: "Australia" },
  { slug: "japan", name: "Japan" },
  { slug: "france", name: "France" },
  { slug: "india", name: "India" },
  { slug: "netherlands", name: "the Netherlands" },
  { slug: "ireland", name: "Ireland" },
];

async function nextResumehubCountry(): Promise<{ slug: string; name: string }> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "resumehub_video_country"));
  const last = (row?.value as { slug?: string } | undefined)?.slug;
  const idx = RESUMEHUB_COUNTRIES.findIndex((c) => c.slug === last);
  const next = RESUMEHUB_COUNTRIES[(idx + 1) % RESUMEHUB_COUNTRIES.length];
  await db.insert(settings).values({ key: "resumehub_video_country", value: { slug: next.slug } }).onConflictDoUpdate({ target: settings.key, set: { value: { slug: next.slug }, updatedAt: new Date() } });
  return next;
}

async function generateVideo(item: Item, meta: { name: string; domain: string }, guidance: string, ctx: GenCtx): Promise<GenResult> {
  const baseNotes = `${item.subtopic}. Format: ${item.formatName ?? ""}. ${item.angle ?? ""}`.trim();
  let jobId: string | undefined;

  if (item.site === "resumehub") {
    const c = await nextResumehubCountry();
    const res = await enqueueUrlDemo({ url: `https://globalresumehub.com/${c.slug}`, site: item.site, requestedBy: ctx.requestedBy, createdBy: ctx.createdBy ?? "tess", actor: ctx.actor, notes: `${baseNotes} Tour ${c.name}'s resume conventions and the free ${c.name} template/guide.` });
    jobId = String(res.jobId);
  } else {
    // Smart pick: a GSC brief tours its exact ranking page; else a feature
    // screen-demo if a saved recipe matches the subtopic; else a narrated tour of
    // the site homepage (with stock b-roll + voiceover).
    const anchor = (item.sourceVideo as { kind?: string; url?: string } | null) ?? null;
    const recipes = listRecipes().filter((r) => r.site === item.site);
    const sub = item.subtopic.toLowerCase();
    const match = recipes.find((r) => r.feature && r.feature.toLowerCase().split(/\s+/).some((w) => w.length > 3 && sub.includes(w)));
    if (anchor?.kind === "gsc" && anchor.url) {
      const res = await enqueueUrlDemo({ url: anchor.url, site: item.site, requestedBy: ctx.requestedBy, createdBy: ctx.createdBy ?? "tess", actor: ctx.actor, notes: baseNotes });
      jobId = String(res.jobId);
    } else if (match) {
      const res = await enqueueDemoJob({ recipeId: match.id, requestedBy: ctx.requestedBy, createdBy: ctx.createdBy ?? "tess", actor: ctx.actor, notes: baseNotes });
      jobId = String(res.jobId);
    } else {
      const res = await enqueueUrlDemo({ url: `https://${meta.domain}`, site: item.site, requestedBy: ctx.requestedBy, createdBy: ctx.createdBy ?? "tess", actor: ctx.actor, notes: baseNotes });
      jobId = String(res.jobId);
    }
  }
  await db.update(contentPlanItems).set({ status: "queued", jobId, updatedAt: new Date() }).where(eq(contentPlanItems.id, item.id));
  await audit({ actorName: ctx.actor, action: "content.generate", target: item.planRef, detail: { planItem: item.id, kind: "video", jobId, by: ctx.requestedBy } });
  return { ok: true, kind: "video", queued: true, jobId };
}

/** Generate the next N still-unmade plan items for a site (daily-variety order:
 * dayIndex then priority, across all the site's plans/niches) — the on-demand
 * counterpart to the daily pipeline. */
export async function generateDuePlanItems(site: string | undefined, limit: number, ctx: GenCtx): Promise<{ generated: number; results: GenResult[] }> {
  const conds = [eq(contentPlanItems.status, "planned")];
  if (site) conds.push(eq(contentPlanItems.site, site));
  const rows = await db.select({ id: contentPlanItems.id }).from(contentPlanItems).where(and(...conds))
    .orderBy(asc(contentPlanItems.dayIndex), desc(contentPlanItems.priority), asc(contentPlanItems.createdAt)).limit(limit);
  const results: GenResult[] = [];
  for (const r of rows) results.push(await generatePlanItem(r.id, ctx));
  return { generated: results.filter((r) => r.ok).length, results };
}
