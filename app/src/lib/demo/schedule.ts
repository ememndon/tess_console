import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentPages, settings } from "@/lib/db/schema";
import { SITE_KEYS, type SiteKey } from "@/lib/site-scope";

// Weekly demo-video rotation — one site per day, Sunday off. Each scheduled render
// tours a RANDOM content page from the site's relevant category, and never repeats
// a page until every other page in that category has been featured (then a fresh
// round starts). Page pools come from the nightly-crawled content inventory, so
// they track the live sites automatically (no hardcoded lists).
//   Mon→Calculatry  Tue→GlobalResumeHub  Wed→CheckInvest
//   Thu→Calculatry  Fri→GlobalResumeHub  Sat→CheckInvest   Sun→(none)
// Weekday is evaluated in UTC (server time). Homepage videos are intentionally NOT
// scheduled — the owner triggers those manually in chat.
const WEEKDAY_SITE: Record<number, SiteKey | null> = {
  0: null, // Sun — off
  1: "calculatry",
  2: "resumehub",
  3: "checkinvest",
  4: "calculatry",
  5: "resumehub",
  6: "checkinvest",
};

export function scheduledSiteFor(date = new Date()): SiteKey | null {
  return WEEKDAY_SITE[date.getUTCDay()] ?? null;
}

// Video generation hour (UTC). The day's text/image posts are generated 00:00–05:00
// (one per site each hour); video generation runs at 06:00, after the image posts are
// ready, so the full day's content is queued for the admin to review by ~06:00–07:00.
// The hourly cron only enqueues when the current hour matches this.
export const VIDEO_RENDER_HOUR_UTC = 6;

// The standing content plan for a month — overlaid on the Social Studio calendar.
// Every day each site gets `postsPerDay` posts; a demo video also renders on the
// site's scheduled day (Mon/Thu Calculatry, Tue/Fri ResumeHub, Wed/Sat CheckInvest,
// Sun none). Pure (no DB) — the actual pages/captions are produced at run time.
export type DayPlan = { day: number; site: SiteKey; posts: number; video: boolean };
export function contentPlanForMonth(year: number, month: number, postsPerDay: number): DayPlan[] {
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out: DayPlan[] = [];
  for (let d = 1; d <= days; d++) {
    const videoSite = scheduledSiteFor(new Date(Date.UTC(year, month, d)));
    for (const site of SITE_KEYS) out.push({ day: d, site: site as SiteKey, posts: postsPerDay, video: videoSite === site });
  }
  return out;
}

// First-segment denylist: homepage, blog and legal/info pages are never featured.
const DENY =
  /^\/(blog|about|contact|contact-us|faq|privacy|privacy-policy|terms|terms-of-use|terms-of-service|widget-terms|cookies?|cookie-policy|disclaimer|sitemap|get-widget|widget|login|signup|register|countries|search)(\/|$)/;

// What each site features:
//   calculatry  → any calculator/tool page (everything except homepage/blog/legal)
//   resumehub   → a country landing page (single segment, e.g. /germany/; not /download/)
//   checkinvest → a calculator or tool (/calculators/* or /tools/*)
function inCategory(site: SiteKey, path: string): boolean {
  if (DENY.test(path)) return false;
  if (site === "calculatry") return path !== "/";
  if (site === "resumehub") return /^\/[a-z][a-z-]*\/$/.test(path);
  if (site === "checkinvest") return /^\/(calculators|tools)\//.test(path);
  return false;
}

type Pool = { url: string; path: string }[];

async function poolFor(site: SiteKey): Promise<Pool> {
  const rows = await db
    .select({ url: contentPages.url, path: contentPages.path })
    .from(contentPages)
    .where(eq(contentPages.site, site));
  return rows.filter((r) => inCategory(site, r.path));
}

// Human label from a page path: last slug → Title Case.
//   /lawn-fertilizer-calculator/ → "Lawn Fertilizer Calculator"
//   /germany/ → "Germany"   /calculators/fixed-deposit → "Fixed Deposit"
function titleFromPath(path: string): string {
  const seg = path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  return seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || path;
}

export type ScheduledTarget = { url: string; feature: string; notes?: string };

// Rotation cursor lives in settings.demo_rotation = { [site]: { done: string[] } }
// — the page paths already featured in the current round. A site's list resets to
// empty once every page has been featured, starting the next round.
type RotationState = Record<string, { done: string[] }>;

async function loadRotation(): Promise<RotationState> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "demo_rotation"));
  return (row?.value as RotationState) ?? {};
}

async function saveRotation(state: RotationState): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "demo_rotation", value: state })
    .onConflictDoUpdate({ target: settings.key, set: { value: state, updatedAt: new Date() } });
}

// Pick the next page for a site: random, never repeating until the category is
// exhausted, then a fresh round. commit=false previews without advancing the
// cursor (dry runs). Returns null if the site has no pages in its category yet.
export async function selectScheduledTarget(site: SiteKey, opts: { commit: boolean }): Promise<ScheduledTarget | null> {
  const pool = await poolFor(site);
  if (pool.length === 0) return null;

  const state = await loadRotation();
  let done = state[site]?.done ?? [];
  let eligible = pool.filter((p) => !done.includes(p.path));
  if (eligible.length === 0) {
    done = []; // round complete → start a new round with the full pool
    eligible = pool;
  }
  const pick = eligible[Math.floor(Math.random() * eligible.length)];

  if (opts.commit) {
    done.push(pick.path);
    state[site] = { done };
    await saveRotation(state);
  }
  return { url: pick.url, feature: titleFromPath(pick.path) };
}

// How many pages remain before a site's current round completes (for status/logging).
export async function rotationStatus(site: SiteKey): Promise<{ total: number; done: number; remaining: number }> {
  const pool = await poolFor(site);
  const state = await loadRotation();
  const done = (state[site]?.done ?? []).filter((p) => pool.some((x) => x.path === p)).length;
  return { total: pool.length, done, remaining: Math.max(0, pool.length - done) };
}
