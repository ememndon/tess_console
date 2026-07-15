import "server-only";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { brandProfiles, socialPosts, socialMedia } from "../db/schema";
import { generateRouted } from "../agent/complete";
import { COPY_STANDARD, PERSUASION_STANDARD, enforceNoDashPunctuation } from "../design";
import { socialStrategyBlock, platformPlaybook, hashtagCountFor } from "../social-strategy";
import { MEDIA_ROOT } from "../banner";
import { SITE_META, type SiteKey } from "../site-scope";
import {
  PLATFORM_LIMITS,
  countChars,
  type CaptionPlatform,
  type CaptionResult,
  type CaptionTone,
} from "../caption-platforms";
import { sampleKeyframes } from "./keyframes";
import { visionDescribe } from "./vision";

// ── Inputs ────────────────────────────────────────────────────────────────
export type CaptionSource =
  | { kind: "post"; ref: string } // primary — reads an in-queue post (no upload)
  | { kind: "text"; site: string; text: string }
  | { kind: "image"; site: string; imageDataUrl: string; note?: string }
  | { kind: "video"; site: string; videoPath: string; note?: string }; // off-queue upload (abs path)

export type CaptionStudioInput = {
  source: CaptionSource;
  platforms: CaptionPlatform[];
  tone?: CaptionTone;
  locale?: string;
};

export type CaptionStudioOutput = {
  ok: boolean;
  site?: string;
  summary?: string;
  results: CaptionResult[];
  error?: string;
};

type BrandRow = typeof brandProfiles.$inferSelect;
export type ResolvedCtx = { site: string; brand: BrandRow | null; baseText: string; summary: string };

const TONE_INSTR: Record<CaptionTone, string> = {
  auto: "Use the brand's own natural voice.",
  professional: "Tone: polished and professional — credible, precise, zero hype.",
  playful: "Tone: playful and light — a little wit, warmth and personality.",
  bold: "Tone: bold and punchy — strong claims, short lines, high energy.",
  storytelling: "Tone: storytelling — open with a small relatable moment, then land the point.",
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// ── Source resolution ───────────────────────────────────────────────────────
// Turns any input into { site, brand, baseText, summary }. For a video the
// EXISTING server file is read and keyframes sampled; nothing is duplicated.
export async function resolveSource(source: CaptionSource): Promise<ResolvedCtx> {
  let site = "";
  let baseText = "";
  let summary = "";
  let images: string[] = [];

  if (source.kind === "post") {
    const clean = source.ref.replace(/[^0-9]/g, "");
    if (!clean) throw new Error("Enter a Post ID.");
    const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
    if (!post) throw new Error(`No post #${clean} found.`);
    site = post.site;
    const data = (post.data as Record<string, unknown>) ?? {};
    const topic = str(data.subtopic) || str(data.topic) || str(data.feature);
    const lines = [
      topic && `Topic: ${topic}`,
      str(data.headline) && `Headline shown on the image: ${str(data.headline)}`,
      str(data.subhead) && `Subhead shown on the image: ${str(data.subhead)}`,
      str(post.caption) && `Existing caption (reference only — rewrite, do not copy): ${str(post.caption)}`,
    ].filter(Boolean);
    baseText = lines.join("\n");
    summary = `${SITE_META[site as SiteKey]?.name ?? site} · ${post.kind} post${topic ? ` · “${topic}”` : ""}`;

    // Video post → read the existing file and sample keyframes (vision). Image
    // posts stay text-only (the owner's chosen primary mode).
    if (post.kind === "video") {
      const [vid] = await db
        .select()
        .from(socialMedia)
        .where(and(eq(socialMedia.postId, post.id), eq(socialMedia.type, "video")))
        .limit(1);
      if (vid?.path) {
        const abs = vid.path.startsWith("/") ? vid.path : path.join(MEDIA_ROOT, vid.path);
        images = await sampleKeyframes(abs, 5);
      }
    }
  } else if (source.kind === "text") {
    site = source.site;
    baseText = source.text.trim();
    summary = `${SITE_META[site as SiteKey]?.name ?? site} · from a description`;
    if (!baseText) throw new Error("Enter a description.");
  } else if (source.kind === "image") {
    site = source.site;
    baseText = str(source.note);
    images = [source.imageDataUrl];
    summary = `${SITE_META[site as SiteKey]?.name ?? site} · from an uploaded image`;
  } else {
    site = source.site;
    baseText = str(source.note);
    images = await sampleKeyframes(source.videoPath, 5);
    summary = `${SITE_META[site as SiteKey]?.name ?? site} · from an uploaded video`;
  }

  // One vision pass for the whole request; reused across all platforms.
  if (images.length) {
    const visual = await visionDescribe(images, baseText || "Describe this for a social caption.");
    if (visual) baseText = baseText ? `${baseText}\n\nWhat the visual shows: ${visual}` : `What the visual shows: ${visual}`;
  }
  if (!baseText) throw new Error("Nothing to caption — add a description or pick a post with content.");

  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, site));
  return { site, brand: brand ?? null, baseText, summary };
}

// Pull the caption / hashtags / hook score out of the model's formatted reply.
function parseGenerated(raw: string): { caption: string; hashtags: string[]; hookScore: number | null; hookReason: string } {
  const grab = (label: string): string => {
    const m = raw.match(new RegExp(`^\\s*${label}\\s*:?[ \\t]*(.*)$`, "im"));
    return m ? m[1].trim() : "";
  };
  const tagsLine = grab("HASHTAGS");
  const hashtags = [...tagsLine.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
  const scoreNum = parseInt(grab("HOOK_SCORE").replace(/[^0-9]/g, ""), 10);
  const hookScore = Number.isFinite(scoreNum) ? Math.max(0, Math.min(100, scoreNum)) : null;
  const hookReason = grab("HOOK_REASON");

  let caption = raw;
  const firstMarker = raw.search(/^\s*(HASHTAGS|HOOK_SCORE|HOOK_REASON)\s*:/im);
  if (firstMarker >= 0) caption = raw.slice(0, firstMarker);
  caption = caption.replace(/^\s*CAPTION\s*:?[ \t]*/i, "").trim();
  // If the model left tags inline at the very end of the body, lift them out.
  if (!hashtags.length) {
    const trailing = caption.match(/(?:^|\s)(#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*)\s*$/u);
    if (trailing) {
      for (const m of trailing[1].matchAll(/#[\p{L}\p{N}_]+/gu)) hashtags.push(m[0]);
      caption = caption.slice(0, trailing.index).trim();
    }
  }
  return { caption, hashtags, hookScore, hookReason };
}

// Trim a string to <= max characters, preferring a word boundary, ending with an
// ellipsis. Leaves room for the ellipsis so the result never exceeds max.
function trimToWord(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, Math.max(0, max - 1));
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s.,;:!?\-–—]+$/u, "") + "…";
}

// Guarantee a result fits the platform's hard character limit (caption + hashtags,
// counted exactly as the UI's countChars does). This is the safety net that makes
// X's 280 a hard promise no matter what the model returns: drop hashtags first,
// then trim the body to a word boundary.
function enforceHardLimit(r: CaptionResult): CaptionResult {
  const lim = PLATFORM_LIMITS[r.platform];
  if (!r.caption || countChars(r.caption, r.hashtags) <= lim.hardLimit) return r;
  let hashtags = [...r.hashtags];
  while (hashtags.length && countChars(r.caption, hashtags) > lim.hardLimit) hashtags.pop();
  let caption = r.caption;
  if (countChars(caption, hashtags) > lim.hardLimit) {
    const reserve = hashtags.length ? `\n\n${hashtags.join(" ")}`.length : 0;
    caption = trimToWord(caption, Math.max(1, lim.hardLimit - reserve));
  }
  return { ...r, caption, hashtags };
}

// ── Per-platform generation ───────────────────────────────────────────────
async function generateOne(
  platform: CaptionPlatform,
  ctx: ResolvedCtx,
  opts: { tone: CaptionTone; locale?: string; hotter?: boolean },
): Promise<CaptionResult> {
  const lim = PLATFORM_LIMITS[platform];
  const tagCount = hashtagCountFor(platform);
  const brand = ctx.brand;

  const foldRule =
    platform === "x"
      ? `HARD LIMIT (non-negotiable): the ENTIRE post — your caption text PLUS the hashtags — must be ${lim.hardLimit} characters or FEWER. Aim for about ${lim.hardLimit - 30} so it never overflows. One tight idea only; count as you write and cut every filler word.`
      : `Only the first ~${lim.fold} characters are visible before the reader taps “more”. Put the hook and the core value BEFORE that point. Stay under ${lim.hardLimit} characters.`;

  // On X every hashtag eats into the 280 budget, so keep them minimal/optional.
  const hashtagSpec =
    platform === "x"
      ? `HASHTAGS: <0–2 short, highly relevant hashtags, or "none" — they COUNT toward the ${lim.hardLimit}-character limit, so prefer few or none>`
      : `HASHTAGS: <exactly ${tagCount} relevant hashtag${tagCount === 1 ? "" : "s"} tailored to this post and platform, or "none">`;

  // YouTube descriptions welcome a clickable link; the other platforms don't want
  // a raw URL in the body (link-in-bio / link-in-comments / appended separately).
  const urlRule =
    platform === "youtube"
      ? `include the site link with a clear call to action (links are clickable and welcomed on YouTube): https://${SITE_META[ctx.site as SiteKey]?.domain ?? ctx.site}`
      : `do NOT write the URL yourself`;

  const system = [
    `You are an expert social media copywriter for the brand "${ctx.site}". Write ONE post for ${lim.name}. The job: stop the scroll, deliver real value, and drive a click to the site.`,
    brand?.voice ? `Brand voice: ${brand.voice}` : "",
    brand?.audience ? `Audience: ${brand.audience}` : "",
    brand?.brief ? `What the brand actually is (its DO / DON'T is binding — write only about THIS):\n${brand.brief}` : "",
    // Brand-truth guardrail (the requested premium feature).
    `BRAND TRUTH: Describe only what this brand actually does. Never claim or imply features it does not have — do not say it uses AI, ChatGPT, Claude or any tool it does not offer, and do not recommend rival tools. If the topic implies something the brand is not, reframe it to the brand's real offering.`,
    socialStrategyBlock(ctx.site),
    platformPlaybook(platform),
    `ABOVE THE FOLD: ${foldRule}`,
    TONE_INSTR[opts.tone] ?? TONE_INSTR.auto,
    opts.locale ? `LOCALIZE: Write for a reader in ${opts.locale}. Use that region's spelling, norms, currency and cultural references so it feels native to ${opts.locale}, never generic.` : "",
    `CRAFT: open with a scroll-stopping HOOK in the first line, deliver clear value, then a call to action. Speak to the reader as "you". Plain text only — no markdown, no surrounding quotes, no inline hashtags in the body, and ${urlRule}.`,
    COPY_STANDARD,
    PERSUASION_STANDARD,
    `CRITICAL: Never invent numbers, statistics, prices or percentages. Use only figures present in the material below; if none, state no specific figures.`,
    brand?.notFinancialAdvice ? `This is finance content: stay informational and never give financial advice.` : "",
    `FORMAT — reply with EXACTLY these labelled lines and nothing else:\nCAPTION:\n<the post body>\n${hashtagSpec}\nHOOK_SCORE: <integer 0-100 — how strongly the first line stops the scroll>\nHOOK_REASON: <one short sentence>`,
  ]
    .filter(Boolean)
    .join("\n");

  const gen = async (extra: string, temp: number) => {
    const raw = (
      await generateRouted({
        taskId: "social_caption",
        system: extra ? `${system}\n${extra}` : system,
        user: ctx.baseText,
        // Headroom so the answer + the FORMAT trailer always fit; reasoning is
        // dialled down (captions don't need it) so it can't eat the token budget
        // and truncate the caption mid-sentence (gpt-oss shares reasoning + answer
        // under one max_tokens budget).
        maxTokens: platform === "x" || platform === "facebook" ? 600 : platform === "youtube" ? 1600 : 1000,
        temperature: temp,
        reasoningEffort: "low",
      })
    ).text;
    return parseGenerated(raw);
  };

  let parsed = await gen("", opts.hotter ? 0.95 : 0.85);

  // Enforce the hard character cap (this is what makes X's 280 real). If the draft
  // overflows, ask once for a shorter rewrite; then enforceHardLimit guarantees it.
  if (parsed.caption && countChars(parsed.caption, parsed.hashtags) > lim.hardLimit) {
    const over = countChars(parsed.caption, parsed.hashtags);
    const retry = await gen(
      `LENGTH FIX: your previous ${lim.name} post was ${over} characters, but ${lim.name} allows at most ${lim.hardLimit} characters INCLUDING the hashtags. Rewrite it to land UNDER ${lim.hardLimit} (target about ${Math.max(40, lim.hardLimit - 30)}). Keep the hook and the call to action; cut everything else. Using fewer hashtags, or none, is fine.`,
      0.6,
    ).catch(() => parsed);
    if (retry.caption && (countChars(retry.caption, retry.hashtags) <= lim.hardLimit || countChars(retry.caption, retry.hashtags) < over)) {
      parsed = retry;
    }
  }

  if (!parsed.caption) return { platform, caption: "", hashtags: [], hookScore: null, hookReason: "", error: "The model returned an empty caption — try regenerating." };
  return enforceHardLimit({ platform, ...parsed, caption: enforceNoDashPunctuation(parsed.caption), hookReason: enforceNoDashPunctuation(parsed.hookReason) });
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function runCaptionStudio(input: CaptionStudioInput): Promise<CaptionStudioOutput> {
  try {
    const ctx = await resolveSource(input.source);
    const tone = input.tone ?? "auto";
    const results = await Promise.all(
      input.platforms.map((p) =>
        generateOne(p, ctx, { tone, locale: input.locale }).catch(
          (e): CaptionResult => ({ platform: p, caption: "", hashtags: [], hookScore: null, hookReason: "", error: e instanceof Error ? e.message : "generation failed" }),
        ),
      ),
    );
    return { ok: true, site: ctx.site, summary: ctx.summary, results };
  } catch (e) {
    return { ok: false, results: [], error: e instanceof Error ? e.message : "Could not generate captions." };
  }
}

// Regenerate a single platform card with a hotter take.
export async function regenerateCaption(
  source: CaptionSource,
  platform: CaptionPlatform,
  opts: { tone?: CaptionTone; locale?: string },
): Promise<CaptionResult> {
  const ctx = await resolveSource(source);
  return generateOne(platform, ctx, { tone: opts.tone ?? "auto", locale: opts.locale, hotter: true });
}
