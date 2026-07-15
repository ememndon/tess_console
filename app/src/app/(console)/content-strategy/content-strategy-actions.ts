"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { brandProfiles, contentPlanItems, contentPlans } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { refreshNiche, getOutliers, type OutlierVideo } from "@/lib/research/ingest";
import { analyzeNiche, type NicheStrategy } from "@/lib/research/analyze";
import { buildContentCalendar, getSiteBacklog, setCarouselPlanSite, type GridResult, type PlanItem } from "@/lib/research/grid";
import { generatePlanItem, type GenResult } from "@/lib/research/generate-post";
import { runGscFeedback } from "@/lib/research/feedback";
import { SITE_KEYS } from "@/lib/site-scope";

const clean = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 80);

async function readNiches(site: string): Promise<string[]> {
  const [b] = await db.select({ niches: brandProfiles.niches, niche: brandProfiles.niche }).from(brandProfiles).where(eq(brandProfiles.site, site)).limit(1);
  const arr = Array.isArray(b?.niches) ? (b!.niches as unknown[]).map(String).filter(Boolean) : [];
  if (arr.length) return arr;
  return b?.niche?.trim() ? [b.niche.trim()] : [];
}

// Persist the list AND keep the singular `niche` column = niches[0] so the
// engine's default-niche lookup (resolveNiche in tools/api) keeps working.
async function writeNiches(site: string, list: string[], actor: { id: string; name: string }, action: string, detail: Record<string, unknown>): Promise<string[]> {
  const deduped: string[] = [];
  for (const n of list) {
    const c = clean(n);
    if (c && !deduped.some((x) => x.toLowerCase() === c.toLowerCase())) deduped.push(c);
  }
  await db
    .insert(brandProfiles)
    .values({ site, niche: deduped[0] ?? null, niches: deduped })
    .onConflictDoUpdate({ target: brandProfiles.site, set: { niche: deduped[0] ?? null, niches: deduped, updatedAt: new Date() } });
  await audit({ actorId: actor.id, actorName: actor.name, action, target: site, detail });
  revalidatePath("/content-strategy");
  return deduped;
}

export type NicheMutation = { ok: boolean; message?: string; niches?: string[] };

export async function addNiche(site: string, niche: string): Promise<NicheMutation> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(site)) return { ok: false, message: "Unknown site." };
  const c = clean(niche);
  if (!c) return { ok: false, message: "Type a niche first." };
  const list = await readNiches(site);
  if (list.some((x) => x.toLowerCase() === c.toLowerCase())) return { ok: false, message: `"${c}" is already added.` };
  const niches = await writeNiches(site, [...list, c], user, "content.add_niche", { niche: c });
  return { ok: true, message: `Added "${c}". Select it, then Research niche.`, niches };
}

export async function editNiche(site: string, oldNiche: string, newNiche: string): Promise<NicheMutation> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const c = clean(newNiche);
  if (!c) return { ok: false, message: "Niche can't be empty." };
  const list = await readNiches(site);
  if (!list.includes(oldNiche)) return { ok: false, message: "That niche no longer exists." };
  const niches = await writeNiches(site, list.map((x) => (x === oldNiche ? c : x)), user, "content.edit_niche", { from: oldNiche, to: c });
  return { ok: true, message: `Renamed to "${c}".`, niches };
}

export async function removeNiche(site: string, niche: string): Promise<NicheMutation> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const list = await readNiches(site);
  const niches = await writeNiches(site, list.filter((x) => x !== niche), user, "content.remove_niche", { niche });
  return { ok: true, message: `Removed "${niche}".`, niches };
}

function pickNiche(explicit: string | undefined, list: string[]): string {
  const c = explicit ? clean(explicit) : "";
  return c || list[0] || "";
}

export async function loadOutliers(niche: string): Promise<{ ok: boolean; outliers?: OutlierVideo[] }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  return { ok: true, outliers: await getOutliers(niche, 30) };
}

export async function runResearch(site: string, niche?: string, days = 90): Promise<{ ok: boolean; message?: string; niche?: string; outliers?: OutlierVideo[] }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const n = pickNiche(niche, await readNiches(site));
  if (!n) return { ok: false, message: "Add a niche for this site first." };
  const r = await refreshNiche(n, { days, site });
  if (r.note && r.fetched === 0) return { ok: false, message: r.note };
  await audit({ actorId: user.id, actorName: user.name, action: "content.research", target: site, detail: { niche: n, fetched: r.fetched } });
  revalidatePath("/content-strategy");
  return { ok: true, message: `Pulled ${r.fetched} videos for "${n}" (top outlier ${r.topOutlier ?? "n/a"}x).`, niche: n, outliers: await getOutliers(n, 30) };
}

export async function runStrategy(site: string, niche?: string): Promise<{ ok: boolean; message?: string; niche?: string; strategy?: NicheStrategy }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const n = pickNiche(niche, await readNiches(site));
  if (!n) return { ok: false, message: "Add a niche for this site first." };
  const strategy = await analyzeNiche(n, { site });
  if (!strategy.subtopics.length) return { ok: false, message: strategy.note ?? "No strategy yet — run research first." };
  return { ok: true, message: `Strategy ready for "${n}": ${strategy.subtopics.length} subtopics, ${strategy.formats.length} formats.`, niche: n, strategy };
}

export async function buildPlan(site: string, niche?: string, days = 30, source: "youtube" | "gsc" | "blend" = "youtube"): Promise<{ ok: boolean; message?: string; plan?: GridResult; items?: PlanItem[] }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  // GSC builds from the site's own Search Console demand (no niche); blend uses the
  // niche for its YouTube lane but degrades gracefully if there is none.
  const n = source === "gsc" ? "" : pickNiche(niche, await readNiches(site));
  if (source === "youtube" && !n) return { ok: false, message: "Add a niche for this site first." };
  const plan = await buildContentCalendar({ site, niche: n || undefined, days, source, createdBy: user.name });
  if (!plan.planRef) return { ok: false, message: plan.note ?? (source === "youtube" ? "Could not build a plan — run research first." : "Not enough data yet — connect Search Console, or add a niche and Research it.") };
  await audit({ actorId: user.id, actorName: user.name, action: "content.plan", target: plan.planRef, detail: { site, niche: n || plan.niche, source, days: plan.days, image: plan.imageCount, video: plan.videoCount } });
  revalidatePath("/content-strategy");
  const total = plan.imageCount + plan.videoCount;
  const label = source === "gsc" ? "Google Search demand" : source === "blend" ? "Google Search + YouTube" : `"${n}"`;
  return { ok: true, message: `Planned ${total} posts from ${label} (${plan.imageCount} image, ${plan.videoCount} video). Merged into this site's backlog; your daily pipeline pulls the best first. Generate any now below.`, plan, items: await getSiteBacklog(site) };
}

// Opt this site's 30-day plans into (or out of) Instagram carousels. Off by default;
// when on, one eligible image slot per day becomes a swipeable carousel brief. Applies
// to every plan builder (UI, Tess's tool, the API, the daily pipeline). Manual posting.
export async function setCarouselPlan(site: string, enabled: boolean): Promise<{ ok: boolean; message?: string; enabled?: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(site)) return { ok: false, message: "Unknown site." };
  await setCarouselPlanSite(site, enabled);
  await audit({ actorId: user.id, actorName: user.name, action: "content.carousel_toggle", target: site, detail: { enabled } });
  revalidatePath("/content-strategy");
  return {
    ok: true,
    enabled,
    message: enabled
      ? "Instagram carousels are now scheduled into this site's new plans (about one a day)."
      : "Carousels removed from this site's plans. Existing briefs are unchanged.",
  };
}

// Feedback loop: re-read Search Console for this site's past GSC-anchored posts and
// report which ones lifted their ranking (winners are stored so the next plan
// doubles down on them). Safe to run anytime; only meaningful weeks after posting.
export async function checkWhatsWorking(site: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(site)) return { ok: false, message: "Unknown site." };
  const [r] = await runGscFeedback(site);
  await audit({ actorId: user.id, actorName: user.name, action: "content.feedback", target: site, detail: { analyzed: r?.analyzed ?? 0, improved: r?.improved ?? 0 } });
  revalidatePath("/content-strategy");
  if (!r || r.analyzed === 0) return { ok: true, message: "No Search-anchored posts are old enough to measure yet (needs about 3 weeks after posting). Check back later." };
  if (r.improved === 0) return { ok: true, message: `Measured ${r.analyzed} Search-anchored topic(s); none have climbed yet. Rankings take time; keep posting.` };
  const top = r.winners[0];
  return { ok: true, message: `${r.improved} of ${r.analyzed} Search topics climbed. Top: "${top.query}" rose ${top.delta} spot(s) (pos ${top.fromPos}→${top.nowPos}). The next plan will double down on the pages that responded.` };
}

export async function generatePlanItemAction(itemId: string): Promise<GenResult> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const r = await generatePlanItem(itemId, { actor: user.name, requestedBy: user.name, createdBy: user.name });
  revalidatePath("/content-strategy");
  revalidatePath("/social");
  return r;
}

// Wipe the whole backlog for a site — every brief across every plan, plus the
// plan rows — so the owner can start fresh with new niches. Already-generated
// drafts in Social Studio are NOT touched (they live as their own posts).
export async function clearBacklog(site: string): Promise<{ ok: boolean; message?: string; items?: PlanItem[] }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(site)) return { ok: false, message: "Unknown site." };
  const removed = await db.delete(contentPlanItems).where(eq(contentPlanItems.site, site)).returning({ id: contentPlanItems.id });
  await db.delete(contentPlans).where(eq(contentPlans.site, site));
  await audit({ actorId: user.id, actorName: user.name, action: "content.clear_backlog", target: site, detail: { briefs: removed.length } });
  revalidatePath("/content-strategy");
  return { ok: true, message: `Cleared ${removed.length} brief(s) for this site.`, items: [] };
}

// Delete specific briefs the owner selected (scoped to the site for safety).
export async function deleteBacklogItems(site: string, itemIds: string[]): Promise<{ ok: boolean; message?: string; items?: PlanItem[] }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(site)) return { ok: false, message: "Unknown site." };
  const ids = itemIds.filter(Boolean);
  if (!ids.length) return { ok: false, message: "Nothing selected." };
  const removed = await db
    .delete(contentPlanItems)
    .where(and(eq(contentPlanItems.site, site), inArray(contentPlanItems.id, ids)))
    .returning({ id: contentPlanItems.id });
  await audit({ actorId: user.id, actorName: user.name, action: "content.delete_briefs", target: site, detail: { briefs: removed.length } });
  revalidatePath("/content-strategy");
  return { ok: true, message: `Deleted ${removed.length} brief(s).`, items: await getSiteBacklog(site) };
}
