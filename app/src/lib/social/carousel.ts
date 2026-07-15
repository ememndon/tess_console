import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { socialPosts, socialTargets, socialMedia, socialConfig, brandProfiles, notifications } from "../db/schema";
import { renderCarouselSlide, carouselSrcPath, MEDIA_ROOT, type CarouselSlideKind, type CarouselAspect, type CarouselStyle } from "../banner";
import { buildZip, type ZipEntry } from "../zip";
import { fetchStockPhoto, stockQueryFor } from "../stock-media";
import { generateAiBackgroundBytes } from "../image-gen";
import { generateCaption } from "../generate";
import { generateRouted } from "../agent/complete";
import { enforceNoDashPunctuation } from "../design";
import { writeHandoff } from "../handoff";
import { newPostRef } from "../social";
import { audit } from "../audit";
import { SITE_META, type SiteKey } from "../site-scope";

// Instagram CAROUSEL generator. An LLM writes a swipeable outline (a cover hook,
// 3 to 8 point slides, a CTA); ONE shared backdrop is fetched/generated; each slide
// is rendered as a 4:5 Satori card over that backdrop; the set is saved as ONE draft
// post with N ordered image rows + a single caption, and handed off for manual
// Instagram posting (Tess never auto-posts). Roughly the cost of a single image post
// (one backdrop reused across slides).

type Slide = { kind: CarouselSlideKind; title: string; body?: string };
type Outline = { cover: { title: string; sub?: string }; points: { title: string; body: string }[]; cta: { title: string; sub?: string } };

// One editable slide, as the per-slide editor sends it. Position is canonical on
// re-render: the first slide is the cover, the last is the CTA, the rest are tips.
export type SlideDef = { kind: CarouselSlideKind; title: string; body?: string };

const asStyle = (v: unknown): CarouselStyle => (v === "minimal" || v === "editorial" ? v : "bold");
const asAspect = (v: unknown): CarouselAspect => (v === "square" ? "square" : "portrait");

function extractJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}
const clean = (v: unknown): string => enforceNoDashPunctuation(String(v ?? "").trim());

// Keep WHOLE sentences up to a budget so a slide body never ends mid-thought
// ("...your format must match your"). Falls back to a clean word-boundary cut.
function clampSentences(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const sentences = t.match(/[^.!?]+[.!?]+/g);
  if (sentences) {
    let out = "";
    for (const sen of sentences) {
      if ((out + sen).trim().length > max) break;
      out += sen;
    }
    out = out.trim();
    if (out.length >= 20) return out;
  }
  let cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  if (sp > 12) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:.]+$/, "").trim() + ".";
}

type Brand = { voice: string | null; audience: string | null; brief: string | null; notFinancialAdvice: boolean };

async function carouselOutline(site: string, topic: string, guidance: string | undefined, brand: Brand | undefined): Promise<Outline | null> {
  const name = SITE_META[site as SiteKey]?.name ?? site;
  const system = [
    "You write high-performing Instagram CAROUSELS: a swipeable set of slides, ONE idea per slide, that teaches or persuades.",
    brand?.voice ? `Brand voice: ${brand.voice}` : "",
    brand?.audience ? `Audience: ${brand.audience}` : "",
    brand?.brief ? `What the brand is (stay on-brand, never misrepresent it): ${brand.brief}` : "",
    "Structure: a COVER (a scroll-stopping hook), 3 to 8 POINT slides (each a punchy title plus a body of AT MOST two short sentences, about 20 words), and a CTA slide.",
    "Rules: concrete and specific to the brand, no fluff, never invent statistics. No hashtags, no emojis, no markdown, no dashes as punctuation. Cover title max 8 words; each point title max 8 words; keep bodies tight so they fit a slide.",
    'Output ONLY minified JSON in EXACTLY this shape: {"cover":{"title":"","sub":""},"points":[{"title":"","body":""}],"cta":{"title":"","sub":""}}',
  ].filter(Boolean).join("\n");
  const user = `Brand: ${name}. Carousel topic: ${topic}.${guidance ? " " + guidance : ""}`;

  let parsed: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const sys = attempt === 0 ? system : `${system}\n\nIMPORTANT: reply with ONE complete valid JSON object and nothing else.`;
    const gen = await generateRouted({ taskId: "social_caption", system: sys, user, maxTokens: 1500, temperature: attempt === 0 ? 0.7 : 0.3 });
    parsed = extractJson(gen.text);
  }
  if (!parsed) return null;

  const cover = (parsed.cover ?? {}) as Record<string, unknown>;
  const cta = (parsed.cta ?? {}) as Record<string, unknown>;
  const points = (Array.isArray(parsed.points) ? parsed.points : [])
    .map((p) => p as Record<string, unknown>)
    .map((p) => ({ title: clean(p.title).slice(0, 90), body: clampSentences(clean(p.body), 150) }))
    .filter((p) => p.title)
    .slice(0, 8);
  const coverTitle = clean(cover.title).slice(0, 90);
  const ctaTitle = clean(cta.title).slice(0, 90) || "Try it today";
  if (!coverTitle || points.length < 3) return null; // need a hook + at least 3 points

  return {
    cover: { title: coverTitle, sub: clampSentences(clean(cover.sub), 150) || undefined },
    points,
    cta: { title: ctaTitle, sub: clampSentences(clean(cta.sub), 150) || undefined },
  };
}

function carouselScene(site: string, topic: string): string {
  const name = SITE_META[site as SiteKey]?.name ?? site;
  return `A premium, editorial brand backdrop for ${name} evoking the theme of "${topic}". A real photographic or richly illustrated scene with one clear focal point and calm, uncluttered space so bold text overlays read clearly. No text, no words, no letters in the image.`;
}

export type CarouselResult = { ok: boolean; postRef?: string; postId?: string; slides?: number; message?: string };

export async function generateCarousel(opts: { site: string; topic: string; guidance?: string; aspect?: CarouselAspect; style?: CarouselStyle; createdBy?: string; actor?: string }): Promise<CarouselResult> {
  const site = opts.site;
  const topic = opts.topic.trim();
  const aspect = asAspect(opts.aspect);
  const style = asStyle(opts.style);
  const meta = SITE_META[site as SiteKey];
  if (!meta) return { ok: false, message: "Unknown brand." };
  if (!topic) return { ok: false, message: "Give the carousel a topic." };

  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, site));
  const outline = await carouselOutline(site, topic, opts.guidance, brand as Brand | undefined);
  if (!outline) return { ok: false, message: "Could not draft the carousel (the model returned nothing usable). Try again or reword the topic." };

  const slides: Slide[] = [
    { kind: "cover", title: outline.cover.title, body: outline.cover.sub },
    ...outline.points.map((p) => ({ kind: "point" as const, title: p.title, body: p.body })),
    { kind: "cta", title: outline.cta.title, body: outline.cta.sub },
  ];
  const total = slides.length;

  // ONE shared backdrop for the whole set: real stock photo first, AI backdrop as
  // fallback, plain brand base last. Reused across every slide for cohesion + low cost.
  let bg: Buffer | undefined;
  const stock = await fetchStockPhoto(stockQueryFor(site, topic)).catch(() => null);
  if (stock) bg = stock.data;
  if (!bg) {
    try { const { data } = await generateAiBackgroundBytes(carouselScene(site, topic)); bg = data; } catch { /* fall through to solid base */ }
  }

  // One caption for the whole carousel.
  let caption = "";
  let hashtags: string[] = [];
  try {
    const cap = await generateCaption({ site, topic, guidance: opts.guidance, platform: "instagram" });
    caption = cap.caption;
    hashtags = cap.hashtags ?? [];
  } catch { caption = `${meta.name}: ${topic}`; }
  const nfa = !!brand?.notFinancialAdvice;
  const finalCaption = [caption.trim(), `https://${meta.domain}`, nfa ? "Not financial advice." : ""].filter(Boolean).join("\n\n");

  const ref = await newPostRef();
  const [post] = await db
    .insert(socialPosts)
    .values({
      ref,
      site,
      kind: "banner", // image post; the carousel is flagged in data.format
      caption: finalCaption,
      status: "draft",
      createdBy: opts.createdBy ?? "tess",
      data: { format: "carousel", topic, slides: total, slideDefs: slides, aspect, style, hasBg: !!bg, source: "carousel", ...(hashtags.length ? { hashtags } : {}) },
    })
    .returning({ id: socialPosts.id });

  // Persist the shared backdrop so single slides can be re-rendered later (the
  // editor's edit-text / reorder / aspect-swap all re-composite over this image).
  if (bg) {
    try {
      const src = carouselSrcPath(site, post.id);
      await fs.mkdir(path.dirname(src), { recursive: true });
      await fs.writeFile(src, bg);
    } catch { /* best effort — editor falls back to a fresh backdrop */ }
  }

  const mediaPaths: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const index = i + 1; // 1-based slide position
    const pointNo = s.kind === "point" ? index - 1 : undefined; // cover is 1, so point tips start at 1
    const r = await renderCarouselSlide(`${post.id}-s${String(index).padStart(2, "0")}`, {
      site, kind: s.kind, index, total, pointNo, title: s.title, body: s.body, bgImage: bg, aspect, style,
    });
    await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height, idx: i });
    mediaPaths.push(r.path);
  }

  // Instagram target — honor the site's configured mode; default to manual handoff.
  const cfg = await db.select().from(socialConfig).where(eq(socialConfig.site, site));
  const mode = cfg.find((c) => c.platform === "instagram")?.mode ?? "handoff";
  await db.insert(socialTargets).values({ postId: post.id, platform: "instagram", mode, status: mode === "handoff" ? "handoff" : "queued" });

  if (mode === "handoff") {
    await writeHandoff({ site, platform: "instagram", postId: post.id, caption: finalCaption, mediaPaths });
    await db.insert(notifications).values({
      severity: "info",
      module: "social",
      title: "📥 Carousel ready for manual posting",
      body: `A ${total}-slide Instagram carousel for ${meta.name} is ready. Open Social Studio → Queue to grab the slides (in order) and the caption.`,
    });
  }

  await audit({ actorName: opts.actor ?? "operator", action: "social.carousel", target: ref, detail: { site, topic, slides: total } });
  return { ok: true, postRef: ref, postId: post.id, slides: total };
}

// `defs` echoes the slide list the server actually rendered (titles trimmed, bodies
// sentence-clamped), so the editor can resync its fields after any mutation.
export type CarouselEditResult = { ok: boolean; slides?: number; defs?: SlideDef[]; message?: string };

// Rebuild EVERY slide of an existing carousel from an (edited) ordered slide list,
// re-compositing over the SAME saved backdrop (or a freshly swapped one). Used by
// the per-slide editor for text edits, reordering, add/delete, aspect changes and
// background swaps. Every slide is re-rendered because the "i / N" counter and tip
// numbers depend on position; the media rows are replaced (new ids bust the image
// cache, same trick as the banner editor) and the manual-posting bundle is rewritten
// so the outbox always matches the current set.
async function rerenderCarousel(postId: string, opts: { defs: SlideDef[]; aspect?: CarouselAspect; style?: CarouselStyle; newBg?: Buffer }): Promise<CarouselEditResult> {
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return { ok: false, message: "Post not found." };
  if (["published", "done"].includes(post.status)) return { ok: false, message: "This carousel is already published — it can't be edited." };
  const data = (post.data as Record<string, unknown>) ?? {};
  if (data.format !== "carousel") return { ok: false, message: "That post is not a carousel." };
  const site = post.site;
  const aspect: CarouselAspect = opts.aspect ?? asAspect(data.aspect);
  const style: CarouselStyle = opts.style ?? asStyle(data.style);

  // Normalize: first = cover, last = CTA, the rest are tips. Clean + clamp bodies.
  const cleaned = opts.defs
    .map((d) => ({ title: clean(d.title).slice(0, 90), body: clampSentences(clean(d.body ?? ""), 150) }))
    .filter((d) => d.title);
  if (cleaned.length < 3) return { ok: false, message: "A carousel needs a cover, at least one tip, and a call to action." };
  const slides: Slide[] = cleaned.map((d, i) => ({
    kind: i === 0 ? "cover" : i === cleaned.length - 1 ? "cta" : "point",
    title: d.title,
    body: d.body || undefined,
  }));
  const total = slides.length;
  const prevCount = Number(data.slides) || total;

  // Backdrop: a freshly-swapped image (persist it), else the saved src, else none.
  let bg: Buffer | undefined = opts.newBg;
  if (opts.newBg) {
    try {
      const src = carouselSrcPath(site, postId);
      await fs.mkdir(path.dirname(src), { recursive: true });
      await fs.writeFile(src, opts.newBg);
    } catch { /* best effort */ }
  } else {
    try { bg = await fs.readFile(carouselSrcPath(site, postId)); } catch { bg = undefined; }
  }

  // Re-render each slide over the shared backdrop (overwrites <id>-sNN.png in place).
  const rows: { path: string; width: number; height: number; idx: number }[] = [];
  const mediaPaths: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const index = i + 1;
    const pointNo = s.kind === "point" ? index - 1 : undefined;
    const r = await renderCarouselSlide(`${postId}-s${String(index).padStart(2, "0")}`, {
      site, kind: s.kind, index, total, pointNo, title: s.title, body: s.body, bgImage: bg, aspect, style,
    });
    rows.push({ path: r.path, width: r.width, height: r.height, idx: i });
    mediaPaths.push(r.path);
  }

  // Swap the media rows (new ids → browsers fetch the new images, not stale cache).
  await db.delete(socialMedia).where(eq(socialMedia.postId, postId));
  for (const m of rows) await db.insert(socialMedia).values({ postId, type: "image", path: m.path, width: m.width, height: m.height, idx: m.idx });

  // If the set shrank, remove the orphaned trailing slide files.
  const dir = path.join(MEDIA_ROOT, "banners", site);
  for (let n = total + 1; n <= prevCount; n++) {
    try { await fs.unlink(path.join(dir, `${postId}-s${String(n).padStart(2, "0")}.png`)); } catch { /* already gone */ }
  }

  await db.update(socialPosts).set({ data: { ...data, slides: total, slideDefs: slides, aspect, style, hasBg: !!bg } }).where(eq(socialPosts.id, postId));

  // Keep the manual-posting bundle in sync with the new set (in order).
  const tgs = await db.select().from(socialTargets).where(eq(socialTargets.postId, postId));
  const handoff = tgs.find((t) => t.mode === "handoff");
  if (handoff) {
    try { await writeHandoff({ site, platform: handoff.platform, postId, caption: post.caption ?? "", mediaPaths }); } catch { /* bundle refresh best effort */ }
  }

  return { ok: true, slides: total, defs: slides };
}

// The editor's single entry point: apply edited slide text / order / count / aspect,
// optionally swapping the shared backdrop first (keep = reuse the saved one).
export async function updateCarousel(postId: string, input: { defs: SlideDef[]; aspect?: CarouselAspect; style?: CarouselStyle; background?: { mode: "keep" | "stock" | "ai"; prompt?: string } }): Promise<CarouselEditResult> {
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return { ok: false, message: "Post not found." };
  const data = (post.data as Record<string, unknown>) ?? {};
  const site = post.site;
  const topic = (data.topic as string) || "";
  const mode = input.background?.mode ?? "keep";
  let newBg: Buffer | undefined;
  if (mode === "stock") {
    const q = input.background?.prompt?.trim() || stockQueryFor(site, topic);
    const s = await fetchStockPhoto(q).catch(() => null);
    if (!s) return { ok: false, message: "Couldn't find a stock photo (no key set or nothing matched) — kept the current backdrop." };
    newBg = s.data;
  } else if (mode === "ai") {
    try {
      const { data: bytes } = await generateAiBackgroundBytes(carouselScene(site, input.background?.prompt?.trim() || topic));
      newBg = bytes;
    } catch (e) {
      return { ok: false, message: `Couldn't generate an AI backdrop (${(e instanceof Error ? e.message : String(e)).slice(0, 100)}) — kept the current one.` };
    }
  }
  return rerenderCarousel(postId, { defs: input.defs, aspect: input.aspect, style: input.style, newBg });
}

// Rewrite ONE slide's copy with the model (keeping every other slide, the order, the
// shape, the style and the backdrop untouched), then re-render the set. The model
// sees the topic and the surrounding slides so the new copy still fits the story.
export async function regenerateSlideCopy(postId: string, index: number, override?: SlideDef[]): Promise<CarouselEditResult> {
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return { ok: false, message: "Post not found." };
  if (["published", "done"].includes(post.status)) return { ok: false, message: "This carousel is already published — it can't be edited." };
  const data = (post.data as Record<string, unknown>) ?? {};
  if (data.format !== "carousel") return { ok: false, message: "That post is not a carousel." };
  // Rewrite inside the caller's CURRENT slide set when supplied, so a rewrite never
  // silently discards edits the operator hasn't saved yet.
  const stored = (Array.isArray(data.slideDefs) ? data.slideDefs : []) as SlideDef[];
  const defs = override && override.length >= 3 ? override : stored;
  if (index < 0 || index >= defs.length) return { ok: false, message: "No such slide." };

  const site = post.site;
  const topic = (data.topic as string) || "";
  const name = SITE_META[site as SiteKey]?.name ?? site;
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, site));
  const target = defs[index];
  // Kind is positional (cover first, CTA last) — never trust a client-supplied kind.
  const kind: CarouselSlideKind = index === 0 ? "cover" : index === defs.length - 1 ? "cta" : "point";
  const role =
    kind === "cover" ? "the COVER slide (a scroll-stopping hook, plus an optional one line subhead)"
    : kind === "cta" ? "the final CALL TO ACTION slide (tell them what to do next)"
    : `TIP slide number ${index} of this carousel (one idea, a punchy title plus at most two short sentences of about 20 words)`;
  const others = defs
    .map((d, i) => (i === index ? null : `${i === 0 ? "Cover" : i === defs.length - 1 ? "CTA" : `Tip ${i}`}: ${d.title}`))
    .filter(Boolean)
    .join("\n");

  const system = [
    "You rewrite ONE slide of an Instagram carousel. Keep it on-topic and distinct from the other slides.",
    brand?.voice ? `Brand voice: ${brand.voice}` : "",
    brand?.audience ? `Audience: ${brand.audience}` : "",
    "Rules: concrete and specific, no fluff, never invent statistics. No hashtags, no emojis, no markdown, no dashes as punctuation. Title max 8 words.",
    'Output ONLY minified JSON: {"title":"","body":""}',
  ].filter(Boolean).join("\n");
  const user = `Brand: ${name}. Carousel topic: ${topic}.\nRewrite ${role}.\nThe other slides (do NOT repeat them):\n${others}\n\nCurrent version — title: "${target.title}"${target.body ? `, body: "${target.body}"` : ""}. Write a fresh, better version.`;

  let parsed: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const gen = await generateRouted({ taskId: "social_caption", system, user, maxTokens: 400, temperature: attempt === 0 ? 0.8 : 0.4 });
    parsed = extractJson(gen.text);
  }
  const title = clean(parsed?.title).slice(0, 90);
  if (!title) return { ok: false, message: "The model didn't return usable copy. Try again." };
  const body = clampSentences(clean(parsed?.body), 150);

  const next = defs.map((d, i) => (i === index ? { kind, title, body: body || undefined } : d));
  return rerenderCarousel(postId, { defs: next });
}

// Bundle a carousel's slides (in swipe order) + its caption into a single ZIP for a
// one-click download, so the owner can grab the whole set at once instead of saving
// each slide. Written under MEDIA_ROOT and served (auth-gated) via /api/media.
export async function buildCarouselZip(postId: string): Promise<{ ok: boolean; url?: string; filename?: string; message?: string }> {
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId));
  if (!post) return { ok: false, message: "Post not found." };
  const data = (post.data as Record<string, unknown>) ?? {};
  if (data.format !== "carousel") return { ok: false, message: "That post is not a carousel." };
  const site = post.site;

  const media = await db.select().from(socialMedia).where(eq(socialMedia.postId, postId)).orderBy(asc(socialMedia.idx), asc(socialMedia.createdAt));
  const entries: ZipEntry[] = [];
  let n = 0;
  for (const m of media) {
    try {
      const buf = await fs.readFile(m.path);
      n += 1;
      entries.push({ name: `slide-${String(n).padStart(2, "0")}.png`, data: buf });
    } catch { /* skip a missing slide file */ }
  }
  if (!entries.length) return { ok: false, message: "No slide images found to bundle." };
  entries.push({ name: "caption.txt", data: Buffer.from(post.caption ?? "", "utf8") });

  const zip = buildZip(entries);
  const dir = path.join(MEDIA_ROOT, "banners", site);
  await fs.mkdir(dir, { recursive: true });
  const rel = ["banners", site, `${postId}-carousel.zip`].join("/");
  await fs.writeFile(path.join(MEDIA_ROOT, rel), zip);
  return { ok: true, url: `/api/media/${rel}?v=${Date.now().toString(36)}`, filename: `carousel-${post.ref ?? postId}.zip` };
}
