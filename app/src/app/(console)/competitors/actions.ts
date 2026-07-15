"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sites, competitorPages } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SITE_KEYS } from "@/lib/site-scope";

function normalizeHost(raw: string): string | null {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "").replace(/^www\./, "");
  h = h.split("/")[0].split("?")[0].split("#")[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
  return h;
}

export async function addCompetitor(site: string, raw: string): Promise<{ error?: string }> {
  const user = await requireOperator();
  if (!user) return { error: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(site)) return { error: "Unknown site." };
  const host = normalizeHost(raw);
  if (!host) return { error: "Enter a valid domain, e.g. example.com" };

  const [row] = await db.select({ c: sites.competitors }).from(sites).where(eq(sites.key, site));
  const list = ((row?.c as string[]) ?? []).slice();
  if (list.includes(host)) return { error: "Already tracking that competitor." };
  list.push(host);
  await db.update(sites).set({ competitors: list }).where(eq(sites.key, site));
  await audit({ actorId: user.id, actorName: user.name, action: "competitor.add", target: site, detail: { host } });
  revalidatePath("/competitors");
  return {};
}

export async function removeCompetitor(site: string, host: string) {
  const user = await requireOperator();
  if (!user) return;
  const [row] = await db.select({ c: sites.competitors }).from(sites).where(eq(sites.key, site));
  const list = ((row?.c as string[]) ?? []).filter((h) => h !== host);
  await db.update(sites).set({ competitors: list }).where(eq(sites.key, site));
  await db.delete(competitorPages).where(and(eq(competitorPages.site, site), eq(competitorPages.competitor, host)));
  await audit({ actorId: user.id, actorName: user.name, action: "competitor.remove", target: site, detail: { host } });
  revalidatePath("/competitors");
}
