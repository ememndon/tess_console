import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { CFG } from "./config.js";
import { ffmpeg, ffprobeDuration } from "./ffmpeg.js";

// Pluggable TTS. Default is Kokoro-82M (natural, near-cloud quality);
// Piper is kept as a fallback. Every line is mastered with an ffmpeg signal chain so
// it sounds produced. Swapping to Groq/OpenAI/ElevenLabs later is just another branch.

// Voice spec is "kokoro:<voiceName>" (e.g. kokoro:af_bella), "gemini:<Voice>"
// (e.g. gemini:Leda) or "piper". A bare provider uses its configured default voice.
export type TtsItem = { id: string; text: string };
export type WordTime = { text: string; startMs: number; endMs: number };
export type TtsResult = { path: string; durMs: number; words?: WordTime[] };
export type TtsOpts = {
  ttsKey?: string;
  style?: string;
  // Per-job ElevenLabs voice_settings override (else the CFG defaults). Lets the
  // console showcase use steadier tutorial settings without changing Tess's demos.
  voiceSettings?: { stability?: number; similarity?: number; style?: number; speakerBoost?: boolean; speed?: number };
};

// Build per-word timings from ElevenLabs character-level alignment (start/end seconds
// per input character). Lets captions land exactly on the spoken word, even when the
// voice speeds up. Operates on the ORIGINAL text alignment (chars match our input).
function wordsFromAlignment(chars: string[], starts: number[], ends: number[]): WordTime[] {
  const words: WordTime[] = [];
  let cur = "", s = -1, e = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] ?? "";
    if (/\s/.test(c)) {
      if (cur) { words.push({ text: cur, startMs: Math.round(s * 1000), endMs: Math.round(e * 1000) }); cur = ""; s = -1; }
    } else {
      if (s < 0) s = starts[i] ?? 0;
      e = ends[i] ?? s;
      cur += c;
    }
  }
  if (cur) words.push({ text: cur, startMs: Math.round(s * 1000), endMs: Math.round(e * 1000) });
  return words;
}

// Mastering chain: high-pass → tame mud → presence → air → gentle compression → 48 kHz.
// (Final loudness normalization happens once on the full mix, in compose.)
const MASTER =
  "highpass=f=80,equalizer=f=240:t=q:w=1.0:g=-2,equalizer=f=3400:t=q:w=1.4:g=2.5,treble=g=1.5:f=8500,acompressor=threshold=-18dB:ratio=2.6:attack=8:release=150,aresample=48000";

async function run(cmd: string, args: string[], stdin?: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exit ${code}: ${err.slice(-400)}`))));
    if (stdin !== undefined) {
      p.stdin.write(stdin);
    }
    p.stdin.end();
  });
}

async function piperRaw(text: string, outWav: string): Promise<void> {
  await run(
    CFG.piperBin,
    ["--model", CFG.piperVoice, "--espeak_data", CFG.espeakData, "--length_scale", "1.0", "--noise_w", "0.8", "--sentence_silence", "0.32", "--output_file", outWav],
    text.replace(/\s+/g, " ").trim() + "\n",
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Google Gemini TTS: one expressive line at a time. The model takes a natural-language
// delivery direction (style) — that's how we get rhythm/emotion Kokoro can't. Returns
// raw PCM (s16le, 24 kHz, mono) which we wrap into a wav for the shared mastering chain.
async function geminiRaw(apiKey: string, voice: string, style: string, text: string, outDir: string, outWav: string): Promise<void> {
  const line = text.replace(/\s+/g, " ").trim();
  // Gemini interprets a single leading instruction (ending in a colon) as DELIVERY
  // direction, not speech — but a newline/extra colon makes it read the direction
  // aloud. So: collapse the directive to one clean clause, lead with an imperative,
  // and keep it inline with exactly one colon before the line. (Verified: this yields
  // ~5s for a 10-word line; the buggy "style\n\nline" form spoke the directive at ~20s.)
  const directive = style.replace(/[\n:]+/g, " ").replace(/\s+/g, " ").trim();
  const prompt = directive ? `Read this aloud as a short-form video voiceover, ${directive}: ${line}` : line;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CFG.geminiModel}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  };

  // Free tier is tight (low requests/tokens per minute), so be patient: honor the
  // server's RetryInfo.retryDelay when present, otherwise exponential backoff, with
  // many attempts (a render is a once-a-day scheduled job — slow is fine, failing isn't).
  const MAX_ATTEMPTS = 8;
  let lastErr = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      const j = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
      const b64 = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (!b64) throw new Error("gemini: response had no audio");
      const pcmPath = path.join(outDir, path.basename(outWav).replace(/\.wav$/, ".pcm"));
      await fs.writeFile(pcmPath, Buffer.from(b64, "base64"));
      await ffmpeg(["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmPath, outWav]);
      return;
    }
    const bodyText = await res.text();
    lastErr = `${res.status} ${bodyText.slice(0, 200)}`;
    // Daily free-tier cap: retrying is futile (won't clear until tomorrow). Fail fast
    // so the caller can fall back to Kokoro and still produce the video.
    if (res.status === 429 && /PerDay|RequestsPerDay/i.test(bodyText)) {
      throw new Error(`gemini daily quota reached (free tier): ${bodyText.slice(0, 160)}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
      // Prefer the server-advertised retry delay (e.g. "27s"); else exponential, capped.
      let waitMs = Math.min(60000, 5000 * 2 ** attempt);
      const m = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
      if (m) waitMs = Math.max(waitMs, Math.ceil(parseFloat(m[1]) * 1000) + 1000);
      await sleep(waitMs);
      continue;
    }
    break; // non-retryable (4xx other than 429)
  }
  throw new Error(`gemini TTS failed: ${lastErr}`);
}

// Resolve a friendly ElevenLabs voice name ("eleven:Rachel") to its voice_id. A
// 20-char alphanumeric ref is already an id and used as-is. Listing voices is a free
// GET (no character cost), done once per render.
async function resolveElevenVoiceId(apiKey: string, ref: string): Promise<string> {
  if (/^[A-Za-z0-9]{20}$/.test(ref)) return ref; // already a voice_id — no lookup needed
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
  if (!res.ok) throw new Error(`elevenlabs: cannot list voices (${res.status} ${(await res.text()).slice(0, 120)})`);
  const j = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
  const want = ref.toLowerCase();
  // Account voice names often carry a descriptive suffix ("Sarah - Mature, Reassuring");
  // match the exact name first, then the leading name token before " - ".
  const v =
    j.voices?.find((x) => x.name?.toLowerCase() === want) ??
    j.voices?.find((x) => x.name?.toLowerCase().split(" - ")[0].trim() === want);
  if (!v) throw new Error(`elevenlabs: voice "${ref}" not found in this account (use its voice_id or add it in the Voice Library)`);
  return v.voice_id;
}

// ElevenLabs TTS: returns raw PCM (s16le, 24 kHz, mono) — same shape as the Gemini
// branch — which we wrap into a wav for the shared mastering chain. Reliable and not
// daily-capped (char-billed), so retries are cheap; we still back off on 429/5xx and
// fail fast on auth/param errors so the caller can fall back to Kokoro.
async function elevenRaw(
  apiKey: string,
  voiceId: string,
  modelId: string,
  settings: Record<string, unknown>,
  text: string,
  outDir: string,
  outWav: string,
  ctx?: { prev?: string; next?: string },
): Promise<{ words?: WordTime[] }> {
  const line = text.replace(/\s+/g, " ").trim();
  // /with-timestamps returns { audio_base64, alignment } so captions can land on the
  // exact spoken word. Audio is pcm_24000 (same wrap as before).
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=pcm_24000`;
  // Request stitching: previous_text/next_text give the model the surrounding lines as
  // context so tone/energy stay continuous across the per-scene seams (matters most at
  // low stability). They shape prosody only — they are NOT spoken.
  const body: Record<string, unknown> = { text: line, model_id: modelId, voice_settings: settings };
  if (ctx?.prev) body.previous_text = ctx.prev;
  if (ctx?.next) body.next_text = ctx.next;
  const MAX_ATTEMPTS = 5;
  let lastErr = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = (await res.json()) as {
        audio_base64?: string;
        alignment?: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] };
      };
      if (!j.audio_base64) throw new Error("elevenlabs: empty audio response");
      const pcmPath = path.join(outDir, path.basename(outWav).replace(/\.wav$/, ".pcm"));
      await fs.writeFile(pcmPath, Buffer.from(j.audio_base64, "base64"));
      await ffmpeg(["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcmPath, outWav]);
      const a = j.alignment;
      const words = a?.characters && a.character_start_times_seconds && a.character_end_times_seconds
        ? wordsFromAlignment(a.characters, a.character_start_times_seconds, a.character_end_times_seconds)
        : undefined;
      return { words };
    }
    const bodyText = await res.text();
    lastErr = `${res.status} ${bodyText.slice(0, 200)}`;
    // Bad key / forbidden / bad voice or params won't fix on retry.
    if (res.status === 401 || res.status === 403 || res.status === 422) {
      throw new Error(`elevenlabs ${res.status}: ${bodyText.slice(0, 160)}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
      await sleep(Math.min(30000, 2000 * 2 ** attempt));
      continue;
    }
    break;
  }
  throw new Error(`elevenlabs TTS failed: ${lastErr}`);
}

// Synthesize all lines in one shot (Kokoro loads its model once per batch), then
// master each. Returns a map id → { path, durMs }; empty-text ids map to silence.
export async function synthesizeBatch(voiceSpec: string, items: TtsItem[], outDir: string, opts: TtsOpts = {}): Promise<Map<string, TtsResult>> {
  const out = new Map<string, TtsResult>();
  const wordsById = new Map<string, WordTime[]>(); // per-line word timings (ElevenLabs)
  const allReal = items.filter((i) => i.text && i.text.trim());
  for (const i of items) out.set(i.id, { path: "", durMs: 0 });
  if (allReal.length === 0) return out;

  const [provider, name] = (voiceSpec || "kokoro").split(":");

  // Voiceover cache: a mastered line is keyed by voice+style+text, so re-renders of
  // the same script cost ZERO TTS calls (and repeated lines like outros are reused
  // across videos). Cache hits are excluded from synthesis below.
  const cacheDir = path.join(CFG.mediaRoot, "assets", "vo-cache");
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
  // Include the voice_settings signature so lines synthesized with different settings
  // (e.g. the showcase's steadier tutorial settings) never collide in the cache.
  const settingsSig = JSON.stringify(opts.voiceSettings ?? {});
  const keyOf = (text: string) =>
    crypto.createHash("sha1").update(`${voiceSpec} ${opts.style ?? ""} ${settingsSig} ${text.replace(/\s+/g, " ").trim()}`).digest("hex");
  const real: TtsItem[] = [];
  for (const i of allReal) {
    const cw = path.join(cacheDir, `${keyOf(i.text)}.wav`);
    const cj = path.join(cacheDir, `${keyOf(i.text)}.json`);
    if (await exists(cw)) {
      const fin = path.join(outDir, `${i.id}.wav`);
      await fs.copyFile(cw, fin).catch(() => {});
      let durMs = Math.round((await ffprobeDuration(fin)) * 1000);
      let words: WordTime[] | undefined;
      try {
        const meta = JSON.parse(await fs.readFile(cj, "utf8")) as { durMs?: number; words?: WordTime[] };
        if (typeof meta.durMs === "number") durMs = meta.durMs;
        words = meta.words;
      } catch {
        /* sidecar optional */
      }
      out.set(i.id, { path: fin, durMs, words });
    } else {
      real.push(i); // cache miss → synthesize
    }
  }
  if (real.length === 0) {
    console.log(`[tts] cache: all ${allReal.length} lines reused — no TTS calls`);
    return out;
  }
  if (real.length < allReal.length) console.log(`[tts] cache: reused ${allReal.length - real.length}/${allReal.length}, synthesizing ${real.length}`);

  // 1) Produce raw wavs for each line.
  const rawOf = (id: string) => path.join(outDir, `${id}.raw.wav`);

  // Kokoro batch synth (also the free fallback when a cloud engine is unavailable).
  const kokoroBatch = async (voiceName: string) => {
    const manifest = real.map((i) => ({ text: i.text.replace(/\s+/g, " ").trim(), out: rawOf(i.id) }));
    const manifestPath = path.join(outDir, "kokoro_manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await run(CFG.kokoroPy, [CFG.kokoroScript, CFG.kokoroModel, CFG.kokoroVoices, voiceName || CFG.kokoroVoice, String(CFG.kokoroSpeed), manifestPath]);
  };

  let usedFallback = false; // true if a cloud voice fell back to Kokoro → don't cache (retry real voice next time)
  if (provider === "kokoro") {
    await kokoroBatch(name || CFG.kokoroVoice);
  } else if (provider === "gemini") {
    if (!opts.ttsKey) throw new Error("voice 'gemini:*' requires an API key (none delivered with the job)");
    const voice = name || CFG.geminiVoice;
    const style = (opts.style || CFG.geminiStyle).trim();
    try {
      // Pace requests to respect the free tier's per-minute budget (geminiRaw also backs
      // off on 429). Slow voiceover synth is fine for a once-a-day scheduled render.
      for (let n = 0; n < real.length; n++) {
        if (n > 0) await sleep(CFG.geminiPaceMs);
        await geminiRaw(opts.ttsKey, voice, style, real[n].text, outDir, rawOf(real[n].id));
      }
    } catch (e) {
      // Cloud engine unavailable (e.g. daily free-tier cap) → render anyway with the
      // free local voice, consistent across the whole clip, rather than failing the job.
      console.warn(`${new Date().toISOString()} [tts] gemini failed (${e instanceof Error ? e.message : e}); falling back to Kokoro (${CFG.kokoroVoice})`);
      usedFallback = true;
      await kokoroBatch(CFG.kokoroVoice);
    }
  } else if (provider === "eleven") {
    if (!opts.ttsKey) throw new Error("voice 'eleven:*' requires an API key (none delivered with the job)");
    const ref = name || CFG.elevenVoice;
    const settings: Record<string, unknown> = {
      stability: opts.voiceSettings?.stability ?? CFG.elevenStability,
      similarity_boost: opts.voiceSettings?.similarity ?? CFG.elevenSimilarity,
      style: opts.voiceSettings?.style ?? CFG.elevenStyle,
      use_speaker_boost: opts.voiceSettings?.speakerBoost ?? CFG.elevenSpeakerBoost,
    };
    if (opts.voiceSettings?.speed != null) settings.speed = opts.voiceSettings.speed;
    try {
      const voiceId = await resolveElevenVoiceId(opts.ttsKey, ref);
      // Stitching context = each line's neighbours in the ordered narration flow
      // (allReal), so consecutive beats flow with continuous tone across the seams.
      const flowIdx = new Map(allReal.map((it, idx) => [it.id, idx] as const));
      for (const i of real) {
        const idx = flowIdx.get(i.id) ?? -1;
        const ctx = {
          prev: idx > 0 ? allReal[idx - 1].text : undefined,
          next: idx >= 0 && idx < allReal.length - 1 ? allReal[idx + 1].text : undefined,
        };
        const r = await elevenRaw(opts.ttsKey, voiceId, CFG.elevenModel, settings, i.text, outDir, rawOf(i.id), ctx);
        if (r.words?.length) wordsById.set(i.id, r.words);
      }
    } catch (e) {
      // Cloud engine unavailable (bad key / quota exhausted / outage) → ship the video
      // with the free local voice rather than failing the job.
      console.warn(`${new Date().toISOString()} [tts] elevenlabs failed (${e instanceof Error ? e.message : e}); falling back to Kokoro (${CFG.kokoroVoice})`);
      usedFallback = true;
      await kokoroBatch(CFG.kokoroVoice);
    }
  } else if (provider === "piper") {
    for (const i of real) await piperRaw(i.text, rawOf(i.id));
  } else {
    throw new Error(`voice '${voiceSpec}' not configured (use 'eleven:<name>', 'kokoro:<name>', 'gemini:<Voice>' or 'piper')`);
  }

  // 2) Master each raw wav and measure its duration. Runaway guard: any line longer
  // than CFG.maxLineSec is a TTS hallucination (a model that never emitted end-of-speech
  // and rambled for minutes); trim it on the way in so one bad line can't blow the job
  // timeout or produce a 10-minute "short-form" ad.
  for (const i of real) {
    const raw = rawOf(i.id);
    if (!(await exists(raw))) continue; // a line may have been skipped (empty after trim)
    const fin = path.join(outDir, `${i.id}.wav`);
    const rawSec = await ffprobeDuration(raw);
    const runaway = rawSec > CFG.maxLineSec;
    if (runaway) {
      console.warn(`${new Date().toISOString()} [tts] line "${i.id}" ran away (${rawSec.toFixed(1)}s) — trimming to ${CFG.maxLineSec}s (likely a TTS hallucination)`);
    }
    await ffmpeg([...(runaway ? ["-t", String(CFG.maxLineSec)] : []), "-i", raw, "-af", MASTER, "-ar", "48000", "-ac", "1", fin]);
    // Word timings are valid only if the line wasn't runaway-trimmed (MASTER preserves duration).
    const durMs = Math.round((await ffprobeDuration(fin)) * 1000);
    const words = runaway ? undefined : wordsById.get(i.id);
    out.set(i.id, { path: fin, durMs, words });
    // Persist to the VO cache for future re-renders — but NOT when a cloud voice fell
    // back to Kokoro (we want to retry the real voice next time, not cache the fallback).
    if (!usedFallback) {
      try {
        const k = keyOf(i.text);
        await fs.copyFile(fin, path.join(cacheDir, `${k}.wav`));
        await fs.writeFile(path.join(cacheDir, `${k}.json`), JSON.stringify({ durMs, words }));
      } catch {
        /* cache write is best-effort */
      }
    }
  }
  return out;
}

// Whole-section synthesis: render the ENTIRE section as ONE ElevenLabs call (a single
// continuous take) so volume + expressiveness stay consistent across beats — then slice
// it back into per-scene clips using the returned word alignment, so the recorder keeps
// its per-scene screen timing. Fixes the per-line variance you get from synthesizing
// each beat separately (esp. audible at the low-stability, expressive showcase settings).
// eleven-only; on a non-eleven voice or any word-count mismatch it falls back to the
// per-line batch. Returns the same map shape as synthesizeBatch.
export async function synthesizeOneTake(voiceSpec: string, items: TtsItem[], outDir: string, opts: TtsOpts = {}): Promise<Map<string, TtsResult>> {
  const out = new Map<string, TtsResult>();
  for (const i of items) out.set(i.id, { path: "", durMs: 0 });
  const real = items.filter((i) => i.text && i.text.trim());
  if (real.length === 0) return out;

  const [provider, name] = (voiceSpec || "kokoro").split(":");
  if (provider !== "eleven" || !opts.ttsKey) return synthesizeBatch(voiceSpec, items, outDir, opts);

  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const lineTexts = real.map((i) => norm(i.text));
  const wordCounts = lineTexts.map((t) => t.split(" ").length);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);
  const joined = lineTexts.join(" ");

  const settings: Record<string, unknown> = {
    stability: opts.voiceSettings?.stability ?? CFG.elevenStability,
    similarity_boost: opts.voiceSettings?.similarity ?? CFG.elevenSimilarity,
    style: opts.voiceSettings?.style ?? CFG.elevenStyle,
    use_speaker_boost: opts.voiceSettings?.speakerBoost ?? CFG.elevenSpeakerBoost,
  };
  // ElevenLabs clamps speed to [0.7, 1.2]; outside that the request 422s. Omitted
  // entirely when unset, so the 17 locked sections keep their exact cache keys.
  if (opts.voiceSettings?.speed != null) settings.speed = opts.voiceSettings.speed;

  try {
    const voiceId = await resolveElevenVoiceId(opts.ttsKey, name || CFG.elevenVoice);
    // Cache the whole take by voice + settings + exact text, so re-rendering a section
    // for a VISUAL tweak costs ZERO credits — synthesize once, reuse the audio.
    const cacheDir = path.join(CFG.mediaRoot, "assets", "vo-cache");
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
    const settingsSig = JSON.stringify(opts.voiceSettings ?? {});
    const ckey = crypto.createHash("sha1").update(`onetake ${voiceSpec} ${opts.style ?? ""} ${settingsSig} ${joined}`).digest("hex");
    const cacheRaw = path.join(cacheDir, `${ckey}.onetake.wav`);
    const cacheJson = path.join(cacheDir, `${ckey}.onetake.json`);
    const rawWav = path.join(outDir, "_onetake_raw.wav");
    // ONE synthesis call for the whole section (elevenRaw does not trim; the runaway
    // guard lives in the per-line batch and would wrongly chop a legitimately long take).
    let words: WordTime[];
    if ((await exists(cacheRaw)) && (await exists(cacheJson))) {
      await fs.copyFile(cacheRaw, rawWav);
      words = JSON.parse(await fs.readFile(cacheJson, "utf8")) as WordTime[];
      console.log(`${new Date().toISOString()} [tts] one-take: cache hit — no TTS call (${words.length} words)`);
    } else {
      const r = await elevenRaw(opts.ttsKey, voiceId, CFG.elevenModel, settings, joined, outDir, rawWav);
      words = r.words ?? [];
      if (words.length > 0 && Math.abs(words.length - totalWords) <= 2) {
        await fs.copyFile(rawWav, cacheRaw).catch(() => {});
        await fs.writeFile(cacheJson, JSON.stringify(words)).catch(() => {});
      }
    }
    // Guard: the model must return ~the same word count as the input, or the per-line
    // word-count slicing would drift. If it doesn't, fall back to the safe per-line path.
    if (words.length === 0 || Math.abs(words.length - totalWords) > 2) {
      console.warn(`${new Date().toISOString()} [tts] one-take word mismatch (${words.length} vs ${totalWords}) — falling back to per-line`);
      return synthesizeBatch(voiceSpec, items, outDir, opts);
    }
    // Master the whole take once (one consistent compression pass), then slice per scene.
    const fullWav = path.join(outDir, "_onetake.wav");
    await ffmpeg(["-i", rawWav, "-af", MASTER, "-ar", "48000", "-ac", "1", fullWav]);
    let cursor = 0;
    for (let k = 0; k < real.length; k++) {
      const wc = wordCounts[k];
      const first = words[Math.min(words.length - 1, cursor)];
      const last = words[Math.min(words.length - 1, cursor + wc - 1)];
      const startMs = first?.startMs ?? 0;
      const endMs = Math.max(startMs + 120, (last?.endMs ?? startMs) + 80); // tiny tail into the pause
      const fin = path.join(outDir, `${real[k].id}.wav`);
      await ffmpeg(["-ss", (startMs / 1000).toFixed(3), "-t", ((endMs - startMs) / 1000).toFixed(3), "-i", fullWav, "-ar", "48000", "-ac", "1", fin]);
      const lineWords = words.slice(cursor, cursor + wc).map((w) => ({ text: w.text, startMs: w.startMs - startMs, endMs: w.endMs - startMs }));
      const durMs = Math.round((await ffprobeDuration(fin)) * 1000);
      out.set(real[k].id, { path: fin, durMs, words: lineWords });
      cursor += wc;
    }
    console.log(`${new Date().toISOString()} [tts] one-take: sliced ${real.length} beats from a single ${(await ffprobeDuration(fullWav)).toFixed(1)}s take (${words.length} words)`);
    return out;
  } catch (e) {
    console.warn(`${new Date().toISOString()} [tts] one-take failed (${e instanceof Error ? e.message : e}) — falling back to per-line`);
    return synthesizeBatch(voiceSpec, items, outDir, opts);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
