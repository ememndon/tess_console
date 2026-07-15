// Worker configuration (env-driven, with sensible container defaults).
export const CFG = {
  appUrl: process.env.APP_URL ?? "http://app:3000",
  internalKey: process.env.INTERNAL_SYNC_KEY ?? "",
  mediaRoot: process.env.MEDIA_ROOT ?? "/app/media",
  piperBin: process.env.PIPER_BIN ?? "/opt/piper/piper",
  piperVoice: process.env.PIPER_VOICE ?? "/opt/piper-voices/en_US-lessac-high.onnx",
  espeakData: process.env.PIPER_ESPEAK ?? "/opt/piper/espeak-ng-data",
  kokoroPy: process.env.KOKORO_PY ?? "/opt/kokoro-venv/bin/python",
  kokoroScript: process.env.KOKORO_SCRIPT ?? "/app/kokoro_tts.py",
  kokoroModel: process.env.KOKORO_MODEL ?? "/opt/kokoro/kokoro-v1.0.onnx",
  kokoroVoices: process.env.KOKORO_VOICES ?? "/opt/kokoro/voices-v1.0.bin",
  kokoroVoice: process.env.KOKORO_VOICE ?? "af_sarah",
  kokoroSpeed: process.env.KOKORO_SPEED ?? "1.0",
  // Google Gemini TTS (expressive — takes natural-language delivery direction).
  // The API key is delivered per-job in the claim response (from the vault), never here.
  geminiModel: process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview",
  geminiVoice: process.env.GEMINI_VOICE ?? "Leda",
  // Base delay between TTS lines to stay under the free-tier per-minute budget.
  geminiPaceMs: Number(process.env.GEMINI_PACE_MS ?? 8000),
  // Fallback delivery direction when the script doesn't carry its own (scenario.delivery).
  geminiStyle:
    process.env.GEMINI_STYLE ??
    "Read this like a charismatic short-form video ad host talking to one friend: bright, playful and genuinely excited, warm and natural. Vary the intonation, lean into the rhetorical questions, and land the punchlines with a little smile in your voice",
  // ElevenLabs TTS (the production engine — reliable, no daily cap, char-billed).
  // Key delivered per-job from the vault (claim route). Voice spec is "eleven:<name|id>";
  // a friendly name (e.g. eleven:Rachel) is resolved to a voice_id via /v1/voices.
  elevenModel: process.env.ELEVEN_MODEL ?? "eleven_multilingual_v2",
  // Default voice = Jessica (playful, bright, warm) by stable premade voice_id.
  elevenVoice: process.env.ELEVEN_VOICE ?? "cgSgspJ2msm6clMCkdW9",
  // voice_settings — lower stability = more expressive/varied (good for ad reads);
  // style adds delivery flair; speaker_boost tightens timbre to the chosen voice.
  elevenStability: Number(process.env.ELEVEN_STABILITY ?? 0.4),
  elevenSimilarity: Number(process.env.ELEVEN_SIMILARITY ?? 0.8),
  elevenStyle: Number(process.env.ELEVEN_STYLE ?? 0.45),
  elevenSpeakerBoost: (process.env.ELEVEN_SPEAKER_BOOST ?? "true") !== "false",
  voiceDefault: process.env.VOICE_DEFAULT ?? "kokoro:af_sarah",
  captionFont: process.env.CAPTION_FONT ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  pollMs: Number(process.env.POLL_MS ?? 15000),
  // Premium 60fps + motion-blur intros/outros AND 2×-supersampled screencast capture
  // render slower (up to ~6 Remotion clips + 3 hi-res screencast assemblies per video),
  // so give the whole job generous headroom.
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS ?? 60 * 60 * 1000),
  // Runaway-synth guard: any single line longer than this is a TTS hallucination
  // (e.g. Gemini once produced 257s for an 11-word line). Trim it so one bad line can
  // never blow the job timeout or produce a 10-minute "short-form" ad.
  maxLineSec: Number(process.env.MAX_LINE_SEC ?? 30),
};

// Output specs per aspect. vw/vh is the capture viewport (native responsive layout);
// w/h is the final encoded size (lanczos-upscaled from the capture).
export type FormatKey = "9:16" | "1:1" | "16:9" | "16:9hd" | "16:9uhd" | "16:9p";
// w/h = final encoded size. vw/vh = capture viewport (CSS px). Playwright video
// records the CSS viewport 1:1 (it ignores deviceScaleFactor), so for crisp output we
// capture at (near-)native size: 1:1 and 16:9 desktop formats capture at the full output
// resolution (zero upscale); 9:16 captures at the widest size that still triggers the
// site's MOBILE layout (~<768px), then upscales 1.5× with a light sharpen in compose.
// dsf = deviceScaleFactor for the CDP screencast capture. We capture at vw×vh CSS
// (vw is narrow for 9:16 to force the site's mobile layout) but at `dsf`× the device
// pixels, then downscale to w×h — so the footage is supersampled/crisp instead of
// upscaled-from-720. 9:16 captures at 2× (1440px), the desktop formats at 1.5×.
export const FORMATS: Record<FormatKey, { w: number; h: number; vw: number; vh: number; isMobile: boolean; dsf: number }> = {
  "9:16": { w: 1080, h: 1920, vw: 720, vh: 1280, isMobile: true, dsf: 2 },
  "1:1": { w: 1080, h: 1080, vw: 1080, vh: 1080, isMobile: false, dsf: 1.5 },
  "16:9": { w: 1920, h: 1080, vw: 1920, vh: 1080, isMobile: false, dsf: 1.5 },
  // Console showcase: 4K output from a SMALLER CSS viewport (1600 wide) so the UI
  // renders ~20% larger in-frame — bigger, sharper text than 1920→1080 — captured
  // natively at 2.4× (3840×2160, zero upscale). Heavier to render; used for the
  // per-section bare tour only.
  "16:9uhd": { w: 3840, h: 2160, vw: 1600, vh: 900, isMobile: false, dsf: 2.4 },
  // Console showcase, 1080p dress-rehearsal variant: 1920×1080 output from an even
  // SMALLER 1440-wide CSS viewport (bigger/bolder UI than 16:9uhd's 1600), captured at
  // 2× (2880 wide → 1.5× supersample down to 1920) so it stays sharp. ~4× cheaper to
  // compose than 16:9uhd — used to trial the 1440 viewport against the 1600 clips.
  "16:9hd": { w: 1920, h: 1080, vw: 1440, vh: 810, isMobile: false, dsf: 2 },
  // Showcase PREVIEW: the SAME 1600 CSS viewport as the 4K final (16:9uhd) so the UI
  // scale/feel matches exactly, but rendered to 1080p (captured at 1.35× ≈ 2160 wide,
  // downscaled to 1920 → crisp) so the compose is fast enough to iterate on the VPS.
  "16:9p": { w: 1920, h: 1080, vw: 1600, vh: 900, isMobile: false, dsf: 1.35 },
};

// Brand palette (mirrors app/src/lib/video.ts — kept local since the worker is a
// separate package). c1/c2 are the gradient/brand colors used for intro/outro.
export const BRAND: Record<string, { name: string; c1: string; c2: string; accent: string; domain: string }> = {
  calculatry: { name: "Calculatry", c1: "#1E3A8A", c2: "#2563EB", accent: "#93C5FD", domain: "calculatry.com" },
  resumehub: { name: "GlobalResumeHub", c1: "#0A2A6E", c2: "#1D4ED8", accent: "#FF6A1A", domain: "globalresumehub.com" },
  checkinvest: { name: "CheckInvest", c1: "#134E4A", c2: "#0D9488", accent: "#5EEAD4", domain: "checkinvestng.com" },
};

// Per-site spoken-form fixes, applied to the TTS text ONLY (on-screen captions keep
// the real spelling). Teaches the voice to say brand names correctly. The brand
// "Calculatry" is "KAL-kyuh-lay-tree" — respelled so ElevenLabs/Kokoro say it right.
export const PRONUNCIATIONS: Record<string, [RegExp, string][]> = {
  calculatry: [[/\bCalculatry\b/gi, "Cal-cue-lay-tree"]],
  // Console showcase (site "console"): the narration is spoken by the owner's
  // Professional Voice Clone, trained on this exact script — so brand names are
  // already pronounced correctly. Do NOT respell (respellings over-break the words).
  // The owner's name "Emem" (Eh-mem) is left EXACTLY as written per his instruction.
  // Only normalize a literal ".com" to "dot com" so a domain reads naturally; the
  // script already writes most as "dot com" (a no-op there).
  console: [[/\.com\b/gi, " dot com"]],
};

// Rewrite a line into its spoken form for a given site (captions are unaffected).
export function speakable(site: string, text: string): string {
  let t = text;
  for (const [re, rep] of PRONUNCIATIONS[site] ?? []) t = t.replace(re, rep);
  return t;
}

// Scene-timing budget (shared across all three formats so VO/captions align).
export const TIMING = {
  prePadMs: 350,
  postPadMs: 500,
  minSceneMs: 2200,
  actionMinMs: 1400,
};
