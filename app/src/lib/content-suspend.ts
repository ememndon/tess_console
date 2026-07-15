import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { settings } from "./db/schema";

// Per-site generation suspend. When a site is suspended, the automatic content
// pipelines (daily image posts + the daily video) skip it until the owner lifts
// the suspension. Manual force=1 runs by the owner still go through. Stored as a
// string[] under settings.generation_suspended.
const KEY = "generation_suspended";

export async function suspendedSites(): Promise<string[]> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  return Array.isArray(row?.value) ? (row!.value as unknown[]).map(String) : [];
}

export async function isGenerationSuspended(site: string): Promise<boolean> {
  return (await suspendedSites()).includes(site);
}

export async function setSiteSuspended(site: string, suspended: boolean): Promise<string[]> {
  const cur = new Set(await suspendedSites());
  if (suspended) cur.add(site); else cur.delete(site);
  const list = [...cur];
  await db.insert(settings).values({ key: KEY, value: list }).onConflictDoUpdate({ target: settings.key, set: { value: list, updatedAt: new Date() } });
  return list;
}
