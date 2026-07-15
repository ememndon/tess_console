import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { brandProfiles } from "./db/schema";
import { generateRouted } from "./agent/complete";
import { COPY_STANDARD, PERSUASION_STANDARD, bannerCopyExamplesFor, enforceNoDashPunctuation } from "./design";
import { socialStrategyBlock, platformPlaybook, hashtagCountFor } from "./social-strategy";

// Content generation. The LLM writes around numbers; it never invents
// them. Any figure must come from DATA injected here from a verified source. A
// numeric guard double-checks the output and surfaces anything the model made up.

export type DataPoint = { label: string; value: string };

const numbersIn = (s: string): string[] => (s.match(/\d[\d,.]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, ""));

export function numericGuard(text: string, allowedSource: string): { ok: boolean; offending: string[] } {
  const allowed = new Set(numbersIn(allowedSource));
  // Ignore years and single digits (low false-positive risk) — flag invented figures.
  const offending = [...new Set(numbersIn(text))].filter(
    (n) => !allowed.has(n) && n.replace(/[.]/g, "").length >= 2 && !/^(19|20)\d{2}$/.test(n),
  );
  return { ok: offending.length === 0, offending };
}

// Split a generated reply into the post body and its hashtag line. The writer is
// asked to put tags on a final "HASHTAGS:" line so the caption stays clean (tags
// render in their own field) and the numeric guard checks the body only.
function splitCaptionAndTags(raw: string): { caption: string; hashtags: string[] } {
  const lines = raw.split(/\r?\n/);
  const tags: string[] = [];
  const body: string[] = [];
  for (const line of lines) {
    if (/^\s*hashtags?\s*[:\-]/i.test(line)) {
      for (const m of line.matchAll(/#[\p{L}\p{N}_]+/gu)) tags.push(m[0]);
    } else {
      body.push(line);
    }
  }
  let caption = body.join("\n").trim();
  // If the model still tacked tags onto the end of the body, lift them out.
  if (tags.length === 0) {
    const trailing = caption.match(/(?:^|\s)(#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*)\s*$/u);
    if (trailing) {
      for (const m of trailing[1].matchAll(/#[\p{L}\p{N}_]+/gu)) tags.push(m[0]);
      caption = caption.slice(0, trailing.index).trim();
    }
  }
  const seen = new Set<string>();
  const hashtags = tags.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { caption, hashtags };
}

export async function generateCaption(opts: {
  site: string;
  topic: string;
  data?: DataPoint[];
  guidance?: string; // pillar-specific direction (what kind of post + the CTA)
  platform?: string; // tailor craft/length/hashtags to the destination platform
  pillar?: string; // the content pillar this post serves (teach, relate, prove, spotlight, time-peg)
}): Promise<{ caption: string; hashtags: string[]; guard: { ok: boolean; offending: string[] } }> {
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, opts.site));
  const dataStr = (opts.data ?? []).map((d) => `${d.label}: ${d.value}`).join("\n");
  const tagCount = hashtagCountFor(opts.platform);

  const system = [
    `You are an expert social media manager and copywriter for the brand "${opts.site}". The job of this post is to stop the scroll, deliver real value, and drive a click to the site.`,
    brand?.voice ? `Brand voice: ${brand.voice}` : "",
    brand?.audience ? `Audience: ${brand.audience}` : "",
    brand?.brief ? `What the brand actually is (its DO / DON'T is binding — write only about THIS):\n${brand.brief}` : "",
    `BRAND TRUTH: Describe only what this brand actually does. Never claim or imply features it does not have — for example, do not say it uses AI, ChatGPT, Claude or any tool it does not offer, and do not recommend rival tools. If the topic implies something the brand is not, reframe it to the brand's real offering.`,
    socialStrategyBlock(opts.site),
    opts.pillar ? `Content pillar for THIS post: ${opts.pillar}. Stay in that lane.` : "",
    opts.guidance ? `Post direction: ${opts.guidance}` : "",
    platformPlaybook(opts.platform),
    `CRAFT: open with a scroll-stopping HOOK in the first line (a sharp question, a bold or counter-intuitive claim, a relatable pain, or a verified surprising fact), deliver ONE clear value or insight, then end with a call to action that drives a visit. Speak to the reader as "you". Keep it tight and platform-appropriate. Plain text only: no markdown, no surrounding quotes, no inline hashtags in the body, and do NOT write the URL yourself (it is appended automatically).`,
    COPY_STANDARD,
    PERSUASION_STANDARD,
    `CRITICAL RULE: Never invent numbers, statistics, prices, percentages or rates. Use ONLY figures explicitly given in DATA, exactly as written. If there is no DATA, do not state any specific figures.`,
    brand?.notFinancialAdvice ? `This is finance content: stay informational and never give financial advice.` : "",
    `FORMAT: write the post body, then on a FINAL separate line output "HASHTAGS:" followed by exactly ${tagCount} relevant hashtag${tagCount === 1 ? "" : "s"} tailored to THIS post and platform: mix broad-reach, niche-targeted, and the brand tag. No spaces inside a tag, no commas.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = `Topic: ${opts.topic}` + (dataStr ? `\n\nDATA (use these exact figures, invent no others):\n${dataStr}` : "");
  const allowedSource = `${opts.topic} ${dataStr}`;

  const raw = (await generateRouted({ taskId: "social_caption", system, user, maxTokens: 340, temperature: 0.85 })).text;
  let { caption, hashtags } = splitCaptionAndTags(raw);
  let guard = numericGuard(caption, allowedSource);
  if (!guard.ok) {
    const raw2 = (await generateRouted({
      taskId: "social_caption",
      system: `${system}\nYour previous draft used numbers not present in DATA (${guard.offending.join(", ")}). Rewrite using only the provided figures, or none.`,
      user,
      maxTokens: 340,
      temperature: 0.4,
    })).text;
    const reparsed = splitCaptionAndTags(raw2);
    caption = reparsed.caption;
    if (reparsed.hashtags.length) hashtags = reparsed.hashtags;
    guard = numericGuard(caption, allowedSource);
  }
  return { caption: enforceNoDashPunctuation(caption), hashtags, guard };
}

// A few distinct caption options to choose from (high temperature → they vary).
// Returns 2–4 deduped variants; the owner picks the strongest in the composer.
export async function generateCaptionVariants(opts: {
  site: string;
  topic: string;
  guidance?: string;
  platform?: string;
  count?: number;
}): Promise<string[]> {
  const n = Math.min(Math.max(opts.count ?? 3, 2), 4);
  const results = await Promise.all(
    Array.from({ length: n }, () => generateCaption({ site: opts.site, topic: opts.topic, guidance: opts.guidance, platform: opts.platform }).catch(() => null)),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of results) {
    const c = r?.caption.trim();
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

const dequote = (s: string) => s.replace(/^\s*["'“”]+|["'“”]+\s*$/g, "").trim();

// Parse the model's two-line reply. Tolerant of missing labels / extra prose.
function parseHeadlineSubhead(raw: string, fallback: string): { headline: string; subhead: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let headline = "";
  let subhead = "";
  for (const l of lines) {
    const h = l.match(/^head(?:line)?\s*[:\-–—]\s*(.+)$/i);
    const s = l.match(/^sub(?:head|title|heading)?\s*[:\-–—]\s*(.+)$/i);
    if (h && !headline) headline = h[1];
    else if (s && !subhead) subhead = s[1];
  }
  // No labels found → take the first line as headline, the next as subhead.
  const unlabeled = lines.filter((l) => !/^(head|sub)/i.test(l));
  if (!headline) headline = unlabeled[0] ?? fallback;
  if (!subhead) subhead = unlabeled.find((l) => l !== headline) ?? "";
  return { headline: dequote(headline), subhead: dequote(subhead) };
}

// Short, COMPLETE headline + subhead for banners and AI-backdrop composites.
// Written to fit the art so the renderer never has to chop a sentence mid-word.
// Kept separate from the longer social caption on purpose.
export async function generateBannerCopy(opts: {
  site: string;
  topic: string;
  guidance?: string;
}): Promise<{ headline: string; subhead: string }> {
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, opts.site));
  const ex = bannerCopyExamplesFor(opts.site);
  const buildSystem = (strict: string) => [
    `You write tight, persuasive ad copy for the brand "${opts.site}". The banner's only job is to make the viewer want to click through to the site.`,
    brand?.voice ? `Brand voice: ${brand.voice}` : "",
    brand?.brief ? `What the brand actually is (binding — write only about THIS):\n${brand.brief}` : "",
    `BRAND TRUTH: Reflect only what this brand actually does. Never imply features it lacks (e.g. AI/ChatGPT/Claude) or name rival tools. If the topic conflicts with the brand, reframe to its real offering.`,
    socialStrategyBlock(opts.site),
    opts.guidance ? `Direction: ${opts.guidance}` : "",
    `Reply with EXACTLY two lines and nothing else:`,
    `HEADLINE: 2 to 6 words (at most 38 characters, no trailing period) — a sharp hook DERIVED FROM THIS POST'S SPECIFIC ANGLE, not a line you could paste on any post for this brand. The examples show TONE ONLY — do NOT reuse their wording: ${ex.hGood}. Avoid flat labels and these clichés: ${ex.hBad}.`,
    `SUBHEAD: ONE complete sentence (at most 90 characters) making a concrete benefit promise SPECIFIC to this angle, ending with a light call to action. Tone only, never reuse: ${ex.sGood} Avoid: ${ex.sBad}.`,
    `Both must read as complete (never cut off), speak to the reader as "you", and be unmistakably about THIS post's angle — a reader should not see the same headline on a different post. No hashtags, no URL, no quotes, no markdown, no emoji.`,
    strict,
    COPY_STANDARD,
    PERSUASION_STANDARD,
    `Never invent numbers, prices, percentages or rates.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = `THIS post is specifically about: "${opts.topic}". Write the headline and subhead about THAT exact angle — nothing generic.`;
  // Weak free models love to parrot the example/cliché headlines verbatim. Detect
  // an echoed or generic headline and regenerate once, hotter and stricter.
  const echoed = (h: string) => {
    const n = h.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (!n) return true;
    if (/beat the resume bot|get past the filter|^get hired$|ats ready resume/.test(n)) return true;
    return `${ex.hGood} ${ex.hBad}`.toLowerCase().includes(n);
  };
  let parsed = parseHeadlineSubhead((await generateRouted({ taskId: "social_caption", system: buildSystem(""), user, maxTokens: 120, temperature: 0.8 })).text, opts.topic);
  if (echoed(parsed.headline)) {
    const strict = `IMPORTANT: do NOT output "${parsed.headline}" or any example phrase. Write a DIFFERENT, specific headline of 2-6 words built only from this angle: "${opts.topic}".`;
    parsed = parseHeadlineSubhead((await generateRouted({ taskId: "social_caption", system: buildSystem(strict), user, maxTokens: 120, temperature: 0.95 })).text, opts.topic);
  }
  return { headline: enforceNoDashPunctuation(parsed.headline), subhead: enforceNoDashPunctuation(parsed.subhead) };
}
