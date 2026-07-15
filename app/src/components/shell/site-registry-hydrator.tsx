"use client";

import { registerSites } from "@/lib/site-scope";
import type { SiteInfo } from "@/lib/site-scope.server";

// Seeds the client-side site registry from the DB list the server already used to
// render. Placed as the FIRST node in the console layout so it runs before any
// sibling that reads SITE_META/SITE_KEYS: React renders children top-down, so this
// component's body executes (and mutates the registry) before the header/sidebar/
// page render in the same pass. Seeding on every render — not just mount — means a
// site added via Settings + router.refresh() shows up immediately (the props change
// on refresh), with no hydration mismatch since the server rendered with the same
// list. registerSites is idempotent. Renders nothing.
export function SiteRegistryHydrator({ sites }: { sites: SiteInfo[] }) {
  registerSites(sites);
  return null;
}
