// Mirror of the app's demo scenario contract (app/src/lib/demo/types.ts). The JSON
// stored in media_jobs.scenario is the wire format between the app and this worker.

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

export type DemoAction = "goto" | "fill" | "select" | "click" | "wait" | "reveal" | "highlight" | "scroll" | "key";

export type DemoScene = {
  id: string;
  action: DemoAction;
  target?: DemoLocator;
  value?: string;
  focus: boolean;
  settleMs: number;
  say: string;
  // revealAfter: for a `click` that opens content below the fold (e.g. an Analytics
  // tab panel under the persistent header), scroll-center this element right after the
  // click so the content is visible while the narration describes it.
  revealAfter?: DemoLocator;
  // clicks: extra elements to click, spread across the first ~65% of this scene's hold,
  // so several UI changes happen under ONE continuous narration clip (e.g. cycling the
  // 24h/7d/30d traffic toggles while one voiceover sentence plays) instead of splitting
  // the line into tiny beats that slice the take mid-phrase and clip words.
  clicks?: DemoLocator[];
};

// A stock-footage B-roll segment, sequenced around the product demo body. The app
// resolves `videoUrl` from Pexels/Pixabay at enqueue; the worker downloads it,
// scales/crops to format, overlays the spoken caption + brand, and muxes its VO.
export type BRoll = {
  id: string; // e.g. "broll_0" — VO is keyed on this
  place: "afterIntro" | "beforeOutro"; // where it sits relative to the demo body
  say: string; // narration over the footage
  videoUrl: string; // resolved stock mp4 URL (video) or image URL (when kind="image")
  credit?: string; // attribution overlaid small (e.g. "Pexels / Jane")
  kind?: "video" | "image"; // image = a still, Ken-Burns'd into a clip (default: video)
  startSec?: number; // trim a video clip to start at this offset (skip an unwanted opening)
};

export type DemoScenario = {
  recipeId: string;
  site: string;
  feature: string;
  url: string;
  baseViewport: { width: number; height: number };
  intro: { title: string; say: string };
  scenes: DemoScene[];
  outro: { say: string };
  caption: string;
  hashtags: string[];
  // Optional voice-director note for expressive engines (Gemini TTS), e.g.
  // "bright, playful, high-energy ad read; land the punchlines". Ignored by Kokoro/Piper.
  delivery?: string;
  // Optional stock B-roll segments (composite videos). Absent → legacy
  // intro+demo+outro render, unchanged.
  bRoll?: BRoll[];
  // Console showcase tours only: the target is the console itself, behind auth.
  // The worker requests a short-lived session from /api/internal/capture-session
  // and sets it as a cookie before navigation — no login screen on camera.
  consoleAuth?: boolean;
  // Bare render: body + narration only (no intro/outro slides, no captions, no
  // music, no end fade). Showcase sections are stitched downstream on the GPU.
  bare?: boolean;
  // noRedact: suppress capture-mode PII blur for THIS pass only (Inbox/Outreach
  // showcase sections shot against fabricated sample data). Never set for a
  // section that shows real customer/team/audit data.
  noRedact?: boolean;
  // captureOnly: the VPS half of the capture→GPU-compose split. The worker produces
  // the near-lossless 4K body mezzanine + metadata bundle and STOPS — no zoompan,
  // no compose. The compose-runner (NVENC on a rented GPU) finishes it. Implies bare.
  captureOnly?: boolean;
  // voiceSettings: per-job ElevenLabs voice_settings override (else CFG defaults).
  // The console showcase uses steadier tutorial settings without changing Tess's demos.
  voiceSettings?: { stability?: number; similarity?: number; style?: number; speakerBoost?: boolean; speed?: number };
  // panelCollapsed: collapse the Tess chat panel to a narrow rail for content-heavy
  // sections that need the wider main view. Leave unset where the chat is the subject.
  panelCollapsed?: boolean;
};

// A claimed render job from /api/internal/media/claim.
export type MediaJob = {
  id: string;
  site: string;
  recipeId: string;
  feature: string;
  url: string;
  scenario: DemoScenario;
  formats: string[];
  voice: string;
  music: string; // none | auto | <filename in media/assets/music>
  createdBy: string;
  // Decrypted provider API key, attached by the claim route only when `voice` is a
  // cloud engine (e.g. "gemini:Leda"). Never stored; lives only for this job's render.
  ttsKey?: string;
};

// Scene with its absolute timeline position (computed once, identical per format).
export type TimedScene = DemoScene & {
  startMs: number;
  durMs: number;
  voPath?: string; // mastered narration wav (absent if silent)
  voDurMs: number;
  voWords?: { text: string; startMs: number; endMs: number }[]; // real word timings (ElevenLabs), for caption sync
};

export type BBox = { x: number; y: number; width: number; height: number };

export type MediaOut = { type: "video" | "image"; path: string; width?: number; height?: number };
