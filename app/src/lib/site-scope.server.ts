import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { sites } from "./db/schema";
import { SITE_KEYS, registerSites, type SiteKey, type SiteScope } from "./site-scope";

export type SiteInfo = { key: string; name: string; domain: string; accent: string };

/**
 * Load the site registry from the DB and merge it into the in-process registry
 * (SITE_KEYS / SITE_META). Cached per request. Call this early in the console
 * layout so every server consumer — and the data handed to the client hydrator —
 * sees freshly-added sites. Falls back to the founding three if the DB is down.
 */
export const loadSiteRegistry = cache(async (): Promise<SiteInfo[]> => {
  try {
    const rows = await db.select().from(sites);
    if (rows.length) {
      const list = rows.map((r) => ({ key: r.key, name: r.name, domain: r.domain, accent: r.accent }));
      registerSites(list);
      return list;
    }
  } catch {
    /* DB unreachable — keep the founding defaults already in the registry. */
  }
  return SITE_KEYS.map((key) => ({ key, name: key, domain: "", accent: "blue" }));
});

/** The global context control: every module re-scopes to this. */
export async function getSiteScope(): Promise<SiteScope> {
  await loadSiteRegistry(); // ensure newly-added keys are valid scopes
  const v = (await cookies()).get("tess_site")?.value;
  return (SITE_KEYS as string[]).includes(v ?? "") ? (v as SiteKey) : "all";
}
