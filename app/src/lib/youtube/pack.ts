import "server-only";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialPosts } from "@/lib/db/schema";
import { MEDIA_ROOT } from "@/lib/banner";
import { generateRouted } from "@/lib/agent/complete";
import { COPY_STANDARD, enforceNoDashPunctuation } from "@/lib/design";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { resolveSource, type CaptionSource, type ResolvedCtx } from "@/lib/caption/studio";
import { renderCutoutThumbnail } from "@/lib/thumbnail/render";
import { scoreThumbnail } from "@/lib/thumbnail/score";
import { TITLE_MAX, TITLE_IDEAL, DESC_MAX, type ThumbLayout, type ThumbConcept, type ThumbPlan, type ThumbGraphicKind, type ThumbLayers, type YouTubeThumb, type YouTubePack } from "./types";
import { getThumbStylePrefs, learnFromThumbEdit } from "./thumb-learn";

// The full "YouTube Pack": everything you need to post a video well — three
// title options, a long SEO description, and three high-CTR thumbnail concepts
// (cut-out face + glow over a loud backdrop, bold outlined text). Built from a
// video Post ID / upload / description, reusing Caption Studio's source resolver.
// Client-safe types + constants live in ./types; re-exported here for server callers.
export { TITLE_MAX, TITLE_IDEAL, DESC_MAX } from "./types";
export type { ThumbLayout, ThumbConcept, YouTubeThumb, YouTubePack } from "./types";

// Layouts alternate LEFT / RIGHT only — design rule: the subject always hugs an
// extreme edge (never centred), so text always has a clean opposite side. "lower"
// (centred subject) is intentionally NOT generated.
const LAYOUTS: ThumbLayout[] = ["left", "right"];

// Enforce the owner's no-dash copy rule deterministically (the prompt alone isn't
// reliable — gpt-oss still emits en/em dashes). Dash-as-punctuation → comma;
// ordinary compound-word hyphens (real-time, no-sign-up) are preserved.
// Delegates to the canonical shared rule (lib/design) so every surface enforces
// dash punctuation identically; we just trim afterwards for the pack's needs.
function deDash(s: string): string {
  return enforceNoDashPunctuation(s).trim();
}
const str = (v: unknown): string => (typeof v === "string" ? deDash(v.trim()) : "");

function clampTitle(t: string): string {
  const s = t.replace(/\s+/g, " ").replace(/^["“”']+|["“”']+$/g, "").trim();
  if (s.length <= TITLE_MAX) return s;
  let cut = s.slice(0, TITLE_MAX - 1);
  const sp = cut.lastIndexOf(" ");
  if (sp > TITLE_MAX * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s.,;:!?\-–—]+$/u, "");
}

// Tolerant JSON extraction — models sometimes wrap the object in prose / fences.
function extractJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Validate/normalise the planner's composition decisions into a ThumbPlan.
const GRAPHICS = new Set(["redX", "greenCheck", "circle", "arrow"]);
function parsePlan(t: Record<string, unknown>): ThumbPlan {
  const plan: ThumbPlan = {};
  const ew = str(t.emphasisWord);
  if (ew) plan.emphasisWord = ew;
  const sh = str(t.subhead);
  if (sh) plan.subhead = sh;
  const ex = str(t.expression);
  if (ex) plan.expression = ex;
  const ge = str(t.gesture);
  if (ge) plan.gesture = ge;
  const ed = str(t.eyeDirection);
  if (ed) plan.eyeDirection = ed;
  const em = str(t.emotion);
  if (em) plan.emotion = em;
  const ac = typeof t.accentColor === "string" ? t.accentColor.trim() : "";
  const hex = ac.match(/^#?([0-9a-fA-F]{6})$/);
  if (hex) plan.accentColor = `#${hex[1].toUpperCase()}`;
  const g = typeof t.graphic === "string" ? t.graphic.trim() : "";
  if (GRAPHICS.has(g)) plan.graphic = { kind: g as ThumbGraphicKind };
  if (t.outline === true || t.outline === "true") plan.outline = true;
  return plan;
}

const brandLines = (ctx: ResolvedCtx): string =>
  [
    ctx.brand?.voice ? `Brand voice: ${ctx.brand.voice}` : "",
    ctx.brand?.audience ? `Audience: ${ctx.brand.audience}` : "",
    ctx.brand?.brief ? `What the brand actually is (binding — only describe THIS):\n${ctx.brand.brief}` : "",
    `BRAND TRUTH: describe only what this brand actually does; never imply features it lacks or name rival tools.`,
  ]
    .filter(Boolean)
    .join("\n");

// ── Brief (titles + thumbnail concepts + hashtags + clickability) as JSON ─────
async function generateBrief(ctx: ResolvedCtx): Promise<{ titles: string[]; concepts: ThumbConcept[]; hashtags: string[]; clickability: number | null }> {
  const site = SITE_META[ctx.site as SiteKey]?.name ?? ctx.site;
  // Style preferences learned from the owner's past thumbnail edits (per brand).
  const stylePrefs = await getThumbStylePrefs(ctx.site);
  const system = [
    `You are a world-class YouTube packaging strategist for "${site}". You design titles and thumbnails that win the click while staying truthful.`,
    brandLines(ctx),
    stylePrefs.length
      ? `LEARNED STYLE PREFERENCES (the owner has edited past thumbnails for this brand — honour these design choices unless the specific scene truly calls for otherwise):\n${stylePrefs.map((p) => `- ${p}`).join("\n")}`
      : "",
    `Return STRICT JSON only (no prose, no markdown fences) with this exact shape:`,
    `{
  "titles": ["3 distinct titles"],
  "thumbnails": [
    {
      "headline":"the ONLY on-thumbnail text (a complete punchy phrase)",
      "scenePrompt":"who the HERO PERSON is (appearance/vibe) + their exaggerated facial reaction — the PERSON only, NO background or setting",
      "subhead":"an optional short 2-5 word support line, or an empty string",
      "emphasisWord":"the single strongest word FROM the headline to make biggest",
      "expression":"the exact facial reaction, matched to the headline tone",
      "gesture":"a natural pose/hand gesture that fits the message",
      "accentColor":"#RRGGBB",
      "emotion":"curiosity | shock | excitement | concern",
      "graphic":"none | redX | greenCheck | circle | arrow",
      "outline": false
    }
  ],
  "hashtags": ["5-8 lowercase hashtags with # prefix"],
  "clickability": 0
}`,
    `TITLES: 3 distinct, scroll-stopping titles, each <= ${TITLE_MAX} characters (aim <= ${TITLE_IDEAL} so they are not truncated). Front-load the main search keyword, THEN open a curiosity gap or raise the stakes so skipping the video feels like missing out. Use concrete specifics, strong verbs and one emotional trigger (a costly mistake, a surprising truth, a fast win, a "nobody tells you this"). A single question or an unfinished "this is why" open loop is allowed. Never use clickbait you cannot back up, ALL CAPS, emoji or hashtags.`,
    `HEADLINE (the ONLY text on the thumbnail, and the single most important line in the whole pack): 2 to 5 words, a COMPLETE grammatical phrase that hits like a punch and is instantly readable at a glance. It MUST do at least one of: open a curiosity gap, build anticipation, trigger a strong emotion (fear of a mistake, desire, shock, relief), or set up a surprising contradiction the viewer NEEDS resolved. Lean into intrigue and a little "wait, what?" tension — the goal is an itch they can only scratch by clicking. Great: "YOUR CV IS WRONG", "STOP DOING THIS", "NOBODY TELLS YOU THIS", "THIS GOT ME HIRED", "THE BIGGEST CV LIE", "DELETE THIS FROM YOUR CV". Bad (never): fragmented word-salad ("HOW TO FREE GERMAN CV"), flat lifeless labels ("CV TEMPLATE", "PHOTO REQUIRED"), or any prefix/kicker/label word. It must be TRUE and make sense on its own. The design engine emphasises the strongest word automatically, so give ONE clean, electric phrase that pairs with the scene.`,
    `SCENEPROMPT (describes the HERO PERSON only — the background is generated separately and the person is cut out, so describe JUST the person, NOT a setting): a specific relatable person who fits the audience and brand (their look/vibe), and their AGGRESSIVELY EXAGGERATED facial reaction dialled way past a normal calm face, matching the headline tone. A warning/negative headline (e.g. "YOUR CV IS WRONG", "STOP DOING THIS") = an intense dead-serious or alarmed face, furrowed brows, NOT smiling. A positive headline (e.g. "THIS GOT ME HIRED") = a huge over-the-top excited, delighted face. A question/curiosity headline = a scrunched, squinting, visibly confused face. A shock headline = a jaw-dropped open mouth, wide eyes. ONE person only. Do NOT describe any background, setting, text, words or props — just the person and their expression.`,
    `COMPOSITION PLAN (these drive the design — make them deliberate, like a top creator would):`,
    `- emphasisWord: the ONE strongest word, taken verbatim from the headline, that should be rendered biggest (a number, a power word like FREE/WRONG/STOP, or the most meaningful word).`,
    `- expression: the exact face (must match the headline tone) and it must be AGGRESSIVELY exaggerated — a scrunched confused squint, a jaw-dropped strong shock, wide-eyed alarm, or an intense dead-serious glare; never a mild or calm face.`,
    `- subhead: an OPTIONAL short support line of 2 to 5 words that adds a benefit or hook under the headline (e.g. "FREE TEMPLATE", "NO SIGN UP", "IN 5 MINUTES"), or an empty string if the headline is strong alone. No pointing gesture is used — the face carries the thumbnail.`,
    `- accentColor: ONE loud, high-contrast hex colour for the emphasis word (e.g. #FFD23F yellow, #FF3B30 red, #00E0A4 green, #2EC5FF blue). Pick what suits the emotion.`,
    `- emotion: the single feeling the thumbnail should trigger.`,
    `THUMBNAILS: exactly 3, each a different scene and a different headline angle.`,
    `clickability: honest integer 0-100 for how strongly this packaging stops the scroll.`,
    COPY_STANDARD,
    `CRITICAL: never invent numbers/prices/percentages not present in the material. The headline and accent must be real, meaningful English — re-read them and fix anything that is not a natural phrase.`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = (await generateRouted({ taskId: "social_caption", system, user: ctx.baseText, maxTokens: 1400, temperature: 0.8, reasoningEffort: "low" })).text;
  const j = extractJson(raw) ?? {};
  const titles = Array.isArray(j.titles) ? (j.titles as unknown[]).map(str).filter(Boolean).map(clampTitle).slice(0, 3) : [];
  const rawThumbs = Array.isArray(j.thumbnails) ? (j.thumbnails as Record<string, unknown>[]) : [];
  const concepts: ThumbConcept[] = rawThumbs.slice(0, 3).map((t, i) => {
    const headline = str(t.headline) || str((t as Record<string, unknown>).text) || "WATCH THIS";
    return {
      layout: LAYOUTS[i % LAYOUTS.length], // hint only; the service auto-places off the face
      headline,
      scenePrompt: str(t.scenePrompt) || `a relatable person reacting with strong emotion, vivid high-contrast background, related to: ${headline}`,
      plan: parsePlan(t),
    };
  });
  const hashtags = Array.isArray(j.hashtags) ? (j.hashtags as unknown[]).map(str).filter((h) => h.startsWith("#")).slice(0, 8) : [];
  const cn = typeof j.clickability === "number" ? Math.max(0, Math.min(100, Math.round(j.clickability))) : null;
  return { titles, concepts, hashtags, clickability: cn };
}

// ── Long SEO description (plain text) ─────────────────────────────────────────
async function generateDescription(ctx: ResolvedCtx): Promise<string> {
  const site = SITE_META[ctx.site as SiteKey]?.name ?? ctx.site;
  const domain = SITE_META[ctx.site as SiteKey]?.domain ?? ctx.site;
  const system = [
    `You are an expert YouTube SEO writer for "${site}". Write the full video DESCRIPTION — long, keyword-rich and genuinely useful (this is what makes the video discoverable in YouTube + Google search).`,
    brandLines(ctx),
    `STRUCTURE:
- First line: a compelling hook of at most 150 characters that contains the main search keyword (this shows above the "...more" fold).
- Then 2 to 4 short paragraphs explaining what the video covers and why it matters, naturally rich in the keywords and related phrases a viewer would search.
- A short "What you'll learn:" list of 3 to 5 bullet points (use "- " bullets).
- A clear call to action plus the site link: https://${domain}
- End with a final line of 5 to 8 relevant hashtags.`,
    `RULES: plain text only (no markdown headers, no bold). Do NOT invent timestamps or chapters — you do not have them. Never invent numbers/prices/percentages not present in the material. Keep it under ${DESC_MAX} characters. Be thorough but never padded.`,
    COPY_STANDARD,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = (await generateRouted({ taskId: "social_caption", system, user: ctx.baseText, maxTokens: 2800, temperature: 0.7, reasoningEffort: "low" })).text;
  let desc = deDash(raw.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim());
  if (desc.length > DESC_MAX) desc = desc.slice(0, DESC_MAX).replace(/\s+\S*$/, "");
  return desc;
}

// ── Thumbnails ────────────────────────────────────────────────────────────────
// FLUX renders the whole scene per concept; the Fabric render service lays the
// text + accents over it. Each concept = its own scene + headline + palette.
async function renderOne(site: string, c: ThumbConcept, paletteIndex: number, idBase: string, bgThemeIndex?: number, direction?: string): Promise<YouTubeThumb> {
  try {
    const r = await renderCutoutThumbnail({
      id: `${idBase}-${paletteIndex}-${crypto.randomBytes(3).toString("hex")}`,
      site,
      layout: c.layout,
      headline: c.headline,
      scenePrompt: c.scenePrompt,
      paletteIndex,
      plan: c.plan,
      bgThemeIndex,
      direction,
    });
    return { index: paletteIndex, layout: c.layout, text: c.headline, url: `/api/media/${r.relPath}`, relPath: r.relPath, sceneSource: r.sceneSource, bytes: r.bytes, concept: c, editBase: r.editBase, layers: r.layers };
  } catch (e) {
    return { index: paletteIndex, layout: c.layout, text: c.headline, url: "", relPath: "", sceneSource: "fallback", bytes: 0, concept: c, error: e instanceof Error ? e.message : "render failed" };
  }
}

// Below this CTR score, the render gets ONE retry (a fresh scene); we keep whichever
// scores higher. Bounded so a weak scene self-corrects without runaway cost/latency.
// Raised after the verifier got stricter about face-overlap / wasted-space placement.
const CTR_THRESHOLD = 75;

// Render a concept, score it, and retry once if it's weak — keeping the better of
// the two. Scoring is best-effort (free vision lane); a null score never blocks.
async function renderScored(site: string, c: ThumbConcept, paletteIndex: number, idBase: string, bgThemeIndex: number): Promise<YouTubeThumb> {
  const first = await renderOne(site, c, paletteIndex, idBase, bgThemeIndex);
  if (!first.relPath) return first; // render failed outright — nothing to score
  const s1 = await scoreThumbnail(first.relPath).catch(() => null);
  if (s1) first.score = s1;
  if (!s1 || s1.score >= CTR_THRESHOLD) return first;

  const second = await renderOne(site, c, paletteIndex, `${idBase}-r`, bgThemeIndex);
  if (!second.relPath) return first;
  const s2 = await scoreThumbnail(second.relPath).catch(() => null);
  if (s2) second.score = s2;
  return (s2?.score ?? 0) > s1.score ? second : first;
}

async function renderThumbs(site: string, concepts: ThumbConcept[], idBase: string): Promise<YouTubeThumb[]> {
  // A random per-pack seed + the index gives each of the 3 thumbnails a DIFFERENT
  // background design, and varies designs across packs.
  const seed = Math.floor(Math.random() * 8);
  return Promise.all(concepts.map((c, i) => renderScored(site, c, i, idBase, seed + i)));
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function buildYouTubePack(input: { source: CaptionSource; idBase?: string }): Promise<YouTubePack> {
  try {
    const ctx = await resolveSource(input.source);
    const idBase = (input.idBase ?? crypto.randomBytes(4).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "");
    // Brief + description in parallel (independent LLM calls).
    const [brief, description] = await Promise.all([generateBrief(ctx), generateDescription(ctx)]);
    const thumbnails = await renderThumbs(ctx.site, brief.concepts.length ? brief.concepts : [{ layout: "left", headline: "WATCH THIS", scenePrompt: "a relatable person reacting with excitement, vivid high-contrast background" }], idBase);
    return {
      ok: true,
      site: ctx.site,
      summary: ctx.summary,
      titles: brief.titles.length ? brief.titles : ["(no titles, regenerate)"],
      description,
      hashtags: brief.hashtags,
      thumbnails,
      clickability: brief.clickability,
    };
  } catch (e) {
    return { ok: false, titles: [], description: "", hashtags: [], thumbnails: [], clickability: null, error: e instanceof Error ? e.message : "Could not build the YouTube pack." };
  }
}

// ── Persistence (so packs survive reloads + wait in the handoff) ──────────────
// Stored compactly on the source post under data.youtube.
async function persistPack(ref: string, pack: YouTubePack): Promise<void> {
  const clean = ref.replace(/\D/g, "");
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
  if (!post) return;
  const data = { ...((post.data as Record<string, unknown>) ?? {}) };
  data.youtube = {
    titles: pack.titles,
    description: pack.description,
    hashtags: pack.hashtags,
    clickability: pack.clickability,
    thumbnails: pack.thumbnails.map((t) => ({ index: t.index, layout: t.layout, text: t.text, url: t.url, relPath: t.relPath, sceneSource: t.sceneSource, concept: t.concept, score: t.score, editBase: t.editBase, layers: t.layers, editState: t.editState })),
    builtAt: new Date().toISOString(),
  };
  await db.update(socialPosts).set({ data }).where(eq(socialPosts.id, post.id));
}

// Build a pack for a Post ID AND persist it. Used by the on-demand action (post
// source) and the auto-on-video hook so the result is identical either way.
export async function buildAndPersistPack(ref: string): Promise<YouTubePack> {
  const clean = ref.replace(/\D/g, "");
  const pack = await buildYouTubePack({ source: { kind: "post", ref: clean }, idBase: clean });
  if (pack.ok) await persistPack(clean, pack).catch(() => {});
  return pack;
}

// Read a previously-built pack off a post (null if none) — lets the UI show an
// auto-built pack instantly instead of regenerating.
export async function loadSavedPack(ref: string): Promise<YouTubePack | null> {
  const clean = ref.replace(/\D/g, "");
  if (!clean) return null;
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
  const yt = (post?.data as Record<string, unknown> | undefined)?.youtube as Record<string, unknown> | undefined;
  if (!yt) return null;
  return {
    ok: true,
    site: post.site,
    summary: `${post.kind} post #${clean}`,
    titles: Array.isArray(yt.titles) ? (yt.titles as string[]) : [],
    description: typeof yt.description === "string" ? yt.description : "",
    hashtags: Array.isArray(yt.hashtags) ? (yt.hashtags as string[]) : [],
    clickability: typeof yt.clickability === "number" ? yt.clickability : null,
    thumbnails: Array.isArray(yt.thumbnails) ? (yt.thumbnails as YouTubeThumb[]) : [],
  };
}

// Re-render a single thumbnail concept (used by the "regenerate this one" button).
// Generates a fresh AI subject so the new render genuinely differs.
export async function regenerateThumb(input: { site: string; concept: ThumbConcept; paletteIndex?: number; idBase?: string; direction?: string }): Promise<YouTubeThumb> {
  const idBase = (input.idBase ?? crypto.randomBytes(4).toString("hex")).replace(/[^a-zA-Z0-9_-]/g, "");
  const t = await renderOne(input.site, input.concept, input.paletteIndex ?? 0, `${idBase}-r`, Math.floor(Math.random() * 8), input.direction);
  if (t.relPath) { const s = await scoreThumbnail(t.relPath).catch(() => null); if (s) t.score = s; }
  return t;
}

// ── Editor: persist an edited thumbnail ───────────────────────────────────────
// Overwrites the thumbnail JPG with the editor's export and (for post-backed packs)
// stores the editor's layer state so re-opening resumes. Path is strictly validated
// to stay inside MEDIA_ROOT/thumbnails.
const SAFE_THUMB_REL = /^thumbnails\/[a-zA-Z0-9_-]+\/[A-Za-z0-9._-]+\.jpg$/;
export async function persistThumbEdit(input: { relPath: string; bytes: Buffer; ref?: string; index?: number; state?: ThumbLayers }): Promise<{ ok: boolean; error?: string }> {
  const rel = input.relPath || "";
  if (!SAFE_THUMB_REL.test(rel) || rel.includes("..")) return { ok: false, error: "bad path" };
  const root = path.join(MEDIA_ROOT, "thumbnails");
  const abs = path.join(MEDIA_ROOT, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, error: "bad path" };
  // The thumbnail .jpg files are written by the thumb-worker container as root, so
  // the app (USER node) can't open them for writing (EACCES). But the app OWNS the
  // directory, so write to a temp file and atomically rename over the target —
  // rename needs only directory write permission and replaces the root-owned file
  // cleanly. The result is node-owned, so subsequent edits work directly too.
  const tmp = `${abs}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  try {
    await fs.writeFile(tmp, input.bytes);
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    return { ok: false, error: `could not write the edited image: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` };
  }
  // Persist edit state on the source post (post-backed packs only) so re-opening
  // the editor resumes from the last save instead of the generated layout.
  if (input.ref && typeof input.index === "number" && input.state) {
    const clean = input.ref.replace(/\D/g, "");
    if (clean) {
      const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
      const yt = (post?.data as Record<string, unknown> | undefined)?.youtube as Record<string, unknown> | undefined;
      if (post && yt && Array.isArray(yt.thumbnails)) {
        const thumbs = yt.thumbnails as Record<string, unknown>[];
        const t = thumbs.find((x) => x.index === input.index);
        if (t) {
          t.editState = input.state;
          const data = { ...((post.data as Record<string, unknown>) ?? {}), youtube: { ...yt, thumbnails: thumbs } };
          await db.update(socialPosts).set({ data }).where(eq(socialPosts.id, post.id)).catch(() => {});
          // Learn the owner's design taste from how they changed our generated
          // layers — background, best-effort, so it never delays the save response.
          void learnFromThumbEdit(post.site, (t.layers as ThumbLayers | undefined) ?? null, input.state);
        }
      }
    }
  }
  return { ok: true };
}
