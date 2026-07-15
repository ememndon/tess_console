"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brandProfiles, socialConfig } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { Platform } from "@/lib/social-types";

export async function updateBrandProfile(
  site: string,
  data: { voice: string; audience: string; hashtags: string; ctaUrl: string; notFinancialAdvice: boolean },
): Promise<{ ok: boolean; message: string }> {
  const user = await requireAdmin();
  if (!user) return { ok: false, message: "Not signed in." };
  const hashtags = data.hashtags
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`));
  await db
    .update(brandProfiles)
    .set({
      voice: data.voice.trim() || null,
      audience: data.audience.trim() || null,
      hashtags,
      ctaUrl: data.ctaUrl.trim() || null,
      notFinancialAdvice: data.notFinancialAdvice,
      updatedAt: new Date(),
    })
    .where(eq(brandProfiles.site, site));
  await audit({ actorId: user.id, actorName: user.name, action: "social.brand_update", target: site });
  revalidatePath("/social");
  return { ok: true, message: "Brand profile saved." };
}

export async function setPlatformConfig(
  site: string,
  platform: Platform,
  patch: { enabled?: boolean; mode?: "autonomous" | "handoff"; perDay?: number; times?: string[] },
) {
  const user = await requireAdmin();
  if (!user) return;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.perDay !== undefined) set.perDay = Math.max(0, Math.min(48, patch.perDay));
  if (patch.times !== undefined)
    set.times = patch.times.map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t));
  await db
    .update(socialConfig)
    .set(set)
    .where(and(eq(socialConfig.site, site), eq(socialConfig.platform, platform)));
  await audit({ actorId: user.id, actorName: user.name, action: "social.config", target: `${site}/${platform}`, detail: patch });
  revalidatePath("/social");
}
