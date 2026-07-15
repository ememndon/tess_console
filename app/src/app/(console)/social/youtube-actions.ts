"use server";

import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { CaptionSource } from "@/lib/caption/studio";
import { buildYouTubePack, buildAndPersistPack, loadSavedPack, regenerateThumb, persistThumbEdit, type YouTubePack, type YouTubeThumb, type ThumbConcept } from "@/lib/youtube/pack";
import type { ThumbLayers } from "@/lib/youtube/types";

// Build the full YouTube Pack from a Post ID or a typed description. (Uploads use
// /api/console/caption-upload like Caption Studio; not needed for v1 of the pack.)
export async function runYouTubePack(input: { source: CaptionSource }): Promise<YouTubePack> {
  if (!(await requireOperator())) return { ok: false, titles: [], description: "", hashtags: [], thumbnails: [], clickability: null, error: "Not authorized." };
  if (input.source.kind !== "post" && input.source.kind !== "text") {
    return { ok: false, titles: [], description: "", hashtags: [], thumbnails: [], clickability: null, error: "Use a Post ID or a description." };
  }
  let pack: YouTubePack;
  if (input.source.kind === "post") {
    pack = await buildAndPersistPack(input.source.ref);
    if (pack.ok) revalidatePath("/social");
  } else {
    pack = await buildYouTubePack({ source: input.source });
  }
  await audit({ actorName: "operator", action: "youtube.pack", target: pack.site ?? "", detail: { kind: input.source.kind, ok: pack.ok } });
  return pack;
}

// Load a previously-built pack for a post (auto-built on render, or built earlier),
// so the UI shows it instantly instead of regenerating.
export async function getSavedPack(ref: string): Promise<YouTubePack | null> {
  if (!(await requireOperator())) return null;
  return loadSavedPack(ref);
}

// Re-render a single thumbnail concept with a fresh AI subject / palette.
export async function regenerateThumbAction(input: {
  site: string;
  concept: ThumbConcept;
  paletteIndex?: number;
  direction?: string;
}): Promise<YouTubeThumb> {
  if (!(await requireOperator())) {
    return { index: 0, layout: input.concept.layout, text: input.concept.headline, url: "", relPath: "", sceneSource: "fallback", bytes: 0, concept: input.concept, error: "Not authorized." };
  }
  return regenerateThumb({ site: input.site, concept: input.concept, paletteIndex: input.paletteIndex, direction: (input.direction || "").trim().slice(0, 400) || undefined });
}

// Save an edited thumbnail (from the editor): overwrite the JPG with the exported
// image and, for post-backed packs, persist the editor's layer state so re-opening
// resumes. Returns a cache-busted URL for the UI to refresh.
export async function saveThumbEdit(input: { relPath: string; dataUrl: string; ref?: string; index?: number; state?: ThumbLayers }): Promise<{ ok: boolean; error?: string; url?: string }> {
  if (!(await requireOperator())) return { ok: false, error: "Not authorized." };
  const m = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl || "");
  if (!m) return { ok: false, error: "Invalid image data." };
  const bytes = Buffer.from(m[1], "base64");
  if (!bytes.length || bytes.length > 8_000_000) return { ok: false, error: "Image missing or too large." };
  const r = await persistThumbEdit({ relPath: input.relPath, bytes, ref: input.ref, index: input.index, state: input.state });
  if (!r.ok) return { ok: false, error: r.error ?? "Could not save." };
  await audit({ actorName: "operator", action: "youtube.thumb_edit", target: input.relPath, detail: { ref: input.ref ?? null, index: input.index ?? null } });
  if (input.ref) revalidatePath("/social");
  return { ok: true, url: `/api/media/${input.relPath}?v=${Date.now()}` };
}
