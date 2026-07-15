// Demo Studio shared contract (demo videos).
//
// A *recipe* is the deterministic, authored click-path for one site feature. A
// *scenario* is a recipe with brand-voice narration attached (written by Tess's
// brain at enqueue time) — it is the JSON the tess-media worker plays back. The
// worker has its own matching copy of these shapes; the JSON stored in
// media_jobs.scenario is the contract between them, so keep both in sync.

import type { SiteKey } from "@/lib/site-scope";

// A resilient element locator. The worker resolves these in priority order
// (testId → label → placeholder → role+name → text → css), matching
// label/name/text/placeholder case-insensitively, so demos survive minor DOM
// drift. A target that can't be found is skipped gracefully (the demo still
// renders) — it never fabricates an interaction or a result.
export type DemoLocator = {
  testId?: string;
  label?: string;
  placeholder?: string;
  role?: string;
  name?: string;
  text?: string;
  css?: string;
  nth?: number;
};

export type DemoAction =
  | "goto" // navigate to a URL (target.css/href via value, else recipe.url)
  | "fill" // type value into a text field
  | "select" // choose value in a <select>
  | "click" // click an element
  | "wait" // pause value ms (e.g. let a live result compute)
  | "reveal" // bring an element into view + focus on it (no interaction)
  | "highlight" // emphasize an element without interacting
  | "scroll" // smooth-scroll to value (0–1 fraction of page height) — for URL tours
  | "key"; // press a keyboard key (value, e.g. "Escape") — close a menu/popover, no target

export type DemoStep = {
  id: string; // stable key — narration is attached to it
  action: DemoAction;
  target?: DemoLocator;
  value?: string; // fill text / select option / wait ms
  beat: string; // plain-English description of what happens — input to the narrator
  focus?: boolean; // zoom/pan toward target during this step (default: true except goto/wait)
  settleMs?: number; // extra pause after the action (default 600)
};

export type DemoRecipe = {
  id: string; // e.g. "calculatry-bmi"
  site: SiteKey;
  feature: string; // "BMI Calculator"
  url: string; // page to demo (live site)
  summary: string; // picker blurb + narration context
  baseViewport: { width: number; height: number };
  steps: DemoStep[];
};

// One step with its narration line resolved.
export type DemoScene = {
  id: string;
  action: DemoAction;
  target?: DemoLocator;
  value?: string;
  focus: boolean;
  settleMs: number;
  say: string; // narration text (brand voice) — empty string = silent beat
  // revealAfter: for a `click` opening content below the fold (e.g. an Analytics tab
  // panel under the persistent header), scroll-center this element right after the
  // click so the content shows while the narration describes it.
  revealAfter?: DemoLocator;
  // clicks: extra elements clicked across the first ~65% of this scene's hold, so several
  // UI changes happen under ONE continuous narration clip (e.g. cycling the 24h/7d/30d
  // traffic toggles under one voiceover sentence) instead of splitting into tiny beats
  // that slice the take mid-phrase and clip words.
  clicks?: DemoLocator[];
};

// A stock-footage B-roll segment that sits around the product-demo body in a
// composite video. The script proposes a search query + spoken line; the app
// resolves `videoUrl` (Pexels/Pixabay) at enqueue. Absent → legacy demo render.
export type BRoll = {
  id: string; // "broll_0" — VO is keyed on this
  place: "afterIntro" | "beforeOutro";
  say: string; // narration over the footage
  videoUrl: string; // resolved stock mp4 URL (video) or image URL (when kind="image")
  credit?: string; // attribution overlaid small
  kind?: "video" | "image"; // image = a still the worker Ken-Burns into a clip (video default)
  startSec?: number; // trim a video clip to start at this offset (skip an unwanted opening)
};

// The full thing the worker renders.
export type DemoScenario = {
  recipeId: string;
  site: SiteKey;
  feature: string;
  url: string;
  baseViewport: { width: number; height: number };
  intro: { title: string; say: string };
  scenes: DemoScene[];
  outro: { say: string };
  caption: string; // social-post caption
  hashtags: string[];
  delivery?: string; // voice-director note for expressive engines (Gemini TTS); ignored by Kokoro
  bRoll?: BRoll[]; // optional stock B-roll segments (composite videos)
  // Console showcase tours (the media-worker keeps its own copy of these flags):
  // consoleAuth — the recorder mints a short-lived admin session and films the
  // console behind auth; bare — body + narration only (no slides/captions/music),
  // sections get stitched downstream on the GPU.
  consoleAuth?: boolean;
  bare?: boolean;
  // noRedact — suppress capture-mode PII blur for THIS pass only. Used by the
  // Inbox/Outreach showcase sections, which are filmed against fabricated sample
  // data that is safe to show legibly. MUST stay unset for every real-PII section.
  noRedact?: boolean;
  // captureOnly — the VPS produces the near-lossless 4K body mezzanine + metadata
  // bundle and stops; the compose-runner finishes zoompan/composite/final-encode on
  // a GPU (NVENC). Implies bare. (The media-worker keeps its own copy of this flag.)
  captureOnly?: boolean;
  // voiceSettings — per-job ElevenLabs voice_settings override (else the defaults).
  // The console showcase narration uses steadier tutorial settings.
  voiceSettings?: { stability?: number; similarity?: number; style?: number; speakerBoost?: boolean };
  // panelCollapsed — collapse the Tess chat panel to a narrow rail for content-heavy
  // sections that need the wider main view. Unset where the chat panel is the subject.
  panelCollapsed?: boolean;
};
