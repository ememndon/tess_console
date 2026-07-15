"use server";

import { requireOperator } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { generateCarousel, type CarouselResult } from "@/lib/social/carousel";
import { SITE_KEYS } from "@/lib/site-scope";

// Manual "Generate carousel" trigger from Social Studio. Produces a draft
// Instagram carousel (cover + 3-8 points + CTA) handed off for manual posting.
export async function generateCarouselAction(input: { site: string; topic: string; guidance?: string; aspect?: "portrait" | "square"; style?: "bold" | "minimal" | "editorial" }): Promise<CarouselResult> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!(SITE_KEYS as string[]).includes(input.site)) return { ok: false, message: "Unknown brand." };
  const r = await generateCarousel({ site: input.site, topic: input.topic, guidance: input.guidance, aspect: input.aspect, style: input.style, createdBy: user.name, actor: user.name });
  if (r.ok) revalidatePath("/social");
  return r;
}
