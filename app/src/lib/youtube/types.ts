// Client-safe types + constants for the YouTube Pack. NO server-only imports
// (no sharp/satori/db) so the Caption Studio client can import these without
// dragging the render/LLM pipeline into the browser bundle. The heavy engine
// lives in ./pack (server-only) and re-exports these for server callers.

export const TITLE_MAX = 100; // YouTube hard limit
export const TITLE_IDEAL = 60; // truncation point in search/suggested
export const DESC_MAX = 5000; // YouTube hard limit

// Text placement over the AI scene. Each keeps the text OPPOSITE the subject so it
// never covers the face: left = subject right / text left; right = subject left /
// text right; lower = subject top / text along the bottom.
export type ThumbLayout = "left" | "right" | "lower";

// A supporting graphic accent the planner can call for, ONLY when the headline's
// story/tension actually needs it (a "wrong way" → red X, a "right way" → green
// check, draw the eye → circle/arrow). "none" = a clean type-only thumbnail.
export type ThumbGraphicKind = "none" | "redX" | "greenCheck" | "circle" | "arrow";
export type ThumbGraphic = { kind: ThumbGraphicKind };

// The composition "plan" — the deliberate CTR decisions the model makes BEFORE we
// render, which then drive both the FLUX scene prompt and the text/graphics render.
// Every field is optional: deterministic fallbacks fill anything the model omits.
export type ThumbPlan = {
  emphasisWord?: string; // which word in the headline to enlarge + colour
  expression?: string; // facial reaction, matched to the headline's tone
  gesture?: string; // pose / hand gesture / what they hold
  eyeDirection?: string; // usually "straight into the camera"
  accentColor?: string; // hex accent colour (else the per-concept palette default)
  emotion?: string; // the CTA emotion: curiosity | shock | excitement | concern
  graphic?: ThumbGraphic; // supporting graphic accent, or { kind: "none" }
  outline?: boolean; // true only when a contrast outline complements this design
  subhead?: string; // optional short support line under the headline (2-5 words)
};

export type ThumbConcept = {
  layout: ThumbLayout;
  headline: string; // the ONLY on-thumbnail text: a complete, grammatical, punchy phrase
  scenePrompt: string; // rich FLUX prompt: person + reaction + background + composition
  plan?: ThumbPlan; // the composition brain's deliberate CTR decisions
};

// A vision model's read on how well a finished thumbnail will earn the click.
export type ThumbScore = {
  score: number; // 0-100 overall
  axes?: Record<string, number>; // per-criterion sub-scores
  critique?: string; // one-line "why / what to fix"
};

// ── Editable layers (for the thumbnail editor) ────────────────────────────────
// The render service emits these so the editor can reconstruct the exact text +
// accent objects over a clean no-text background. Coordinates are in 1280x720 px.
export type ThumbTextLayer = {
  type: "text";
  text: string;
  left: number; // top-left x
  top: number; // top-left y
  fontSize: number;
  fill: string; // text colour
  stroke?: boolean; // contrast outline on/off
  strokeColor?: string; // outline colour (default "#0B0B0B")
  strokeWidth?: number; // outline width in px @1280 (default auto: ~fontSize*0.05)
  box?: string | null; // highlight-box fill colour, or null
  family?: string; // font family (default "Archivo Black")
  opacity?: number; // 0..1 (default 1)
  rotation?: number; // degrees, rotated around the text anchor (default 0)
  shadow?: boolean; // drop shadow on the text (default true when no box)
  track?: number; // letter-spacing in em (default -0.012)
  uppercase?: boolean; // force ALL CAPS at render (default false)
};
export type ThumbAccentLayer = {
  type: "accent";
  kind: ThumbGraphicKind;
  cx: number; // centre x
  cy: number; // centre y
  size: number;
  color: string;
  dir?: number; // arrow direction (+1 right / -1 left)
};
export type ThumbLayer = ThumbTextLayer | ThumbAccentLayer;
export type ThumbLayers = { w: number; h: number; items: ThumbLayer[] };

export type YouTubeThumb = {
  index: number;
  layout: ThumbLayout;
  text: string; // the headline (for the UI)
  url: string;
  relPath: string;
  sceneSource: "ai" | "fallback";
  bytes: number;
  concept: ThumbConcept; // carried so the client can regenerate just this one
  score?: ThumbScore; // CTR scorer's read (when scoring ran)
  editBase?: string; // relPath of the clean no-text background (for the editor)
  layers?: ThumbLayers; // the generated text + accent layers (editor starting point)
  editState?: ThumbLayers; // the last saved edit (editor resumes from this if present)
  error?: string;
};

export type YouTubePack = {
  ok: boolean;
  site?: string;
  summary?: string;
  titles: string[];
  description: string;
  hashtags: string[];
  thumbnails: YouTubeThumb[];
  clickability: number | null;
  error?: string;
};
