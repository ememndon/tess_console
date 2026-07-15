"use server";

import { requireOperator } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { updateCarousel, buildCarouselZip, regenerateSlideCopy, type CarouselEditResult } from "@/lib/social/carousel";

// Per-slide carousel editor: apply edited slide text / order / count / aspect, with
// an optional shared-backdrop swap. Re-renders every slide (positions drive the
// counter + tip numbers) and refreshes the manual-posting bundle. Draft-only.
export async function updateCarouselAction(input: {
  postId: string;
  defs: { kind: "cover" | "point" | "cta"; title: string; body?: string }[];
  aspect?: "portrait" | "square";
  style?: "bold" | "minimal" | "editorial";
  background?: { mode: "keep" | "stock" | "ai"; prompt?: string };
}): Promise<CarouselEditResult> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!input.postId || !Array.isArray(input.defs) || input.defs.length < 3) {
    return { ok: false, message: "A carousel needs a cover, at least one tip, and a call to action." };
  }
  const r = await updateCarousel(input.postId, { defs: input.defs, aspect: input.aspect, style: input.style, background: input.background });
  if (r.ok) revalidatePath("/social");
  return r;
}

// Ask the model to rewrite ONE slide's copy (the rest of the set is left alone).
// `defs` carries the editor's current, possibly-unsaved slides so nothing is lost.
export async function regenerateSlideAction(
  postId: string,
  index: number,
  defs?: { kind: "cover" | "point" | "cta"; title: string; body?: string }[],
): Promise<CarouselEditResult> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const r = await regenerateSlideCopy(postId, index, defs);
  if (r.ok) revalidatePath("/social");
  return r;
}

// Bundle all slides (in order) + caption.txt into a ZIP and return its download URL.
export async function downloadCarouselZipAction(postId: string): Promise<{ ok: boolean; url?: string; filename?: string; message?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  return buildCarouselZip(postId);
}
