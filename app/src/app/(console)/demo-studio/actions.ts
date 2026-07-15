"use server";

import { promises as fs } from "fs";
import path from "path";
import { eq, inArray, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { mediaJobs, socialPosts, socialMedia } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { MEDIA_ROOT } from "@/lib/banner";
import { enqueueDemoJob } from "@/lib/demo/enqueue";
import { enqueueUrlDemo, checkUrlReachable } from "@/lib/demo/tour";

// Lightweight reachability check for the "from any URL" box — runs before any
// generation so a wrong URL never costs script/voice tokens or a failed render.
export async function checkDemoUrlAction(url: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const r = await checkUrlReachable(url);
  return { ok: r.ok, message: r.message };
}

// Demo Studio manual triggers — let the owner exercise the full pipeline (script →
// queue → worker → draft) without unpausing Tess. Output is a Social Studio draft.

export async function createDemoAction(
  recipeId: string,
  music?: string,
  voice?: string,
  notes?: string,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  try {
    const { feature, guard } = await enqueueDemoJob({
      recipeId,
      requestedBy: user.name,
      createdBy: user.name,
      actor: user.name,
      music,
      voice,
      notes,
    });
    revalidatePath("/demo-studio");
    const warn = guard.ok ? "" : ` (heads up — the script referenced numbers not in the source: ${guard.offending.join(", ")})`;
    return { ok: true, message: `Rendering "${feature}" — it'll appear below and as a draft in Social Studio when done.${warn}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not queue the demo." };
  }
}

export async function createUrlDemoAction(
  url: string,
  site: string,
  music?: string,
  voice?: string,
  notes?: string,
): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!url.trim()) return { ok: false, message: "Paste a URL first." };
  // Hard guard: verify the page is reachable before spending any tokens.
  const reach = await checkUrlReachable(url);
  if (!reach.ok) return { ok: false, message: reach.message };
  try {
    const { feature } = await enqueueUrlDemo({
      url,
      site,
      requestedBy: user.name,
      createdBy: user.name,
      actor: user.name,
      music,
      voice,
      notes,
    });
    revalidatePath("/demo-studio");
    return { ok: true, message: `Tess is visiting "${feature}" and building a demo — it'll appear below when done.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not queue the URL demo." };
  }
}

// Remove the file only if it resolves inside MEDIA_ROOT (defense against a bad path).
async function safeUnlink(relOrAbs: string) {
  const abs = path.resolve(MEDIA_ROOT, relOrAbs);
  if (abs !== MEDIA_ROOT && !abs.startsWith(MEDIA_ROOT + path.sep)) return;
  await fs.unlink(abs).catch(() => {});
}

// Delete a render: its media files, the Social Studio draft it produced (cascades
// social_media + social_targets), and the media_jobs row.
export async function deleteRenderAction(jobId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [job] = await db.select().from(mediaJobs).where(eq(mediaJobs.id, jobId));
  if (!job) return { ok: false, message: "Render not found." };
  if (job.status === "running") return { ok: false, message: "This render is still in progress — wait for it to finish or fail." };

  if (job.postId) {
    const media = await db.select().from(socialMedia).where(eq(socialMedia.postId, job.postId));
    for (const m of media) await safeUnlink(m.path);
    // Cascade removes social_media + social_targets for this draft.
    await db.delete(socialPosts).where(inArray(socialPosts.id, [job.postId]));
  }
  await db.delete(mediaJobs).where(eq(mediaJobs.id, jobId));
  await audit({ actorId: user.id, actorName: user.name, action: "demo.delete_render", target: jobId, detail: { feature: job.feature } });
  revalidatePath("/demo-studio");
  return { ok: true, message: "Render deleted." };
}

// Cheap status poll for the live-render indicator. Returns only id+status for the
// recent jobs — NOT the full page (media joins, fs reads, RSC payload). The client
// uses this to decide whether anything actually CHANGED before doing a full
// router.refresh(), so an in-flight render no longer triggers a heavy whole-page
// reload every 5 seconds.
export async function demoJobStates(): Promise<{ id: string; status: string }[]> {
  if (!(await requireOperator())) return [];
  const rows = await db
    .select({ id: mediaJobs.id, status: mediaJobs.status })
    .from(mediaJobs)
    .orderBy(desc(mediaJobs.createdAt))
    .limit(20);
  return rows.map((r) => ({ id: r.id, status: r.status }));
}
