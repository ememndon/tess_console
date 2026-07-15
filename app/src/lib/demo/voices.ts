// Kokoro-82M voice catalog (v1.0, 54 voices). Value is the full voice spec stored on
// the job ("kokoro:<name>"); label is what the admin sees. English voices first
// (these brands are English); other languages grouped after. A few standouts are
// marked ★ — the most natural for ad voiceover.
export type VoiceOption = { value: string; label: string };

const k = (name: string) => `kokoro:${name}`;
const g = (name: string) => `gemini:${name}`;
const e = (name: string) => `eleven:${name}`;

export const VOICES: VoiceOption[] = [
  // ── ElevenLabs — PRODUCTION engine (reliable, no daily cap, char-billed). Tess's
  //    go-to. Value is eleven:<voice_id> (stable premade IDs — robust against the
  //    account's descriptive voice names and works even with a TTS-only scoped key). ──
  { value: e("cgSgspJ2msm6clMCkdW9"), label: "★★ Jessica — playful, bright, warm (Tess default)" },
  { value: e("EXAVITQu4vr4xnSDxMaL"), label: "★★ Sarah — mature, reassuring, confident" },
  { value: e("hpp4J3VqNfWAUOO0d1Us"), label: "★ Bella — professional, bright, warm" },
  { value: e("FGY2WhTYpPnrIDTdsKH5"), label: "★ Laura — enthusiastic, quirky" },
  { value: e("XrExE9yKIg1WjnnlVkGX"), label: "Matilda — knowledgable, professional (female)" },
  { value: e("Xb7hH8MSUJpSbSDYk0k2"), label: "Alice — clear, engaging educator (female)" },
  { value: e("pFZP5JQG7iQjIQuC4Bku"), label: "Lily — velvety, warm (female)" },
  { value: e("nPczCjzI2devNBz1zQrb"), label: "★ Brian — deep, resonant narrator (male)" },
  { value: e("JBFqnCBsd6RMkjVDRZzb"), label: "★ George — warm, captivating storyteller (male)" },
  { value: e("TX3LPaxmHKxFdv7VOQHJ"), label: "Liam — energetic social-media creator (male)" },
  { value: e("cjVigY5qzO86Huf0OWal"), label: "Eric — smooth, trustworthy (male)" },
  { value: e("iP95p4xoKVk53GoZ742B"), label: "Chris — charming, down-to-earth (male)" },
  // ── ElevenLabs — Nigerian-accented English (added from the Voice Library; same
  //    eleven:<voice_id> path). For CheckInvestNg and any Nigerian-audience brand. ──
  { value: e("8P18CIVcRlwP98FOjZDm"), label: "🇳🇬 Ola — Nigerian male, warm storyteller" },
  { value: e("UJAoT6c9rmKm31qz5D9g"), label: "🇳🇬 Ayodeji — Nigerian male, warm & fatherly" },
  { value: e("D9xwB6HNBJ9h4YvQFWuE"), label: "🇳🇬 Tobi — Nigerian female, clear & corporate" },
  { value: e("E7AdVOKapxpnuchBH9Fa"), label: "🇳🇬 Taiwo — Nigerian female, conversational" },
  { value: e("Obry8zWnqii5oX5Qsllx"), label: "🇳🇬 Rho — Nigerian female, podcast & stories" },
  // ── Google Gemini TTS — expressive (takes delivery direction) but FREE-TIER CAPPED
  //    (~10 calls/day ≈ 1 video) and prone to occasional runaway generations. Kept as a
  //    secondary/experimental option. ──
  { value: g("Leda"), label: "Leda — Gemini female (youthful, lively)" },
  { value: g("Aoede"), label: "★★ Aoede — Gemini female (breezy) — Tess default" },
  { value: g("Kore"), label: "★ Kore — Gemini female (firm, warm)" },
  { value: g("Autonoe"), label: "★ Autonoe — Gemini female (bright)" },
  { value: g("Sulafat"), label: "Sulafat — Gemini female (warm)" },
  { value: g("Callirrhoe"), label: "Callirrhoe — Gemini female (easy-going)" },
  { value: g("Achernar"), label: "Achernar — Gemini female (soft)" },
  { value: g("Zephyr"), label: "Zephyr — Gemini female (bright)" },
  { value: g("Laomedeia"), label: "Laomedeia — Gemini female (upbeat)" },
  { value: g("Puck"), label: "★ Puck — Gemini male (upbeat)" },
  { value: g("Charon"), label: "Charon — Gemini male (informative)" },
  { value: g("Fenrir"), label: "Fenrir — Gemini male (excitable)" },
  { value: g("Orus"), label: "Orus — Gemini male (firm)" },
  // ── Kokoro-82M — free/local fallback (54 voices) ──
  // ── English (US) — female ── (Tess's go-to voices first)
  { value: k("af_sarah"), label: "★★ Sarah — US female (Tess default)" },
  { value: k("af_alloy"), label: "★★ Alloy — US female (Tess default)" },
  { value: k("af_heart"), label: "★ Heart — US female (warm)" },
  { value: k("af_bella"), label: "★ Bella — US female (expressive)" },
  { value: k("af_nicole"), label: "Nicole — US female (soft)" },
  { value: k("af_aoede"), label: "Aoede — US female" },
  { value: k("af_kore"), label: "Kore — US female" },
  { value: k("af_nova"), label: "Nova — US female" },
  { value: k("af_sky"), label: "Sky — US female" },
  { value: k("af_jessica"), label: "Jessica — US female" },
  { value: k("af_river"), label: "River — US female" },
  // ── English (US) — male ──
  { value: k("am_michael"), label: "★ Michael — US male (clear)" },
  { value: k("am_fenrir"), label: "★ Fenrir — US male (deep)" },
  { value: k("am_puck"), label: "Puck — US male (energetic)" },
  { value: k("am_echo"), label: "Echo — US male" },
  { value: k("am_eric"), label: "Eric — US male" },
  { value: k("am_liam"), label: "Liam — US male" },
  { value: k("am_onyx"), label: "Onyx — US male" },
  { value: k("am_adam"), label: "Adam — US male" },
  { value: k("am_santa"), label: "Santa — US male (novelty)" },
  // ── English (UK) ──
  { value: k("bf_emma"), label: "★ Emma — UK female" },
  { value: k("bf_isabella"), label: "Isabella — UK female" },
  { value: k("bf_alice"), label: "Alice — UK female" },
  { value: k("bf_lily"), label: "Lily — UK female" },
  { value: k("bm_george"), label: "George — UK male" },
  { value: k("bm_fable"), label: "Fable — UK male" },
  { value: k("bm_lewis"), label: "Lewis — UK male" },
  { value: k("bm_daniel"), label: "Daniel — UK male" },
  // ── Other languages ──
  { value: k("ef_dora"), label: "Dora — Spanish female" },
  { value: k("em_alex"), label: "Alex — Spanish male" },
  { value: k("em_santa"), label: "Santa — Spanish male" },
  { value: k("ff_siwis"), label: "Siwis — French female" },
  { value: k("hf_alpha"), label: "Alpha — Hindi female" },
  { value: k("hf_beta"), label: "Beta — Hindi female" },
  { value: k("hm_omega"), label: "Omega — Hindi male" },
  { value: k("hm_psi"), label: "Psi — Hindi male" },
  { value: k("if_sara"), label: "Sara — Italian female" },
  { value: k("im_nicola"), label: "Nicola — Italian male" },
  { value: k("jf_alpha"), label: "Alpha — Japanese female" },
  { value: k("jf_gongitsune"), label: "Gongitsune — Japanese female" },
  { value: k("jf_nezumi"), label: "Nezumi — Japanese female" },
  { value: k("jf_tebukuro"), label: "Tebukuro — Japanese female" },
  { value: k("jm_kumo"), label: "Kumo — Japanese male" },
  { value: k("pf_dora"), label: "Dora — Portuguese (BR) female" },
  { value: k("pm_alex"), label: "Alex — Portuguese (BR) male" },
  { value: k("pm_santa"), label: "Santa — Portuguese (BR) male" },
  { value: k("zf_xiaobei"), label: "Xiaobei — Chinese female" },
  { value: k("zf_xiaoni"), label: "Xiaoni — Chinese female" },
  { value: k("zf_xiaoxiao"), label: "Xiaoxiao — Chinese female" },
  { value: k("zf_xiaoyi"), label: "Xiaoyi — Chinese female" },
  { value: k("zm_yunjian"), label: "Yunjian — Chinese male" },
  { value: k("zm_yunxi"), label: "Yunxi — Chinese male" },
  { value: k("zm_yunxia"), label: "Yunxia — Chinese male" },
  { value: k("zm_yunyang"), label: "Yunyang — Chinese male" },
];

// ElevenLabs is the default engine for brand videos (reliable + expressive, no daily
// cap). Kokoro remains the free local fallback (k("af_sarah")) if ElevenLabs is
// unavailable (missing key / quota / outage) — the worker falls back automatically.
export const DEFAULT_VOICE = e("cgSgspJ2msm6clMCkdW9"); // Jessica — playful, bright, warm
export const KOKORO_FALLBACK_VOICE = k("af_sarah");

// Per-site default ("brand") voice — used for a site's videos whenever no voice is
// picked at render time (manual renders and Tess's auto-renders alike), so each
// brand gets a consistent sound. Unlisted sites fall back to DEFAULT_VOICE.
export const SITE_DEFAULT_VOICE: Record<string, string> = {
  checkinvest: e("8P18CIVcRlwP98FOjZDm"), // Ola — Nigerian male, warm storyteller (NG audience)
  resumehub: e("cgSgspJ2msm6clMCkdW9"), // Jessica — playful, bright, warm
  calculatry: e("hpp4J3VqNfWAUOO0d1Us"), // Bella — professional, bright, warm
};

export function defaultVoiceForSite(site?: string | null): string {
  return (site && SITE_DEFAULT_VOICE[site]) || DEFAULT_VOICE;
}

// Tess's preferred voices — she alternates between these unless told otherwise.
export const TESS_VOICES = [e("cgSgspJ2msm6clMCkdW9"), e("EXAVITQu4vr4xnSDxMaL")]; // Jessica, Sarah
