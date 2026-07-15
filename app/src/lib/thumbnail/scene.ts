import "server-only";
import sharp from "sharp";
import { generateAiImageBytes } from "@/lib/image-gen";
import { IMAGE_NO_TEXT } from "@/lib/design";

// Generates the COMPLETE thumbnail visual with FLUX: the right person showing the
// right emotional reaction AND the background/scene/lighting, composed as one
// coherent 16:9 image with clear space for text — and absolutely no text baked in
// (the render service adds the type). This replaces the cut-out approach: the
// scene is generated whole, so there are no cut-out edges to go wrong.

const SCENE_STYLE =
  "Ultra high quality professional YouTube thumbnail photograph, shot on a 35mm lens, editorial studio " +
  "quality, HDR, razor sharp, 8k detail. The HERO is ONE real, attractive, relatable person positioned at the " +
  "EXTREME left OR right EDGE of the frame, occupying only the outer 35 to 45 percent of that side — their head " +
  "and shoulders large but shoved hard against the very edge, the face sitting in the outer third (a shoulder " +
  "may run off the edge) — while the ENTIRE other ~60 percent of the frame is clean empty negative space for " +
  "text. NEVER centred, never a centred head-on portrait. The face looks straight down the lens with intense " +
  "direct eye contact and bright catch-lights in the eyes. The expression is AGGRESSIVELY exaggerated and " +
  "over-the-top — a scrunched confused squint, a jaw-dropped open-mouthed shock, wide-eyed alarm, or an intense " +
  "dead-serious glare, sometimes with a hand thrown up near the face — dialled far past a normal calm face, " +
  "the way the biggest viral thumbnails do. CINEMATIC LIGHTING: a warm key light on the face, a cooler fill, " +
  "and a strong rim/back light that cleanly separates the subject from the background; dramatic but flattering " +
  "shadows, a vivid saturated orange and teal colour grade, punchy micro-contrast and crisp, detailed skin. " +
  "SHALLOW depth of field so the background falls into soft creamy bokeh and the face pops hard off the screen. " +
  "The face must be large, sharp and completely unobstructed. Photorealistic only, not an illustration, not 3D, " +
  "not a cartoon, no borders, no frames, no split screen, no collage, no grid. " +
  IMAGE_NO_TEXT;

// Returns the scene as a 1280x720 JPEG buffer, or null on failure. `composition`
// is a layout-specific clause that pins WHERE the person sits and which side stays
// clean for text, so the text and the face never collide.
export async function getScene(prompt: string, composition?: string): Promise<Buffer | null> {
  const p = prompt?.trim();
  if (!p) return null;
  const fullPrompt = composition ? `${p}\n\n${composition}` : p;
  const ai = await generateAiImageBytes(fullPrompt, SCENE_STYLE, { size: "1280x720" }).catch(() => null);
  if (!ai) return null;
  // Normalize to exactly 1280x720. Use a centre cover (NOT "attention"): the prompt
  // deliberately puts the subject off to one side, and an attention crop would shift
  // the framing and undo that composition.
  return sharp(ai.data).resize(1280, 720, { fit: "cover", position: "centre" }).jpeg({ quality: 92 }).toBuffer().catch(() => null);
}
