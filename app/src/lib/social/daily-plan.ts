import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentPages, settings, socialPosts, socialMedia, socialTargets } from "@/lib/db/schema";
import { generateCaption, generateBannerCopy } from "@/lib/generate";
import { renderBanner } from "@/lib/banner";
import { generateAiBackgroundBytes } from "@/lib/image-gen";
import { nextPlannedItem, flagLowBacklogIfNeeded } from "@/lib/research/grid";
import { generatePlanItem } from "@/lib/research/generate-post";
import { fetchStockPhoto, stockQueryFor } from "@/lib/stock-media";
import { reviewPost } from "@/lib/social/review";
import { enabledPlatformsFor } from "@/lib/social/channels";
import { contentRulesBlock } from "@/lib/content-rules";
import { newPostRef } from "@/lib/social";
import { audit } from "@/lib/audit";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import type { Platform } from "@/lib/social-types";

// ────────────────── Daily content framework (owner-approved 2026-06-20) ──────────────────
// 5 posts/day/site, Mon–Sun. Each post = caption (text) + image (banner OR AI), saved as a
// Social Studio DRAFT for the admin to review and schedule manually. Pillars rotate daily;
// images alternate banner/AI (3 banner + 2 AI). Posts generate overnight (00:00–04:00 UTC,
// one slot per hour) so the full day is queued by morning. Tess sets NO posting times.

type ImageKind = "banner" | "ai";
type PageStrategy = "specific" | "home";
type Pillar = { id: string; label: string; image: ImageKind; page: PageStrategy };

// Base order; the day's actual order is a cyclic shift of this (see pillarForSlot).
const PILLARS: Pillar[] = [
  { id: "spotlight", label: "Tool Spotlight", image: "banner", page: "specific" },
  { id: "howto", label: "How-To", image: "ai", page: "specific" },
  { id: "problem", label: "Problem & Solution", image: "ai", page: "specific" },
  { id: "engagement", label: "Engagement", image: "banner", page: "home" },
  { id: "brand", label: "Brand & Trust", image: "banner", page: "home" },
];
export const POSTS_PER_DAY = PILLARS.length;

// Cyclic daily rotation so a given slot is not always the same pillar.
export function pillarForSlot(date: Date, slot: number): Pillar {
  const shift = date.getUTCDay() % PILLARS.length;
  return PILLARS[(slot + shift) % PILLARS.length];
}

// ── Page pools (mirror the demo schedule's category filters; separate cursor) ──
const DENY =
  /^\/(blog|about|contact|contact-us|faq|privacy|privacy-policy|terms|terms-of-use|terms-of-service|widget-terms|cookies?|cookie-policy|disclaimer|sitemap|get-widget|widget|login|signup|register|countries|search)(\/|$)/;
function inCategory(site: string, path: string): boolean {
  if (DENY.test(path)) return false;
  if (site === "calculatry") return path !== "/";
  if (site === "resumehub") return /^\/[a-z][a-z-]*\/$/.test(path);
  if (site === "checkinvest") return /^\/(calculators|tools)\//.test(path);
  return false;
}
function titleFromPath(path: string): string {
  const seg = path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || path;
}
function homepage(site: string): string {
  const d = SITE_META[site as SiteKey]?.domain;
  return d ? `https://${d}` : "";
}

type PageRef = { url: string; title: string };

// Random, non-repeating page from the site's category, own cursor in
// settings.post_rotation (independent of the video schedule's cursor).
// ── Daily theming: align the chosen page to the day's topic ──
// Calculatry rotates its categories; ResumeHub rotates regions; CheckInvest themes
// the caption only (just 11 tool pages). The theme narrows the page pool; if the
// themed subset is empty/exhausted it falls back to the full pool, so theming never
// blocks a post.

// Calculatry: best-effort slug → category (unmatched = everyday).
const CALC_HEALTH = ["bmi","bmr","tdee","calorie","calories","body-fat","macro","pregnancy","ovulation","due-date","ideal-weight","water-intake","heart-rate","protein","cholesterol","a1c","gfr","waist","lean-body","sleep","steps","pace","running","fasting","cigarette","smoking","alcohol","fitness","health","weight"];
const CALC_FINANCE = ["mortgage","loan","interest","savings","saving","debt","tax","salary","income","wage","hourly","investment","invest","retirement","401k","roth","ira","apr","apy","compound","budget","net-worth","networth","inflation","currency","exchange","paycheck","discount","markup","profit","margin","roi","annuity","bond","amortization","refinance","credit","dividend","depreciation","commission","finance","money","price"];
const CALC_MATH = ["gcd","lcm","quadratic","matrix","logarithm","percentage","percent","fraction","ratio","proportion","exponent","factorial","prime","scientific","standard-deviation","median","average","rounding","significant-figures","slope","perimeter","circumference","pythagorean","derivative","integral","statistics","probability","permutation","combination","sample-size","z-score","square-root","modulo","trigonometry","algebra","geometry","decimal","binary","solver"];
function calcCategory(path: string): "health" | "finance" | "math" | "everyday" {
  const s = path.toLowerCase();
  if (CALC_HEALTH.some((k) => s.includes(k))) return "health";
  if (CALC_FINANCE.some((k) => s.includes(k))) return "finance";
  if (CALC_MATH.some((k) => s.includes(k))) return "math";
  return "everyday";
}
const CALC_DAY: Record<number, "health" | "finance" | "math" | "everyday" | null> = { 0: null, 1: "finance", 2: "health", 3: "math", 4: "everyday", 5: "finance", 6: "everyday" };

// ResumeHub: country slug → region.
const REGIONS: Record<string, string[]> = {
  europe: ["albania","andorra","austria","belarus","belgium","bosnia-and-herzegovina","bulgaria","croatia","cyprus","czechia","denmark","estonia","finland","france","germany","greece","hungary","iceland","ireland","italy","kosovo","latvia","liechtenstein","lithuania","luxembourg","malta","moldova","monaco","montenegro","netherlands","north-macedonia","norway","poland","portugal","romania","russia","san-marino","serbia","slovakia","slovenia","spain","sweden","switzerland","ukraine","united-kingdom"],
  asia: ["afghanistan","armenia","azerbaijan","bangladesh","bhutan","brunei","cambodia","china","georgia","india","indonesia","japan","kazakhstan","kyrgyzstan","laos","malaysia","maldives","mongolia","myanmar","nepal","north-korea","pakistan","philippines","singapore","south-korea","sri-lanka","taiwan","tajikistan","thailand","timor-leste","turkmenistan","uzbekistan","vietnam"],
  africa: ["algeria","angola","benin","botswana","burkina-faso","burundi","cameroon","cape-verde","central-african-republic","chad","comoros","democratic-republic-of-the-congo","djibouti","egypt","equatorial-guinea","eritrea","eswatini","ethiopia","gabon","gambia","ghana","guinea","guinea-bissau","ivory-coast","kenya","lesotho","liberia","libya","madagascar","malawi","mali","mauritania","mauritius","morocco","mozambique","namibia","niger","nigeria","republic-of-the-congo","rwanda","sao-tome-and-principe","senegal","seychelles","sierra-leone","somalia","south-africa","south-sudan","sudan","tanzania","togo","tunisia","uganda","zambia","zimbabwe"],
  americas: ["antigua-and-barbuda","argentina","bahamas","barbados","belize","bolivia","brazil","canada","chile","colombia","costa-rica","cuba","dominica","dominican-republic","ecuador","el-salvador","grenada","guatemala","guyana","haiti","honduras","jamaica","mexico","nicaragua","panama","paraguay","peru","saint-kitts-and-nevis","saint-lucia","saint-vincent-and-the-grenadines","suriname","trinidad-and-tobago","united-states","uruguay","venezuela"],
  "mideast-oceania": ["bahrain","iran","iraq","israel","jordan","kuwait","lebanon","oman","palestine","qatar","saudi-arabia","syria","turkey","united-arab-emirates","yemen","australia","fiji","kiribati","marshall-islands","micronesia","nauru","new-zealand","palau","papua-new-guinea","samoa","solomon-islands","tonga","tuvalu","vanuatu"],
};
const REGION_LABEL: Record<string, string> = { europe: "Europe", asia: "Asia", africa: "Africa", americas: "Americas", "mideast-oceania": "Middle East & Oceania" };
const RESUME_DAY: Record<number, string | null> = { 0: null, 1: "europe", 2: "asia", 3: "africa", 4: "americas", 5: "mideast-oceania", 6: null };
function regionOfPath(path: string): string | null {
  const slug = path.replace(/^\/+|\/+$/g, "");
  for (const [region, list] of Object.entries(REGIONS)) if (list.includes(slug)) return region;
  return null;
}

const CHECK_DAY: Record<number, string | null> = { 0: "Smart Money basics", 6: "Scam Alert" };

type Theme = { label: string | null; filter?: (path: string) => boolean };
export function themeForDay(site: string, date: Date): Theme {
  const dow = date.getUTCDay();
  if (site === "calculatry") {
    const cat = CALC_DAY[dow];
    if (!cat) return { label: null };
    return { label: cat.charAt(0).toUpperCase() + cat.slice(1), filter: (p) => calcCategory(p) === cat };
  }
  if (site === "resumehub") {
    const region = RESUME_DAY[dow];
    if (!region) return { label: null };
    return { label: REGION_LABEL[region], filter: (p) => regionOfPath(p) === region };
  }
  if (site === "checkinvest") return { label: CHECK_DAY[dow] ?? null };
  return { label: null };
}

async function pickPage(site: string, commit: boolean, filter?: (path: string) => boolean): Promise<PageRef> {
  const rows = await db.select({ url: contentPages.url, path: contentPages.path }).from(contentPages).where(eq(contentPages.site, site));
  const pool = rows.filter((r) => inCategory(site, r.path));
  if (pool.length === 0) return { url: homepage(site), title: SITE_META[site as SiteKey]?.name ?? site };
  const themed = filter ? pool.filter((p) => filter(p.path)) : pool;
  const base = themed.length ? themed : pool; // themed subset empty → fall back to full pool
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "post_rotation"));
  const state = (row?.value as Record<string, { done: string[] }>) ?? {};
  let done = state[site]?.done ?? [];
  let eligible = base.filter((p) => !done.includes(p.path));
  if (eligible.length === 0) {
    // This theme's pages are all used — restart just this subset, keep other progress.
    const basePaths = new Set(base.map((p) => p.path));
    done = done.filter((p) => !basePaths.has(p));
    eligible = base;
  }
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  if (commit) {
    done.push(pick.path);
    state[site] = { done };
    await db.insert(settings).values({ key: "post_rotation", value: state }).onConflictDoUpdate({ target: settings.key, set: { value: state, updatedAt: new Date() } });
  }
  return { url: pick.url, title: titleFromPath(pick.path) };
}

// ── Platform routing (per the owner's account setup) ──
//   Calculatry / CheckInvestNg → X + Facebook
//   GlobalResumeHub → X + Facebook; the daily Spotlight (a country page) ALSO goes to
//   LinkedIn (the 1/day "Country CV Spotlight"), since LinkedIn job-seekers benefit most.
function platformsFor(site: string, pillarId: string): Platform[] {
  const base: Platform[] = ["x", "facebook"];
  if (site === "resumehub" && pillarId === "spotlight") return [...base, "linkedin"];
  return base;
}

// ── Per-pillar, per-site caption direction ──
function guidanceFor(pillar: Pillar, site: string, pageTitle: string): string {
  const scam = site === "checkinvest";
  const name = SITE_META[site as SiteKey]?.name ?? site;
  switch (pillar.id) {
    case "spotlight":
      if (site === "resumehub")
        return `Feature that a CV tailored to ${pageTitle}'s local hiring norms can be generated right now. Speak to job seekers applying to ${pageTitle}. One clear benefit and a try-it call to action.`;
      return `Feature the "${pageTitle}" page as the hero. Lead with one clear benefit and a try-it call to action. Scroll-stopping.`;
    case "howto":
      return `Teach one quick, genuinely useful tip that the "${pageTitle}" page helps with. Lead with the win, keep it practical.${scam ? " Frame it around protecting the reader's money." : ""}`;
    case "problem":
      if (scam)
        return `SCAM-AWARE. Open with a too-good-to-be-true investment scenario (for example a promised high monthly return), then tell the reader to run the numbers and verify before investing, pointing to the "${pageTitle}" tool. Educational, never financial advice.`;
      return `Open with a relatable problem the audience faces, then point to the "${pageTitle}" page as the fix. Story-driven and concrete.`;
    case "engagement":
      return `Ask a fun, low-effort question or a this-or-that the audience will reply to. Light and relatable.${scam ? " Ask about suspicious investment pitches they have come across." : ""} Soft brand mention only.`;
    case "brand":
      if (scam) return `TRUST and SCAM-AWARE. Remind people to verify any investment before committing: before you invest, check. Confident and reassuring.`;
      if (site === "resumehub") return `Remind people there are free CV formats for 195 countries, each tailored to local hiring norms. Confident and benefit-led.`;
      return `Remind people what ${name} offers and why it is worth using. Confident and benefit-led.`;
    default:
      return "";
  }
}

export type DailyPostResult = {
  site: string;
  slot: number;
  pillar: string;
  image: ImageKind;
  page: string;
  platforms: Platform[];
  caption: string;
  guard: boolean;
  ref?: string;
  committed: boolean;
};

// Share of AI-image posts that draw a real stock photo instead of generating one
// (cuts FLUX load + cost). Tunable via settings.social_media_mix.stockPhotoShare (0..1).
const DEFAULT_STOCK_PHOTO_SHARE = 0.5;
async function stockPhotoShare(): Promise<number> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "social_media_mix"));
  const v = (row?.value as { stockPhotoShare?: number } | undefined)?.stockPhotoShare;
  return typeof v === "number" && v >= 0 && v <= 1 ? v : DEFAULT_STOCK_PHOTO_SHARE;
}

// Scene description for a text-free AI backdrop. Describes subject matter only
// (never the caption); the headline is composited on top as real type afterwards.
function aiScene(site: string, pageTitle: string, pillarLabel: string): string {
  const name = SITE_META[site as SiteKey]?.name ?? site;
  return `A premium, editorial brand backdrop for ${name} evoking the theme of "${pageTitle}" (${pillarLabel}). A real photographic or richly illustrated scene with one clear focal point and calm negative space on the left for a headline overlay.`;
}

// Generate one post for a site at a given slot. commit=false = dry preview (writes
// the caption but renders no image, inserts nothing, and does not advance the cursor).
export async function generateDailyPost(opts: { site: string; slot: number; date?: Date; commit: boolean }): Promise<DailyPostResult> {
  const date = opts.date ?? new Date();

  // The Content Director plan GUIDES this slot: if the site has an unused IMAGE
  // brief, generate that (caption + banner) and tag it with this pipeline slot so
  // the once-per-slot idempotency still holds. Generic pillars are the FALLBACK,
  // used only when the plan is empty. (Dry previews always use the pillar path.)
  if (opts.commit) {
    const item = await nextPlannedItem(opts.site, "image");
    if (item) {
      const r = await generatePlanItem(item.id, { actor: "daily-pipeline", requestedBy: "auto", createdBy: "tess", pipeline: { source: "daily-pipeline", slot: opts.slot } });
      if (r.ok && r.postRef) {
        await flagLowBacklogIfNeeded(opts.site).catch(() => {}); // warn admin when the backlog is running low
        return { site: opts.site, slot: opts.slot, pillar: `plan:${item.formatId ?? "post"}`, image: "banner", page: homepage(opts.site), platforms: [], caption: item.subtopic, guard: true, ref: r.postRef, committed: true };
      }
    } else {
      await flagLowBacklogIfNeeded(opts.site).catch(() => {}); // backlog empty — flag it, then fall back to pillars
    }
  }

  const pillar = pillarForSlot(date, opts.slot);
  const theme = themeForDay(opts.site, date);
  const page = pillar.page === "specific" ? await pickPage(opts.site, opts.commit, theme.filter) : { url: homepage(opts.site), title: SITE_META[opts.site as SiteKey]?.name ?? opts.site };
  const enabled = await enabledPlatformsFor(opts.site);
  const platforms = platformsFor(opts.site, pillar.id).filter((p) => enabled.has(p));
  const guidance = guidanceFor(pillar, opts.site, page.title) + (theme.label ? ` Today's theme: ${theme.label}.` : "") + (await contentRulesBlock(opts.site));
  const primaryPlatform = platforms.includes("linkedin") ? "linkedin" : "x";

  const { caption, guard } = await generateCaption({ site: opts.site, topic: `${pillar.label}: ${page.title}`, guidance, platform: primaryPlatform });
  const finalCaption = `${caption.trim()}\n\n${page.url}`;

  const base: DailyPostResult = { site: opts.site, slot: opts.slot, pillar: pillar.id, image: pillar.image, page: page.url, platforms, caption: finalCaption, guard: guard.ok, committed: false };
  if (!opts.commit) return base;

  // Short, COMPLETE on-image copy (separate from the long caption) so the banner
  // never has to chop a sentence mid-word. Spotlight keeps the clean tool name as
  // its headline; other pillars use the generated hook.
  const copy = await generateBannerCopy({ site: opts.site, topic: `${pillar.label}: ${page.title}`, guidance });
  const bannerTitle = pillar.id === "spotlight" ? page.title : copy.headline || page.title;
  const bannerSub = copy.subhead || undefined;

  const ref = await newPostRef();
  const [post] = await db
    .insert(socialPosts)
    .values({
      ref,
      site: opts.site,
      kind: "banner", // image post (banner or AI both stored as "banner" kind)
      caption: finalCaption,
      status: "draft",
      createdBy: "tess",
      data: { pillar: pillar.id, page: page.url, image: pillar.image, slot: opts.slot, source: "daily-pipeline", numericGuard: guard.ok ? "ok" : `flagged:${guard.offending.join(",")}` },
    })
    .returning({ id: socialPosts.id });

  // Render the image. Every post MUST have one (no text-only posts). An AI pillar
  // generates a TEXT-FREE backdrop and composites the real headline on top (no more
  // gibberish baked into pixels); on any failure it falls back to the gradient
  // banner. Banner is the universal fallback.
  const bannerSpec = (bgImage?: Buffer) => ({ site: opts.site, title: bannerTitle, subtitle: bannerSub, bgImage });
  let imageOutcome: string = pillar.image;
  let imageNote = "";
  try {
    if (pillar.image === "ai") {
      // Sometimes use a real stock photo instead of generating one (cuts AI
      // image-gen load). Chain: stock → FLUX → banner, so a post always gets an image.
      let placed = false;
      if (Math.random() < (await stockPhotoShare())) {
        // Stock photo as the backdrop + real headline composited on top (same
        // overlay path as the AI image), so stock posts are on-brand too.
        const s = await fetchStockPhoto(stockQueryFor(opts.site, page.title)).catch(() => null);
        if (s) {
          const r = await renderBanner(post.id, bannerSpec(s.data));
          await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
          imageOutcome = "stock";
          imageNote = s.credit;
          placed = true;
        }
      }
      if (!placed) {
        try {
          // Text-free AI backdrop + real headline composited on top.
          const { data: bg } = await generateAiBackgroundBytes(aiScene(opts.site, page.title, pillar.label));
          const r = await renderBanner(post.id, bannerSpec(bg));
          await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
        } catch (aiErr) {
          imageOutcome = "banner";
          imageNote = `ai-fallback: ${(aiErr instanceof Error ? aiErr.message : String(aiErr)).slice(0, 70)}`;
          const r = await renderBanner(post.id, bannerSpec());
          await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
        }
      }
    } else {
      const r = await renderBanner(post.id, bannerSpec());
      await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
    }
  } catch (e) {
    imageOutcome = "none";
    imageNote = (e instanceof Error ? e.message : String(e)).slice(0, 120);
  }
  // Pre-publish quality guard: flag the draft for review (hard flags also block
  // auto-publish in publishDuePosts).
  const review = reviewPost({ caption, headline: bannerTitle, subhead: bannerSub, image: imageOutcome, numericOk: guard.ok });
  await db
    .update(socialPosts)
    .set({ data: { pillar: pillar.id, page: page.url, image: imageOutcome, plannedImage: pillar.image, slot: opts.slot, source: "daily-pipeline", numericGuard: guard.ok ? "ok" : `flagged:${guard.offending.join(",")}`, review, ...(imageNote ? { imageNote } : {}) } })
    .where(eq(socialPosts.id, post.id));

  for (const p of platforms) {
    await db.insert(socialTargets).values({ postId: post.id, platform: p, mode: "handoff", status: "queued" });
  }
  await audit({ actorName: "Tess (daily posts)", action: "social.daily_gen", target: post.id, detail: { site: opts.site, slot: opts.slot, pillar: pillar.id, ref } });

  return { ...base, ref, committed: true };
}
