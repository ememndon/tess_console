import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { socialConfig } from "../db/schema";
import { PLATFORMS, type Platform } from "../social-types";

// The platforms a site has ENABLED in the Channels config. The daily plan
// intersects its routing with this set, so turning a platform off actually stops
// it from being generated (only an explicit enabled=false suppresses a platform;
// a platform with no config row defaults to enabled).
export async function enabledPlatformsFor(site: string): Promise<Set<Platform>> {
  const rows = await db
    .select({ platform: socialConfig.platform, enabled: socialConfig.enabled })
    .from(socialConfig)
    .where(eq(socialConfig.site, site));
  const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.platform as Platform));
  return new Set(PLATFORMS.filter((p) => !disabled.has(p)));
}

// Toggle a platform on/off for a site, or change its mode / posts-per-day.
export async function setSocialChannel(
  site: string,
  platform: Platform,
  patch: { enabled?: boolean; mode?: string; perDay?: number },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.perDay !== undefined) set.perDay = patch.perDay;
  await db
    .insert(socialConfig)
    .values({ site, platform, enabled: patch.enabled ?? true, mode: patch.mode ?? "handoff", perDay: patch.perDay ?? 1 })
    .onConflictDoUpdate({ target: [socialConfig.site, socialConfig.platform], set });
}
