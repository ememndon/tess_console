import "server-only";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import { MEDIA_ROOT } from "@/lib/banner";
import { getScene } from "@/lib/thumbnail/scene";
import { generateAiImageBytes } from "@/lib/image-gen";
import { brandDesignFor } from "@/lib/design";
import { enhanceFace, detectFaces, faceRestoreEnabled, type FaceBox } from "@/lib/thumbnail/face-restore";
import type { ThumbLayout, ThumbPlan, ThumbLayers } from "@/lib/youtube/types";

const W = 1280, H = 720;
const MATTE_URL = process.env.MATTE_URL ?? "http://matte:7300";

// Thumbnail render orchestrator (v3). FLUX renders the full 16:9 scene (person +
// reaction + background); the Fabric.js render service (tess-thumb, on the compose
// network) composes the sharp/bright text + graphic accents over it. The app never
// runs node-canvas itself — the native graphics stack stays isolated.

const THUMB_URL = process.env.THUMB_URL ?? "http://thumb:7100";
const INTERNAL_KEY = process.env.INTERNAL_SYNC_KEY ?? "";

// Bold, varied palettes (text / accent word / solid bar colour). One per concept
// so the three thumbnails never look the same.
const PALETTES = [
  { text: "#FFFFFF", accent: "#FFC83D", band: "#E63946" }, // gold + red bar
  { text: "#FFFFFF", accent: "#FFD23F", band: "#111827" }, // yellow + dark bar
  { text: "#FFFFFF", accent: "#36E0C0", band: "#0B3D91" }, // teal + blue bar
  { text: "#FFFFFF", accent: "#FF5CA8", band: "#1A1030" }, // pink + dark bar
  { text: "#FFFFFF", accent: "#A8FF3E", band: "#0B7A4B" }, // lime + green bar
];

export type ThumbSpec = {
  id: string;
  site: string;
  layout: ThumbLayout;
  headline: string;
  scenePrompt: string;
  paletteIndex?: number;
  plan?: ThumbPlan; // composition brain's decisions (expression, gesture, emphasis, accent, graphic, outline)
  restore?: boolean; // override face-restoration for this render (default: follow env)
  bgThemeIndex?: number; // which BG_THEMES design to use (cut-out engine) — for variety
  direction?: string; // free-text editor steer for a regenerate ("make her furious", "money background")
};

// Varied title-emphasis styles, one per concept, so the three thumbnails don't all
// look the same: a key word in the accent colour / in a filled box / a coloured line.
const TEXT_STYLES = ["pop", "box", "punch"] as const;

// The facial reaction MUST match the headline's tone — a warning like "YOUR CV IS
// WRONG" needs a serious/alarmed face, not a smile. Derived deterministically from
// the headline so it doesn't depend on the model choosing the right mood.
function expressionFor(headline: string): string {
  const h = headline.toLowerCase();
  if (/\b(wrong|stop|mistake|mistakes|avoid|never|fail|failing|bad|worst|danger|dangerous|warning|broke|losing|lose|scam|trap|problem|costly|risk|risky|don'?t|quit)\b/.test(h))
    return "an INTENSE, dead-serious, stern expression — hard furrowed brows, tense clenched jaw, drilling the viewer with an alarmed serious glare. This is a hard warning: absolutely NO smile";
  if (/\b(shocking|shocked|insane|crazy|unbelievable|exposed|nobody tells|wtf|secret|truth|revealed)\b/.test(h))
    return "an EXTREME, over-the-top shocked reaction — eyes flung wide open, eyebrows shot up high, mouth dropped wide open in jaw-dropping disbelief, often with a hand flying up toward the face";
  if (/\b(best|free|easy|win|winning|growth|grow|perfect|profit|rich|boom|amazing|hired|success|huge|smart|fast|instant)\b/.test(h))
    return "a HUGE, exaggerated, thrilled reaction — beaming wide-eyed ecstatic excitement dialled all the way up";
  if (/\?$/.test(headline.trim()) || /\b(how|why|what|which|should|can|is|are)\b/.test(h))
    return "a scrunched-up, squinting, visibly CONFUSED and puzzled expression — one eyebrow raised, nose slightly wrinkled, brow furrowed as if struggling to make sense of something";
  return "a bold, intense, exaggerated, attention-grabbing expression dialled well past a normal calm face";
}

// Per-layout composition pinned into the FLUX prompt so the person sits OPPOSITE
// the text and the face is never covered.
const COMPOSITION: Record<ThumbLayout, string> = {
  left:
    "THUMBNAIL COMPOSITION (critical): shove the person to the EXTREME RIGHT EDGE of the frame, occupying only " +
    "the outer ~40 percent of the width — their head and expressive face large but sitting in the far-right " +
    "third (a shoulder may run off the right edge), definitely NOT near the centre. Keep the ENTIRE LEFT ~60 " +
    "percent of the frame completely clean, simple and heavily blurred (soft wall or creamy bokeh): a big empty " +
    "negative-space zone reserved for the headline. Nothing important on the left.",
  right:
    "THUMBNAIL COMPOSITION (critical): shove the person to the EXTREME LEFT EDGE of the frame, occupying only " +
    "the outer ~40 percent of the width — their head and expressive face large but sitting in the far-left " +
    "third (a shoulder may run off the left edge), definitely NOT near the centre. Keep the ENTIRE RIGHT ~60 " +
    "percent of the frame completely clean, simple and heavily blurred (soft wall or creamy bokeh): a big empty " +
    "negative-space zone reserved for the headline. Nothing important on the right.",
  lower:
    "THUMBNAIL COMPOSITION (critical): shove the person to the EXTREME left or right EDGE of the frame (never " +
    "centred), the expressive face large, leaving a big empty negative-space zone on the opposite side for the headline.",
};

// Pointing is used sparingly — only when the headline actually references something
// (a demonstrative like "this"/"these"/"here", or a "watch/look/see" call). Random
// pointing on every thumbnail looks templated (owner feedback). When used, it points
// SIDEWAYS toward the text, never at the viewer.
function wantsPointing(headline: string): boolean {
  return /\b(this|these|those|that|here|there|look|watch|see|check|read|below|now)\b/i.test(headline);
}

// Decide where the headline goes from REAL face boxes (RetinaFace), so text lands
// in the empty side wherever the subject sits — even off to one edge or partly off
// canvas. Uses the union x-span of all confident faces, then puts text on the side
// with the most clear width; falls back to a bottom band when neither side fits.
// Returns null when there are no usable faces (the thumb service then uses its own
// skin-tone heuristic). EDGE/GAP mirror the thumb service's text margins.
// The design rule now forces the subject HARD to one edge (~60% width), so the
// opposite ~40% is genuinely empty and far from the face — we can accept a slightly
// narrower text column (MINW) than when subjects could sit near-centre.
const EDGE = 64, GAP = 48, MINW = 380, MAXW_CAP = 700;
function placeFromFaces(faces: FaceBox[] | null): { place: ThumbLayout; maxW: number } | null {
  if (!faces || !faces.length) return null;
  const good = faces.filter((f) => (f[4] ?? 1) >= 0.5 && f[2] - f[0] >= 40);
  if (!good.length) return null;
  const x1 = Math.max(0, Math.min(...good.map((f) => f[0])));
  const x2 = Math.min(W, Math.max(...good.map((f) => f[2])));
  const leftFree = x1 - GAP - EDGE; // usable text width if text sits on the left
  const rightFree = W - EDGE - (x2 + GAP);
  if (leftFree >= MINW && leftFree >= rightFree) return { place: "left", maxW: Math.min(MAXW_CAP, Math.floor(leftFree)) };
  if (rightFree >= MINW) return { place: "right", maxW: Math.min(MAXW_CAP, Math.floor(rightFree)) };
  return { place: "lower", maxW: 1060 };
}

// Horizontal centre (0..1) of the largest detected face — used to tell whether the
// subject is centred (design-rule violation) or pushed to an edge.
function faceCentroidX(faces: FaceBox[] | null): number | null {
  if (!faces || !faces.length) return null;
  const f = faces.reduce((a, b) => (a[2] - a[0] >= b[2] - b[0] ? a : b));
  return (f[0] + f[2]) / 2 / W;
}

// Fallback backdrop if FLUX is unavailable, so a thumbnail still renders.
async function fallbackScene(paletteIndex: number): Promise<Buffer> {
  const pal = PALETTES[paletteIndex % PALETTES.length];
  const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.band}"/><stop offset="1" stop-color="#000000"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

export async function renderThumbnail(spec: ThumbSpec): Promise<{ path: string; relPath: string; width: number; height: number; bytes: number; sceneSource: "ai" | "fallback"; editBase?: string; layers?: ThumbLayers }> {
  const paletteIndex = spec.paletteIndex ?? 0;
  const pal = PALETTES[paletteIndex % PALETTES.length];

  const dir = path.join(MEDIA_ROOT, "thumbnails", spec.site);
  await fs.mkdir(dir, { recursive: true });

  const plan = spec.plan ?? {};
  // Prefer the planner's deliberate reaction; fall back to the deterministic
  // headline-tone classifier so the face still matches even if the model omits it.
  const expression = plan.expression?.trim() || expressionFor(spec.headline);
  const textSide = spec.layout === "left" ? "LEFT" : spec.layout === "right" ? "RIGHT" : "empty";
  // Pointing ONLY when the headline calls for it, and then SIDEWAYS toward the text
  // (never at the viewer). Otherwise the pose is expression-driven, no finger.
  const gesture =
    plan.gesture?.trim() ||
    (wantsPointing(spec.headline)
      ? `the person raises a hand with the ELBOW BENT and the forearm angled ACROSS the body, index finger pointing LATERALLY (sideways) toward the ${textSide} side of the frame where the headline sits. The arm is clearly bent at the elbow and the finger points to the side across the frame — it must NOT be a straight arm pointing forward at the camera or at the viewer`
      : "");
  const poseLine = gesture
    ? `POSE / GESTURE: ${gesture}.`
    : "POSE: a bold pose that suits the emotion (e.g. a hand thrown up near the face for shock); do NOT point a finger.";
  const extras = [
    `FACIAL EXPRESSION (must match the message "${spec.headline}"): ${expression}. Push the emotion ALL the way up — exaggerated, intense and aggressive, the way top viral thumbnails do; never a calm neutral face.`,
    poseLine,
    plan.eyeDirection?.trim() ? `EYES: ${plan.eyeDirection.trim()}.` : "EYES: looking straight into the camera.",
  ].filter(Boolean).join("\n");
  const subjectSide = spec.layout === "left" ? "RIGHT" : spec.layout === "right" ? "LEFT" : "one";
  const buildDirective = (attempt: number) =>
    (attempt > 0
      ? `HARD REQUIREMENT — the previous attempt kept the subject too central, which is NOT allowed: shove the person to the EXTREME ${subjectSide} edge, occupying only the outer ~40 percent of the frame, and leave the ${textSide} ~60 percent as empty blurred wall. `
      : "") + `${COMPOSITION[spec.layout]}\n\n${extras}`;

  // Design rule: the subject hugs an edge, never the centre. FLUX often centres a
  // big face regardless, so we regenerate the SCENE until the detected face leaves a
  // clean side for text (placeFromFaces returns a side, not the bottom band).
  // Detection-only per try (cheap); the winner is restored + placed afterwards.
  const EDGE_TRIES = 4;
  // Face centre must be >=0.16 from the middle (outside 0.34..0.66) → a reliable,
  // strong off-centre placement. (Pushed to 0.20 it too often exhausted the tries
  // and fell back to a near-centred best-of-4 — 0.16 is the dependable sweet spot.)
  const EDGE_MIN_OFF = 0.16;
  const scenePath = path.join(dir, `_scene-${spec.id}.jpg`);
  let sceneBuf: Buffer | null = null;
  let loopFaces: FaceBox[] | null = null;
  let best: { buf: Buffer; faces: FaceBox[] | null; off: number } | null = null;
  for (let attempt = 0; attempt < EDGE_TRIES; attempt++) {
    const s = await getScene(spec.scenePrompt, buildDirective(attempt));
    if (!s) break;
    await fs.writeFile(scenePath, s);
    const f = await detectFaces(scenePath);
    if (!f || !f.length) { sceneBuf = s; loopFaces = f; break; } // no face / no detector → can't enforce
    const c = faceCentroidX(f);
    const off = c == null ? 0 : Math.abs(c - 0.5);
    if (off >= EDGE_MIN_OFF) { sceneBuf = s; loopFaces = f; break; } // subject sits well to one edge → accept
    if (!best || off > best.off) best = { buf: s, faces: f, off }; // keep the most off-centre so far
  }
  if (!sceneBuf && best) { sceneBuf = best.buf; loopFaces = best.faces; await fs.writeFile(scenePath, best.buf); }
  const sceneSource: "ai" | "fallback" = sceneBuf ? "ai" : "fallback";
  if (!sceneBuf) { sceneBuf = await fallbackScene(paletteIndex); await fs.writeFile(scenePath, sceneBuf); }

  // Restore the accepted scene in place (if enabled) and use its fresh boxes for
  // placement; otherwise reuse the loop's detection boxes.
  let faces: FaceBox[] | null = loopFaces;
  if (sceneSource === "ai" && faceRestoreEnabled() && spec.restore !== false) {
    const rb = await enhanceFace(scenePath);
    if (rb) faces = rb;
  }
  const placement = placeFromFaces(faces);

  const outPath = path.join(dir, `${spec.id}.jpg`);
  const basePath = path.join(dir, `${spec.id}-base.jpg`); // clean no-text backdrop for the editor
  const body = {
    scenePath,
    outPath,
    basePath,
    spec: {
      layout: spec.layout,
      headline: spec.headline,
      style: TEXT_STYLES[paletteIndex % TEXT_STYLES.length],
      palette: { text: pal.text, accent: pal.accent, band: pal.band },
      // Real-face placement (preferred). When present, the service uses these and
      // skips its own heuristic so text never lands on the face.
      place: placement?.place,
      maxW: placement?.maxW,
      // Planner-driven render decisions (Phase 2/3). All optional; the service has
      // safe defaults for anything omitted.
      emphasisWord: plan.emphasisWord,
      accentColor: plan.accentColor,
      outline: !!plan.outline,
      graphic: plan.graphic && plan.graphic.kind !== "none" ? plan.graphic : undefined,
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${THUMB_URL}/compose`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`thumb service ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { ok?: boolean; bytes?: number; error?: string; layers?: ThumbLayers };
    if (!j.ok) throw new Error(j.error || "compose failed");
    await fs.unlink(scenePath).catch(() => {});
    return { path: outPath, relPath: path.relative(MEDIA_ROOT, outPath), width: 1280, height: 720, bytes: j.bytes ?? 0, sceneSource, editBase: path.relative(MEDIA_ROOT, basePath), layers: j.layers };
  } finally {
    clearTimeout(timer);
  }
}

// ── Cut-out composite engine (production) ─────────────────────────────────────
// The adopted thumbnail style: a big FACE cut-out pinned to one edge over an
// EXCITING, varied, photographic background, with the headline on the clean side.
// Deterministic edge placement (no FLUX-framing gamble), no pointing (the face
// carries it), and a rotating set of background designs so packs don't look samey.
const BG_THEMES = [
  "an explosive burst of flying cash, banknotes and gold coins with warm gold and orange radial light rays and sparks",
  "an electric neon tech grid with glowing blue and magenta light streaks, digital particles and cyber energy",
  "a vibrant abstract colour explosion, bold splashes of magenta, cyan and yellow paint, dynamic high-energy motion",
  "a dramatic stage with volumetric spotlight rays, drifting confetti and glowing bokeh, showbiz energy",
  "bold pop-art geometric shapes and chevrons, high-contrast colour blocks and halftone dots, comic-book energy",
  "a fiery energy explosion with glowing embers, sparks and heat haze, intense orange and red",
  "a futuristic finance dashboard with rising green graphs, arrows and glowing data lines, success energy",
  "colourful festive party lights with glittering gold and rainbow particles and vibrant celebration glow",
];

async function genImg(prompt: string, style: string, size: string): Promise<Buffer | null> {
  const ai = await generateAiImageBytes(prompt, style, { size }).catch(() => null);
  return ai ? ai.data : null;
}

async function matteSvc(inPath: string, outPath: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(`${MATTE_URL}/matte`, { method: "POST", headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY }, body: JSON.stringify({ inPath, outPath }), signal: ctrl.signal });
    const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
    return !!(r.ok && j?.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function renderCutoutThumbnail(spec: ThumbSpec): Promise<{ path: string; relPath: string; width: number; height: number; bytes: number; sceneSource: "ai" | "fallback"; editBase?: string; layers?: ThumbLayers }> {
  const paletteIndex = spec.paletteIndex ?? 0;
  const brand = brandDesignFor(spec.site);
  const dir = path.join(MEDIA_ROOT, "thumbnails", spec.site);
  await fs.mkdir(dir, { recursive: true });

  const plan = spec.plan ?? {};
  const expression = plan.expression?.trim() || expressionFor(spec.headline);
  // layout "left" = text on the left → the subject goes to the RIGHT edge (opposite).
  const subjectSide = spec.layout === "left" ? "right" : "left";
  const person = spec.scenePrompt?.trim() || "a relatable person who fits the topic";
  // Free-text steer from the "Regenerate" box — highest priority for the subject, and
  // fed (scoped) to the background too in case it concerns the scene/colours.
  const direction = spec.direction?.trim();

  // 1) Subject = a big FACE headshot on a PLAIN backdrop (clean matte), no pointing.
  const subjectPrompt =
    `An extreme close-up YouTube-thumbnail headshot of the MAIN PERSON from this idea: ${person}. Show ${expression}, dialled all the way up like a viral thumbnail. ` +
    (direction ? `EDITOR'S DIRECTION — highest priority, follow this for the person, their look, wardrobe, age, expression and mood: ${direction}. ` : "") +
    `The whole head and face are large and clearly visible with a little space ABOVE the hair (never crop the top of the head), head and shoulders framing, looking straight down the lens with intense eye contact. ` +
    `IGNORE any setting in the idea — the person is on a PLAIN smooth solid light grey seamless studio backdrop, bright even soft studio lighting, razor sharp. A single flat uncluttered background colour for a clean cut-out. No text, no props, no logos.`;
  const subjBuf = await genImg(subjectPrompt, "photorealistic, professional headshot, high detail", "1024x1024");
  if (!subjBuf) throw new Error("subject generation failed");
  const subjPath = path.join(dir, `_subj-${spec.id}.png`);
  await fs.writeFile(subjPath, subjBuf);
  if (faceRestoreEnabled() && spec.restore !== false) await enhanceFace(subjPath).catch(() => null);

  // 2) Matte → transparent cut-out.
  const cutoutPath = path.join(dir, `_cut-${spec.id}.png`);
  if (!(await matteSvc(subjPath, cutoutPath))) throw new Error("matte failed");

  // 3) Exciting, VARIED background.
  const theme = BG_THEMES[(spec.bgThemeIndex ?? paletteIndex) % BG_THEMES.length];
  const bgPrompt = `An explosive HIGH-ENERGY YouTube-thumbnail background: ${theme}. Extremely colourful and highly saturated, dynamic and busy with lots happening. ` +
    (direction ? `Apply this editor direction where it concerns the scene, subject matter or colours (ignore any part about a person): ${direction}. ` : "") +
    `No people, no text, no words, no letters.`;
  const bgBuf = await genImg(bgPrompt, "vibrant, high-energy, colourful, saturated, cinematic", "1280x720");
  let bgPath: string | undefined;
  if (bgBuf) { bgPath = path.join(dir, `_bg-${spec.id}.jpg`); await fs.writeFile(bgPath, bgBuf); }

  // 4) Composite: busy bg + glow + face cut-out (edge, full head) + text.
  const outPath = path.join(dir, `${spec.id}.jpg`);
  const basePath = path.join(dir, `${spec.id}-base.jpg`);
  const body = {
    outPath, basePath, cutoutPath, side: subjectSide,
    headline: spec.headline, subhead: plan.subhead || "",
    bgPath, fill: 1.05,
    palette: { base: brand.base, mid: brand.mid, accent: plan.accentColor || brand.accent },
    emphasisWord: plan.emphasisWord, accentColor: plan.accentColor,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${THUMB_URL}/compose-cutout`, { method: "POST", headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) throw new Error(`thumb cutout ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { ok?: boolean; bytes?: number; error?: string; layers?: ThumbLayers };
    if (!j.ok) throw new Error(j.error || "compose-cutout failed");
    // Intermediates are baked into the base; drop them to keep the media dir clean.
    await Promise.all([fs.unlink(subjPath).catch(() => {}), fs.unlink(cutoutPath).catch(() => {}), bgPath ? fs.unlink(bgPath).catch(() => {}) : Promise.resolve()]);
    return { path: outPath, relPath: path.relative(MEDIA_ROOT, outPath), width: 1280, height: 720, bytes: j.bytes ?? 0, sceneSource: "ai", editBase: path.relative(MEDIA_ROOT, basePath), layers: j.layers };
  } finally {
    clearTimeout(timer);
  }
}
