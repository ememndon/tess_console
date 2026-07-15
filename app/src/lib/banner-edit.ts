import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { socialPosts, socialMedia } from "./db/schema";
import { renderBanner, MEDIA_ROOT, type BannerTextStyle } from "./banner";
import { fetchStockPhoto, stockQueryFor } from "./stock-media";
import { generateAiBackgroundBytes } from "./image-gen";

// How the caller wants the picture BEHIND the text handled on a re-render.
//   keep  → reuse the saved backdrop (default; the original behavior)
//   stock → fetch a NEW stock photo (optional explicit search query)
//   ai    → generate a NEW text-free AI backdrop (optional explicit scene prompt)
export type BackgroundChoice =
  | { mode: "keep" }
  | { mode: "stock"; query?: string }
  | { mode: "ai"; scene?: string };

// Re-render an image post's BANNER with a new headline and/or subhead (the text
// baked into the picture — distinct from the social caption). Supports an explicit
// line break in the headline via "\n". By DEFAULT it keeps the saved backdrop
// (the exact design); pass `background` to swap in a fresh stock photo or a new AI
// backdrop. Used by the post-detail editor and Tess's edit_post_image tool.
export async function editBannerText(
  ref: string,
  opts: { headline?: string; subhead?: string; style?: BannerTextStyle; background?: BackgroundChoice },
): Promise<{ ok: boolean; message: string; headline?: string; subhead?: string }> {
  const clean = ref.replace(/[^0-9]/g, "");
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.ref, clean)).limit(1);
  if (!post) return { ok: false, message: `No post #${clean}.` };
  if (post.kind !== "banner") return { ok: false, message: `Post #${clean} is not an image post, so it has no banner header to edit.` };
  if (["published", "done"].includes(post.status)) return { ok: false, message: `Post #${clean} is already published — its image can't be changed.` };

  const data = (post.data as Record<string, unknown>) ?? {};
  const headline = (opts.headline ?? (data.headline as string) ?? "").toString().trim();
  const subhead = (opts.subhead ?? (data.subhead as string) ?? "").toString().trim();
  if (!headline) return { ok: false, message: "Headline can't be empty." };

  const bgMode = opts.background?.mode ?? "keep";
  const srcBase = path.join(MEDIA_ROOT, "banners", post.site, `${post.id}.src`);
  let bg: Buffer | undefined;
  let credit = (data.imageCredit as string) ?? "";
  let swapped = false; // a new backdrop was sourced this call → persist it after rendering
  let newStyle: string | undefined; // 'stock' | 'ai' when swapped

  if (bgMode === "stock") {
    // Re-roll the photo: an explicit query if given, else the auto query from the
    // post's topic/headline. A miss leaves the existing banner untouched.
    const q = (opts.background as { query?: string }).query?.trim() || stockQueryFor(post.site, (data.subtopic as string) || headline);
    const s = await fetchStockPhoto(q).catch(() => null);
    if (!s) return { ok: false, message: "Couldn't find a stock photo (no Pexels/Pixabay key set, or nothing matched) — kept the existing background." };
    bg = s.data; credit = s.credit; swapped = true; newStyle = "stock";
  } else if (bgMode === "ai") {
    // Generate a fresh, text-free AI backdrop (the headline is composited on top).
    const scene = (opts.background as { scene?: string }).scene?.trim()
      || `A premium, editorial brand backdrop evoking the theme of "${(data.subtopic as string) || headline}". A real photographic or richly illustrated scene with one clear focal point and calm negative space on the left for a headline overlay. No text, no words, no letters in the image.`;
    let aiBytes: Buffer;
    try { ({ data: aiBytes } = await generateAiBackgroundBytes(scene)); }
    catch (e) { return { ok: false, message: `Couldn't generate an AI background (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}) — kept the existing background.` }; }
    bg = aiBytes; credit = ""; swapped = true; newStyle = "ai";
  } else {
    // keep: reuse the saved backdrop (exact design); fall back to a fresh stock
    // photo only when none was saved and it wasn't a plain banner; else plain banner.
    let hadSaved = false;
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      try { bg = await fs.readFile(`${srcBase}.${ext}`); hadSaved = true; break; } catch { /* not saved */ }
    }
    if (!bg && data.imageStyle !== "banner") {
      const s = await fetchStockPhoto(stockQueryFor(post.site, (data.subtopic as string) || headline)).catch(() => null);
      if (s) { bg = s.data; credit = s.credit; }
    }
    // Persist the backdrop the first time so EVERY later header edit re-composites
    // over the SAME image — no more surprise photo swaps on re-edit.
    if (bg && !hadSaved) { try { await fs.writeFile(`${srcBase}.png`, bg); } catch { /* best effort */ } }
  }

  // Merge any new style overrides onto the saved ones so each edit is cumulative
  // (change the colour now, the size later — both stick).
  const bannerStyle: BannerTextStyle = { ...((data.bannerStyle as BannerTextStyle) ?? {}), ...(opts.style ?? {}) };
  const r = await renderBanner(post.id, { site: post.site, title: headline, subtitle: subhead || undefined, bgImage: bg, style: bannerStyle });

  // On a SWAP, the new backdrop becomes the canonical source — but only AFTER a
  // successful render, so a render failure leaves BOTH the visible <id>.png and the
  // cached <id>.src on the OLD image (no drift). Clear stale sibling extensions so a
  // later "keep" edit can't read an older .jpg/.webp ahead of the new .png.
  if (swapped && bg) {
    for (const ext of ["jpg", "jpeg", "webp"]) { try { await fs.unlink(`${srcBase}.${ext}`); } catch { /* none */ } }
    await fs.writeFile(`${srcBase}.png`, bg);
  }

  // renderBanner overwrites <id>.png in place; refresh the media row's dimensions.
  await db.delete(socialMedia).where(eq(socialMedia.postId, post.id));
  await db.insert(socialMedia).values({ postId: post.id, type: "image", path: r.path, width: r.width, height: r.height });
  await db.update(socialPosts).set({
    data: {
      ...data, headline, subhead, bannerStyle,
      ...(swapped ? { imageStyle: newStyle } : {}),
      ...(swapped && newStyle === "ai" ? { imageCredit: "" } : credit ? { imageCredit: credit } : {}),
    },
  }).where(eq(socialPosts.id, post.id));
  const swapMsg = swapped ? ` Gave it a new ${newStyle === "ai" ? "AI" : "stock"} background.` : "";
  return { ok: true, message: `Updated the image header for #${clean}.${swapMsg}`, headline, subhead };
}
