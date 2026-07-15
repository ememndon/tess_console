import "server-only";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";
import { getSecretValue } from "./secrets";
import { MEDIA_ROOT } from "./banner";
import { IMAGE_ART_DIRECTION, IMAGE_NO_TEXT } from "./design";

// AI image generation via DeepInfra FLUX.1-dev (OpenAI-compatible images endpoint),
// using the existing deepinfra_api_key. Pay-per-use (~$0.009/image at 1024²), reliable,
// watermark-free, commercial-clear. Branded SVG banners remain the default for on-brand
// work and the automatic fallback if this call fails (see daily-plan.ts).
// (Was Google "Nano Banana"/Gemini, dropped after its free image quota 429'd.)
const MODEL = "black-forest-labs/FLUX-1-dev";

export async function generateAiImageBytes(prompt: string, styleOverride?: string, opts?: { size?: string }): Promise<{ data: Buffer; mime: string }> {
  const key = await getSecretValue("deepinfra_api_key");
  if (!key) throw new Error("DeepInfra key not set — add it in Settings → Secrets Vault.");
  // Default: carry the owner's house art direction so post images are bold and on-brand
  // (IMAGE_ART_DIRECTION). Callers can override — e.g. B-roll wants a REALISTIC
  // photographic look that blends with stock footage, not branded graphic art.
  const fullPrompt = `${prompt.trim()}\n\n${styleOverride ?? IMAGE_ART_DIRECTION}`;
  const r = await fetch("https://api.deepinfra.com/v1/openai/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, prompt: fullPrompt, size: opts?.size ?? "1024x1024", n: 1 }),
  });
  if (!r.ok) throw new Error(`DeepInfra image ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = j.data?.[0];
  if (item?.b64_json) {
    const clean = item.b64_json.replace(/^data:image\/\w+;base64,/, "");
    return { data: Buffer.from(clean, "base64"), mime: "image/png" };
  }
  if (item?.url) {
    const img = await fetch(item.url);
    if (!img.ok) throw new Error(`DeepInfra image fetch ${img.status}`);
    return { data: Buffer.from(await img.arrayBuffer()), mime: "image/png" };
  }
  throw new Error("DeepInfra returned no image.");
}

// Text-FREE backdrop for a composited post image. We describe a SCENE (never the
// caption) and forbid all text, because the headline is added afterwards as real
// type by the banner renderer. Returns raw bytes for renderBanner to composite —
// this replaced "feed the whole caption to FLUX", which baked in gibberish words.
export async function generateAiBackgroundBytes(scene: string): Promise<{ data: Buffer; mime: string }> {
  return generateAiImageBytes(scene, `${IMAGE_ART_DIRECTION} ${IMAGE_NO_TEXT}`);
}

// Generate + save an AI image for a post (same return shape as renderBanner so the
// composer can attach it to social_media identically). Normalizes to PNG.
export async function renderAiImage(postId: string, prompt: string): Promise<{ path: string; width: number | null; height: number | null }> {
  const { data } = await generateAiImageBytes(prompt);
  const dir = path.join(MEDIA_ROOT, "social", postId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `ai-${Date.now()}.png`);
  const meta = await sharp(data).metadata().catch(() => ({ width: null, height: null }) as { width: number | null; height: number | null });
  await sharp(data).png().toFile(file);
  return { path: file, width: meta.width ?? null, height: meta.height ?? null };
}
