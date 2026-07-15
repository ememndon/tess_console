import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brandProfiles, settings } from "@/lib/db/schema";
import { generateRouted } from "@/lib/agent/complete";
import { numericGuard } from "@/lib/generate";
import { fetchStockVideoUrl, fetchStockPhotoUrl } from "@/lib/stock-media";
import { generateAiImageBytes } from "@/lib/image-gen";
import { MEDIA_ROOT } from "@/lib/banner";
import { promises as fsp } from "fs";
import nodePath from "path";
import nodeCrypto from "crypto";
import { SITE_META } from "@/lib/site-scope";
import { COPY_STANDARD, PERSUASION_STANDARD, enforceNoDashPunctuation } from "@/lib/design";
import type { BRoll, DemoRecipe, DemoScenario, DemoScene } from "./types";

// Per-site B-ROLL OVERRIDES. Some brands need tightly-controlled imagery regardless of
// what the script proposes. CheckInvest is a Nigerian finance brand, so its b-roll MUST
// be money/banking/corporate-Africa — never generic/abstract clips.
// (Embedded here so Tess uses these automatically once unpaused.)
//
// CHECKINVEST CURRENCY RULE (owner, 2026-06-21): stock footage gets the currency WRONG
// (foreign notes/coins), so anything depicting MONEY — naira, banknotes, cash, savings —
// is ALWAYS AI-generated with a Nigeria-focused prompt (mode "ai", never stock). Stock
// footage is allowed ONLY where it's reliably on-brand and currency-agnostic: African
// business offices, Africans using a laptop / doing finance, and charts (mode "stock",
// with a Nigeria-focused AI image as the fallback if no good clip/photo is found).
// For "stock" slots: stock video → stock photo → AI image. For "ai" slots: AI image
// only (skip the slot rather than risk wrong-currency stock).
type CuratedBRoll = {
  // Stock search term (used only for mode "stock"; a label otherwise).
  query: string;
  // "ai" = ALWAYS AI-generate (money/currency); "stock" = stock OK, AI fallback.
  mode: "ai" | "stock";
  // Nigeria-focused prompt for AI generation (the subject; BROLL_AI_STYLE adds the look).
  aiPrompt: string;
  // VETTED pinned stock clip (owner-approved footage). When set on a "stock" slot it is
  // used verbatim instead of a fresh search — search is unreliable on skin tone and keeps
  // returning non-Nigerian / light-skinned people, so we pin clips we know are on-brand.
  clipUrl?: string;
  clipCredit?: string;
  clipStartSec?: number; // seek past an unwanted opening shot in the pinned clip
};

const SITE_CURATED_BROLL: Record<string, CuratedBRoll[]> = {
  checkinvest: [
    // AI slots = finance ACTIVITIES (people doing finance things). NO banknotes/currency
    // and no legible text — AI renders those wrong. Focus is the person + the action, with
    // shallow depth of field so any incidental detail (calculator display, papers, ATM
    // screen) stays soft/abstract. Nigeria/African subjects.
    {
      query: "African person calculator finance",
      mode: "ai",
      aiPrompt:
        "A Nigerian woman at a desk punching numbers into a calculator while glancing at a notebook, close-up on her hands and the calculator, budgeting and personal finance, shallow depth of field",
    },
    {
      query: "African business team office meeting",
      mode: "stock",
      aiPrompt: "A team of African professionals in a meeting around a table in a modern bright Lagos office",
      // Owner-approved Nigerian-office footage (man helping a colleague at a laptop, busy
      // open-plan office, all dark-skinned). Pinned so we never re-roll into a non-Nigerian clip.
      clipUrl: "https://videos.pexels.com/video-files/9365198/9365198-hd_1080_1920_25fps.mp4",
      clipCredit: "Pexels / Mikhail Nilov",
      clipStartSec: 1.5,
    },
    {
      query: "reviewing financial documents desk",
      mode: "ai",
      aiPrompt:
        "An African man at a desk reviewing and comparing printed financial documents and reports, focused, modern office, shallow depth of field",
    },
    {
      query: "financial charts stock market screen",
      mode: "stock",
      aiPrompt: "Colourful financial market line and candlestick charts on a computer screen, trading data",
    },
    {
      query: "person using ATM machine",
      mode: "ai",
      aiPrompt:
        "A Nigerian man using an outdoor ATM cash machine, pressing the keypad, side view, daytime, soft urban background, shallow depth of field",
    },
    {
      query: "African businesswoman working laptop office",
      mode: "stock",
      aiPrompt: "An African businesswoman working on a laptop at a desk in a modern office, reviewing finances",
    },
    {
      query: "budget planning desk calculator",
      mode: "ai",
      aiPrompt:
        "A person planning a household budget at a desk with a calculator, a notebook and a laptop, hands writing, warm natural light, shallow depth of field",
    },
    {
      query: "African man using laptop finance office",
      mode: "stock",
      aiPrompt: "An African man reviewing financial figures on a laptop at a desk in a modern office",
    },
  ],
};

// Realistic look for AI-generated B-roll (NOT the branded house art direction) so it
// blends with real stock footage rather than looking like a graphic.
const BROLL_AI_STYLE =
  "Realistic photographic stock image, cinematic natural lighting, documentary feel, shallow depth of field. No text, no logos, no watermarks, no charts, no graphic-design elements.";

// Generate an AI image for a b-roll query (last-resort), saved to the shared media
// volume so the worker can read it by path. Returns its absolute path, or null.
async function generateAiBroll(query: string): Promise<string | null> {
  try {
    const { data } = await generateAiImageBytes(query, BROLL_AI_STYLE);
    const dir = nodePath.join(MEDIA_ROOT, "broll-ai");
    await fsp.mkdir(dir, { recursive: true });
    const file = nodePath.join(dir, `${nodeCrypto.createHash("sha1").update(`${query}${Date.now()}`).digest("hex").slice(0, 16)}.png`);
    await fsp.writeFile(file, data);
    return file;
  } catch {
    return null;
  }
}

type ResolvedMedia = { url: string; credit: string; kind: "video" | "image"; startSec?: number } | null;

// Resolve ONE free-text query to a b-roll clip, in order of preference:
//   1) a stock VIDEO, 2) a stock PHOTO, 3) an AI-GENERATED image (last resort).
// Photos/AI images are stills the worker Ken-Burns into a clip. Null → nothing usable.
// Used for sites WITHOUT a curated override (the script's own literal query).
async function resolveStockMedia(query: string): Promise<ResolvedMedia> {
  const vid = await fetchStockVideoUrl(query).catch(() => null);
  if (vid) return { url: vid.url, credit: vid.credit, kind: "video" };
  const img = await fetchStockPhotoUrl(query).catch(() => null);
  if (img) return { url: img.url, credit: img.credit, kind: "image" };
  const ai = await generateAiBroll(query);
  if (ai) return { url: ai, credit: "AI-generated", kind: "image" };
  return null;
}

// Resolve ONE curated b-roll slot, honouring its mode (see CHECKINVEST CURRENCY RULE):
//   mode "ai"    → AI image only (never stock, so the currency is right); skip on failure.
//   mode "stock" → stock video → stock photo → AI image (Nigeria-focused) fallback.
async function resolveCurated(item: CuratedBRoll): Promise<ResolvedMedia> {
  if (item.mode === "ai") {
    const ai = await generateAiBroll(item.aiPrompt);
    return ai ? { url: ai, credit: "AI-generated", kind: "image" } : null;
  }
  // A vetted, owner-approved clip wins — deterministic and known on-brand (search keeps
  // returning non-Nigerian footage). Optional startSec skips an unwanted opening shot.
  if (item.clipUrl) return { url: item.clipUrl, credit: item.clipCredit ?? "Pexels", kind: "video", startSec: item.clipStartSec };
  const vid = await fetchStockVideoUrl(item.query).catch(() => null);
  if (vid) return { url: vid.url, credit: vid.credit, kind: "video" };
  const img = await fetchStockPhotoUrl(item.query).catch(() => null);
  if (img) return { url: img.url, credit: img.credit, kind: "image" };
  const ai = await generateAiBroll(item.aiPrompt);
  return ai ? { url: ai, credit: "AI-generated", kind: "image" } : null;
}

// Turn the script's b-roll plan into resolved B-roll segments. For sites with a query
// override (e.g. checkinvest) the curated finance/Nigeria terms REPLACE the script's
// query (varied per slot); otherwise the script's literal query is used. Video first,
// photo fallback. Capped by settings.social_media_mix.videoBrollMax (default 2; 0 off).
// Shared by the recipe demos (here) and the URL-tour daily videos (tour.ts).
export async function resolveBRoll(data: Record<string, unknown> | null, site?: string): Promise<BRoll[]> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "social_media_mix"));
  const maxRaw = (row?.value as { videoBrollMax?: number } | undefined)?.videoBrollMax;
  const max = typeof maxRaw === "number" && maxRaw >= 0 ? Math.min(Math.floor(maxRaw), 3) : 2;
  if (max === 0) return [];
  const curated = site ? SITE_CURATED_BROLL[site] : undefined;
  const raw = Array.isArray(data?.broll) ? (data!.broll as Record<string, unknown>[]) : [];
  const out: BRoll[] = [];
  for (const r of raw.slice(0, max)) {
    const say = enforceNoDashPunctuation(String(r?.say ?? "").trim());
    if (!say) continue;
    // Curated sites (checkinvest) ignore the script's query and use the on-brand slot
    // (AI for currency, stock for offices/laptops/charts); others use the script's query.
    const media = curated ? await resolveCurated(curated[out.length % curated.length]) : await resolveStockMedia(String(r?.query ?? "").trim());
    if (!media) continue;
    const place = r?.place === "beforeOutro" ? "beforeOutro" : "afterIntro";
    out.push({ id: `broll_${out.length}`, place, say, videoUrl: media.url, credit: media.credit, kind: media.kind, startSec: media.startSec });
  }
  return out;
}

// Re-resolve the CLIPS for an existing b-roll plan (keeping the spoken lines + places)
// — used to swap stock footage on a re-render WITHOUT re-running the script or voice.
// For curated sites (checkinvest) it pulls fresh on-brand clips; otherwise it keeps the
// existing clip (the original query isn't retained).
export async function reResolveBRoll(existing: BRoll[], site?: string): Promise<BRoll[]> {
  const curated = site ? SITE_CURATED_BROLL[site] : undefined;
  if (!curated) return existing;
  const out: BRoll[] = [];
  for (let i = 0; i < existing.length; i++) {
    const b = existing[i];
    const media = await resolveCurated(curated[i % curated.length]);
    out.push(media ? { ...b, videoUrl: media.url, credit: media.credit, kind: media.kind, startSec: media.startSec } : b);
  }
  return out;
}

// Scenario builder. Turns a deterministic recipe into a full demo
// scenario with brand-voice narration — written by Tess's routed brain (Groq →
// fallback chain). The click-path is fixed; only the words are generated. Hard
// rule, enforced by a numeric guard: the script may reference the INPUT values we
// type in, but never states the computed RESULT (it appears live on screen), and
// never invents any other figure.

// Per-site brand features Tess should weave into every script for that site.
export const SITE_SCRIPT_HINTS: Record<string, string> = {
  calculatry:
    "Calculatry's standout feature is its built-in AI Assistant — you describe any problem in plain English and get an instant, smart answer (no forms, no guessing). Work a natural, enthusiastic mention of the AI Assistant into the script.",
  resumehub:
    "GlobalResumeHub's standout feature is country-specific resumes — it builds your CV to the exact format, length and sections local employers expect, across 195+ countries (free, no sign-up, instant Word/PDF). Work a natural, enthusiastic mention of the country-specific formatting into the script.",
  checkinvest:
    "CheckInvestNg's standout feature is live official data — its calculators run on real CBN and DMO rates refreshed every few hours, so the numbers reflect the true Nigerian market (FGN Bonds, T-Bills, fixed deposits and more). Work in a natural mention that the rates are live and official. Stay strictly informational — never give financial advice.",
};

// How each brand name must be SPOKEN by the voiceover. The TTS slurs "CheckInvestNg",
// so we spell the suffix as separate letters. Injected into the script prompts.
export const SITE_SAY_AS: Record<string, string> = {
  checkinvest:
    'PRONUNCIATION (critical): the brand is "CheckInvestNg", said "check-invest-EN-GEE" — the N and G are SEPARATE LETTERS, never "-ing". Whenever the brand name is in a SPOKEN line, write it as "CheckInvest N G", and write the address as "checkinvest N G dot com", so the voiceover says it correctly.',
};

const focusDefault = (action: string, explicit?: boolean): boolean =>
  explicit !== undefined ? explicit : !["goto", "wait"].includes(action);

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanTags(raw: unknown, fallback: string[]): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const tags = arr
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/^#*/, "")}`))
    .map((t) => t.replace(/\s+/g, ""));
  const merged = [...tags, ...fallback.map((t) => (t.startsWith("#") ? t : `#${t}`))];
  return [...new Set(merged)].slice(0, 6);
}

export async function buildDemoScenario(
  recipe: DemoRecipe,
  opts?: { notes?: string },
): Promise<{
  scenario: DemoScenario;
  guard: { ok: boolean; offending: string[] };
  model: string;
}> {
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, recipe.site));
  const meta = SITE_META[recipe.site];

  // Numbers the script is allowed to say: the input values we deliberately type.
  const inputValues = recipe.steps
    .filter((s) => (s.action === "fill" || s.action === "select") && s.value)
    .map((s) => String(s.value))
    .join(" ");
  const allowedSource = `${recipe.summary} ${inputValues}`;

  const beats = recipe.steps.map((s, i) => `${i + 1}. [${s.id}] ${s.beat}${s.value && (s.action === "fill" || s.action === "select") ? ` (value: ${s.value})` : ""}`).join("\n");

  const system = [
    `You are a witty, award-winning short-form video ad writer and voiceover scriptwriter for "${meta.name}" (${meta.domain}). You write punchy, funny, scroll-stopping demo ads with real personality — the kind of clip people watch twice and tag a friend in.`,
    brand?.voice ? `Brand voice: ${brand.voice}` : "",
    brand?.audience ? `Audience: ${brand.audience}` : "",
    `This is a screen-recorded demo of the "${recipe.feature}". A voice narrates while the viewer watches it being used. Write a tight, HIGH-ENERGY, genuinely entertaining voiceover.`,
    ``,
    `HOW TO WRITE IT:`,
    `- Open with a killer HOOK — a relatable question, a cheeky exaggeration, or a bold promise. Never "In this video" / "Today I'll show you" / "Welcome".`,
    `- Be FUNNY and human: a clever aside, a wink, playful phrasing, a little self-aware humor. Make them smile — confident, never cheesy or cringe.`,
    `- Be INTERACTIVE: talk to one person as "you", drop the odd rhetorical question, build little moments of anticipation ("ready?", "watch this").`,
    `- Sell the BENEFIT, don't just narrate the click. "Pop in your weight" beats "enter the weight field." Make easy feel delightful.`,
    `- Vary the rhythm hard: mostly punchy 4–13 word lines, with the occasional one-word jolt ("Boom." "Done." "Easy."). Build momentum to the result.`,
    `- HARD LIMITS (keep it snappy — long lines make the video drag): the intro hook is ONE sentence, max ~16 words; every scene line max ~16 words.`,
    `- End on a confident, specific call to action with a little charm.`,
    `- No emojis, markdown, quotes, hashtags-in-lines, or stage directions. Plain spoken sentences only.`,
    COPY_STANDARD,
    PERSUASION_STANDARD,
    `CRITICAL: You may reference the INPUT values we type (given per beat), but NEVER state the calculated RESULT (it appears live on screen), so tease it ("and boom, there's your number"). Never invent any figure not given to you.`,
    brand?.notFinancialAdvice ? `This brand covers finance: stay informational, never give financial advice.` : "",
    SITE_SCRIPT_HINTS[recipe.site] ? `KEY BRAND FEATURE TO WORK IN: ${SITE_SCRIPT_HINTS[recipe.site]}` : "",
    SITE_SAY_AS[recipe.site] ? SITE_SAY_AS[recipe.site] : "",
    ``,
    `Return STRICT JSON only (no prose around it), this exact shape:`,
    `{"intro":{"title":"<=5-word punchy on-screen title","say":"the hook line, spoken over the intro card"},"scenes":[{"id":"<beat id>","say":"one punchy spoken line for that beat"}],"outro":{"say":"confident closing call to action"},"caption":"1-2 sentence scroll-stopping social caption (no hashtags)","hashtags":["#tag","#tag","#tag"],"delivery":"a short voice-director note for the voice actor: the tone, energy, pacing and feeling to read the whole script with (e.g. 'bright, playful, high-energy; conversational; lean into the questions; land the punchlines with a smile')","broll":[{"place":"afterIntro","query":"2-4 word search naming the LITERAL subject of THIS feature","say":"one spoken line over the footage, <=16 words"}]}`,
    `One scenes entry per beat id below, in order. Make every line earn its place.`,
    `B-ROLL: add 1 "broll" (place "afterIntro"); optionally a second (place "beforeOutro"). The "query" MUST name the LITERAL real-world subject of THIS feature — concrete nouns from the topic, not a metaphor (e.g. a nicotine/smoking tool → "person smoking cigarette"; a mortgage tool → "house keys handover"; a calorie tool → "healthy food plate"). Real footage of that subject only — never UI, screenshots, text, or an abstract idea. If no concrete subject fits, return an empty broll array.`,
  ]
    .filter((l) => l !== undefined && l !== null)
    .join("\n");

  const notes = opts?.notes?.trim();
  const user =
    `Feature: ${recipe.feature}\nWhat it does: ${recipe.summary}\n` +
    (notes ? `\nADMIN'S EXTRA GUIDANCE (weave this in, it matters): ${notes}\n` : "") +
    `\nBeats (write one vivid, witty, benefit-driven line per id, in order):\n${beats}`;

  async function generate(extraSystem = ""): Promise<{ data: Record<string, unknown> | null; model: string }> {
    const r = await generateRouted({
      taskId: "demo_script",
      system: extraSystem ? `${system}\n${extraSystem}` : system,
      user,
      maxTokens: 1000,
      temperature: 0.9,
      preferModel: "sonnet", // Claude Sonnet writes the scripts; falls back if unavailable
    });
    return { data: extractJson(r.text), model: r.model };
  }

  let { data, model } = await generate();

  const assemble = (d: Record<string, unknown> | null): DemoScenario => {
    const rawScenes = Array.isArray(d?.scenes) ? (d!.scenes as Record<string, unknown>[]) : [];
    // Map by beat id when the model echoes them, else fall back to positional order
    // (Llama often returns numeric ids like "1","2" instead of the beat ids).
    const byId = new Map<string, string>();
    rawScenes.forEach((s) => {
      if (s && s.id != null) byId.set(String(s.id), String(s.say ?? "").trim());
    });

    const scenes: DemoScene[] = recipe.steps.map((step, i) => {
      const fromId = byId.get(step.id);
      const fromIdx = rawScenes[i] ? String((rawScenes[i] as Record<string, unknown>).say ?? "").trim() : "";
      return {
        id: step.id,
        action: step.action,
        target: step.target,
        value: step.value,
        focus: focusDefault(step.action, step.focus),
        settleMs: step.settleMs ?? 600,
        say: enforceNoDashPunctuation(fromId && fromId.length ? fromId : fromIdx),
      };
    });

    const intro = (d?.intro ?? {}) as Record<string, unknown>;
    const outro = (d?.outro ?? {}) as Record<string, unknown>;
    return {
      recipeId: recipe.id,
      site: recipe.site,
      feature: recipe.feature,
      url: recipe.url,
      baseViewport: recipe.baseViewport,
      intro: {
        title: enforceNoDashPunctuation(String(intro.title ?? recipe.feature)).slice(0, 60),
        say: enforceNoDashPunctuation(String(intro.say ?? `Here's how easy the ${recipe.feature} is on ${meta.name}.`).trim()),
      },
      scenes,
      outro: { say: enforceNoDashPunctuation(String(outro.say ?? `Try the ${recipe.feature} free at ${meta.domain}.`).trim()) },
      caption: enforceNoDashPunctuation(String(d?.caption ?? recipe.summary).trim()),
      hashtags: cleanTags(d?.hashtags, (brand?.hashtags as string[]) ?? []),
      delivery: enforceNoDashPunctuation(String(d?.delivery ?? "").trim()) || undefined,
    };
  };

  const guardOf = (sc: DemoScenario) =>
    numericGuard([sc.intro.say, ...sc.scenes.map((s) => s.say), sc.outro.say, sc.caption].join(" "), allowedSource);

  let scenario = assemble(data);
  let guard = guardOf(scenario);

  // One corrective pass if the model invented a figure (e.g. stated the BMI result).
  if (!guard.ok) {
    const retry = await generate(
      `Your previous script stated numbers that are not allowed (${guard.offending.join(", ")}) — likely the computed result. Rewrite describing the result generically and using only the input values provided.`,
    );
    if (retry.data) {
      data = retry.data;
      model = retry.model;
      scenario = assemble(data);
      guard = guardOf(scenario);
    }
  }

  // Resolve stock B-roll from the chosen script (composite videos). Failures are
  // swallowed inside resolveBRoll → the demo still renders without B-roll.
  const bRoll = await resolveBRoll(data, recipe.site).catch(() => [] as BRoll[]);
  if (bRoll.length) scenario.bRoll = bRoll;

  return { scenario, guard, model };
}
