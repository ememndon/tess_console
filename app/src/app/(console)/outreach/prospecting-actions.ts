"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { outreachProspects, outreachContacts } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { findProspects, type ProspectFindResult } from "@/lib/prospecting";
import { SITE_KEYS } from "@/lib/site-scope";

const isSite = (s: string) => (SITE_KEYS as string[]).includes(s);

// Admin clicks "Find prospects" → runs the web search for one site. Never autonomous.
export async function runProspecting(site: string, focus?: string): Promise<ProspectFindResult> {
  const user = await requireOperator();
  if (!user) return { ok: false, found: 0, scanned: 0, message: "Not signed in." };
  if (!isSite(site)) return { ok: false, found: 0, scanned: 0, message: "Pick a site." };
  const r = await findProspects({ site, focus, createdBy: user.name });
  await audit({ actorId: user.id, actorName: user.name, action: "outreach.prospect_search", detail: { site, focus: focus ?? null, found: r.found, scanned: r.scanned } });
  revalidatePath("/outreach");
  return r;
}

// Approve a prospect → create a real, deliberately-added contact (with provenance).
export async function addProspectAsContact(prospectId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [p] = await db.select().from(outreachProspects).where(eq(outreachProspects.id, prospectId)).limit(1);
  if (!p) return { ok: false, message: "Prospect not found." };
  if (!p.email) return { ok: false, message: "No contact email found — open the site and add it manually." };
  try {
    await db.insert(outreachContacts).values({
      site: p.site,
      email: p.email,
      org: p.name ?? p.domain,
      category: p.category,
      source: `tess-prospecting${p.query ? `: ${p.query}` : ""}`,
      notes: p.fitReason ?? null,
      createdBy: user.name,
    });
  } catch {
    await db.update(outreachProspects).set({ status: "added" }).where(eq(outreachProspects.id, prospectId));
    revalidatePath("/outreach");
    return { ok: false, message: "That email is already a contact for this site." };
  }
  await db.update(outreachProspects).set({ status: "added" }).where(eq(outreachProspects.id, prospectId));
  await audit({ actorId: user.id, actorName: user.name, action: "outreach.prospect_add", target: prospectId, detail: { site: p.site, email: p.email } });
  revalidatePath("/outreach");
  return { ok: true, message: `Added ${p.email} to contacts.` };
}

export async function dismissProspect(prospectId: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.update(outreachProspects).set({ status: "dismissed" }).where(eq(outreachProspects.id, prospectId));
  revalidatePath("/outreach");
  return { ok: true };
}
