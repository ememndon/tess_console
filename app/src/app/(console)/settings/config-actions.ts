"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sites, settings, brandProfiles } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveRouting } from "@/lib/agent/routing";
import type { ModelRouting } from "@/lib/agent/models";
import { ACCENT_NAMES, type AccentName } from "@/lib/site-scope";

async function admin() {
  const user = await getCurrentUser();
  return user && user.role === "admin" ? user : null;
}

function cleanAccent(a?: string | null): AccentName {
  return (ACCENT_NAMES as string[]).includes(a ?? "") ? (a as AccentName) : "blue";
}
function cleanDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function updateSite(input: { key: string; name: string; domain: string; timezone: string; sitemaps: string[]; brief?: string; accent?: string }): Promise<{ ok: boolean; message: string }> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can edit the sites registry." };
  const domain = cleanDomain(input.domain);
  const sitemaps = input.sitemaps.map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const set: Record<string, unknown> = { name: input.name.trim(), domain, timezone: input.timezone.trim() || "UTC", sitemaps };
  if (input.accent !== undefined) set.accent = cleanAccent(input.accent);
  await db.update(sites).set(set).where(eq(sites.key, input.key));
  // The knowledge brief lives on the brand profile (also fed to Tess's system prompt).
  if (input.brief !== undefined) {
    const brief = input.brief.trim().slice(0, 8000) || null;
    await db
      .insert(brandProfiles)
      .values({ site: input.key, brief })
      .onConflictDoUpdate({ target: brandProfiles.site, set: { brief, updatedAt: new Date() } });
  }
  await audit({ actorId: user.id, actorName: user.name, action: "settings.site.update", target: input.key, detail: { domain, sitemaps: sitemaps.length } });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, message: `${input.name} saved.` };
}

// Onboard a brand-new site: creates the registry row + a default brand profile so
// it adopts the same baseline settings as the others, then it flows through the
// whole console (switcher, scoping, dashboards) and Tess's knowledge base.
export async function addSite(input: { name: string; domain: string; accent?: string; timezone?: string; brief?: string }): Promise<{ ok: boolean; message: string; key?: string }> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can add a site." };
  const name = input.name.trim();
  const domain = cleanDomain(input.domain);
  if (!name) return { ok: false, message: "Enter the site name." };
  if (!/^[^\s.]+\.[^\s.]+/.test(domain)) return { ok: false, message: "Enter a valid domain (e.g. example.com)." };

  // Derive a stable url-safe key from the name, kept unique against existing sites.
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || domain.replace(/[^a-z0-9]+/g, "").slice(0, 24);
  if (!base) return { ok: false, message: "Couldn't derive a key from that name." };
  const existing = new Set((await db.select({ key: sites.key }).from(sites)).map((r) => r.key));
  let key = base;
  for (let i = 2; existing.has(key); i++) key = `${base}${i}`;

  await db.insert(sites).values({
    key,
    name,
    domain,
    accent: cleanAccent(input.accent),
    timezone: input.timezone?.trim() || "UTC",
    sitemaps: [],
    competitors: [],
  });
  // Default brand profile (same baseline shape as the founding sites).
  await db
    .insert(brandProfiles)
    .values({ site: key, brief: input.brief?.trim().slice(0, 8000) || null, contentMix: { text: 50, banner: 35, video: 15 } })
    .onConflictDoNothing({ target: brandProfiles.site });

  await audit({ actorId: user.id, actorName: user.name, action: "settings.site.add", target: key, detail: { name, domain } });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, message: `${name} added. Configure its mailbox, analytics and social keys in Settings as needed.`, key };
}

export async function saveBudgets(input: { monthlyCapUsd: number; degradeAtPct: number }): Promise<{ ok: boolean; message: string }> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can change budgets." };
  const value = { monthlyCapUsd: Math.max(0, input.monthlyCapUsd), degradeAtPct: Math.min(100, Math.max(1, input.degradeAtPct)) };
  await db.insert(settings).values({ key: "budgets", value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorId: user.id, actorName: user.name, action: "settings.budgets.update", detail: value });
  revalidatePath("/settings");
  return { ok: true, message: "Budget saved." };
}

export async function saveModelRouting(routing: ModelRouting): Promise<{ ok: boolean; message: string }> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can change model routing." };
  const clean: ModelRouting = {
    mode: routing.mode === "manual" ? "manual" : "auto",
    defaultModel: routing.defaultModel || "opus",
    tasks: Object.fromEntries(Object.entries(routing.tasks ?? {}).filter(([, v]) => v)),
  };
  await saveRouting(clean);
  await audit({ actorId: user.id, actorName: user.name, action: "settings.models.update", detail: { mode: clean.mode } });
  revalidatePath("/settings");
  return { ok: true, message: "Model routing saved." };
}

export async function saveDataRetention(input: { analyticsDays: number }): Promise<{ ok: boolean; message: string }> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can change retention." };
  const days = Math.max(7, Math.min(3650, Math.round(input.analyticsDays)));
  // Stored as a bare number — the analytics rollup reads (value)::text::int.
  await db.insert(settings).values({ key: "analytics_retention_days", value: days }).onConflictDoUpdate({ target: settings.key, set: { value: days, updatedAt: new Date() } });
  await audit({ actorId: user.id, actorName: user.name, action: "settings.retention.update", detail: { analyticsDays: days } });
  revalidatePath("/settings");
  return { ok: true, message: `Analytics retention set to ${days} days.` };
}
