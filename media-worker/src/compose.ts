import path from "node:path";
import fs from "node:fs/promises";
import { ffmpeg, ffprobeDuration } from "./ffmpeg.js";
import { FORMATS, TIMING, type FormatKey } from "./config.js";
import type { BBox, TimedScene } from "./types.js";

// Video encoder selection for the heavy per-scene 4K encodes. libx264 (CPU) is the
// default — every normal Demo Studio render and the VPS-side split test use it, so
// output stays byte-identical. The GPU compose-runner passes an NVENC encoder so the
// 4K zoompan/encode runs on hardware instead of the CPU that timed out at 4K. CQ ≈ CRF
// numerically (NVENC is a touch less efficient — tune per test); yuv420p everywhere.
export type VEnc = "libx264" | "h264_nvenc" | "hevc_nvenc";
export function vEncArgs(enc: VEnc, q: number, x264Preset = "veryfast"): string[] {
  if (enc === "h264_nvenc" || enc === "hevc_nvenc") {
    return ["-c:v", enc, "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", String(q), "-b:v", "0", "-pix_fmt", "yuv420p"];
  }
  return ["-c:v", "libx264", "-crf", String(q), "-preset", x264Preset, "-pix_fmt", "yuv420p"];
}

const cs = (ms: number) => {
  const t = Math.max(0, ms);
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const c = Math.floor((t % 1000) / 10);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};

// Burned-in captions as an ASS file timed to the BODY timeline (t=0 at body start).
// Kinetic style: ONE word at a time, big and centered, each word held for a slice of
// its scene's narration (weighted by word length so short words don't flash too fast).
async function buildAss(scenes: TimedScene[], fmt: FormatKey, assPath: string): Promise<void> {
  const F = FORMATS[fmt];
  const fontSize = Math.round(F.h * 0.058); // larger — a single word reads big & punchy
  const marginV = Math.round(F.h * (fmt === "9:16" ? 0.16 : 0.1));

  const head = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${F.w}`,
    `PlayResY: ${F.h}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Archivo Black,${fontSize},&H00FFFFFF,&H00202020,&H64000000,0,0,1,5,2,2,80,80,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  // Kinetic pop: quick fade + scale-up (62%→100%) as each word lands.
  const anim = "{\\fad(40,40)\\fscx62\\fscy62\\t(0,120,\\fscx100\\fscy100)}";
  const events: string[] = [];
  for (const s of scenes) {
    const text = s.say.trim();
    if (!text) continue;
    const voStart = s.startMs + TIMING.prePadMs; // when the scene's VO starts on the body timeline
    const sceneEnd = s.startMs + s.durMs;
    const emit = (start: number, end: number, raw: string) => {
      const word = raw.replace(/[{}\\]/g, "").trim();
      const e = Math.min(end, sceneEnd);
      if (word && e > start) events.push(`Dialogue: 0,${cs(start)},${cs(e)},Cap,,0,0,0,,${anim}${word}`);
    };

    // Preferred: real per-word timings from the voice engine (caption lands exactly on
    // the spoken word). Each word is held until the next one starts — no flicker gaps.
    if (s.voWords && s.voWords.length) {
      const ws = s.voWords;
      for (let j = 0; j < ws.length; j++) {
        const start = voStart + ws[j].startMs;
        const end = j < ws.length - 1 ? voStart + ws[j + 1].startMs : voStart + ws[j].endMs + 140;
        emit(start, end, ws[j].text);
      }
      continue;
    }

    // Fallback (Kokoro/Piper, or timings unavailable): spread words across the VO window,
    // weighted by length so short words don't flash too fast.
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const voDur = s.voDurMs && s.voDurMs > 0 ? s.voDurMs : Math.max(0, s.durMs - TIMING.prePadMs - TIMING.postPadMs);
    const weights = words.map((w) => w.length + 1);
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;
    let t = voStart;
    for (let j = 0; j < words.length; j++) {
      const start = t;
      const end = j === words.length - 1 ? voStart + voDur : t + (weights[j] / totalW) * voDur;
      t = Math.min(end, sceneEnd);
      emit(start, end, words[j]);
    }
  }
  await fs.writeFile(assPath, [...head, ...events].join("\n"));
}

function segVf(F: { w: number; h: number; vw: number }, focus: boolean, bbox: BBox | null, durMs: number): string {
  // The body source is now the supersampled screencast already at w×h, so scale is a
  // safety no-op. A gentle color grade (contrast + saturation) makes the captured site
  // POP on video instead of looking flat/dull, plus a light sharpen.
  const base = `scale=${F.w}:${F.h}:flags=lanczos,setsar=1,eq=contrast=1.06:saturation=1.12,unsharp=5:5:0.5:5:5:0.0`;
  if (!focus || !bbox) return base;
  const f = F.w / F.vw;
  const cx = (bbox.x + bbox.width / 2) * f;
  const cy = (bbox.y + bbox.height / 2) * f;
  // Emphasis push toward the active element. It EASES IN, HOLDS, then EASES BACK OUT to
  // 1.0 within the scene, so every segment begins AND ends at full frame — no snap/flash
  // when it cuts to the next scene (the old monotonic push ended zoomed and the next
  // scene reset to 1.0, which read as a flash). CRITICAL: upsample to 60fps BEFORE
  // zoompan (d=1 emits one output frame per INPUT frame; a 30fps source would then halve
  // the frame count vs the fps=60 tag and play the zoom at 2× speed).
  const N = Math.max(2, Math.round((durMs / 1000) * 60)); // output frames for this scene
  // Skip the zoom on SHORT scenes (< 3s of voiceover). A push-in that has to ease in,
  // hold and ease back out inside a second reads as a distracting on/off pulse — so
  // brief beats stay at full frame, and only scenes long enough to HOLD the zoom get it.
  if (N < 180) return base;
  const Z = 1.22; // peak zoom (22% — a clearly-felt push-in, held for the whole scene)
  // Short, fixed ease in/out (~0.6s each) with the ENTIRE middle held at peak, so the
  // zoom stays for as long as the voiceover is on this element (a 12s scene holds ~11s)
  // and only eases back to full frame at the very end. Every segment starts and ends at
  // 1.0, so there is no snap between scenes.
  const A = Math.min(36, Math.floor(N * 0.25)); // ease-in frames
  const B = Math.min(36, Math.floor(N * 0.25)); // ease-out frames
  const hold = N - B; // hold spans A..hold (the bulk of the scene)
  const d = (Z - 1).toFixed(4);
  const outDen = Math.max(1, N - hold);
  // Piecewise on `on` (output frame index): ramp up → hold → ramp down.
  const z = `if(lt(on,${A}),1+${d}*(on/${A}),if(lt(on,${hold}),${Z},${Z}-${d}*((on-${hold})/${outDen})))`;
  return (
    `${base},fps=60,` +
    `zoompan=z='${z}':` +
    `x='max(0,min(${cx.toFixed(1)}-(iw/zoom/2),iw-iw/zoom))':` +
    `y='max(0,min(${cy.toFixed(1)}-(ih/zoom/2),ih-ih/zoom))':` +
    `d=1:s=${F.w}x${F.h}:fps=60`
  );
}

// Cross-dissolve duration between timeline blocks (intro/B-roll/body/outro).
const XFADE_SEC = 0.35;

// Assemble an ordered list of finished blocks (each video+audio, same w×h) into one
// clip with smooth cross-dissolves between them. xfade needs per-block durations and
// cumulative offsets; audio uses acrossfade (same overlap, so A/V stay in sync). Any
// failure falls back to the proven hard concat, so a render never fails on transitions.
async function assembleBlocks(blocks: string[], outPath: string): Promise<void> {
  const inputs = blocks.flatMap((b) => ["-i", b]);
  try {
    if (blocks.length < 2) throw new Error("single block");
    const durs = await Promise.all(blocks.map((b) => ffprobeDuration(b)));
    if (durs.some((d) => !Number.isFinite(d) || d <= XFADE_SEC * 2)) throw new Error("block too short to fade");
    const norm: string[] = [];
    blocks.forEach((_, i) => {
      norm.push(`[${i}:v]fps=60,format=yuv420p,setsar=1[v${i}]`);
      norm.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    });
    const chain: string[] = [];
    let vcur = "v0";
    let acur = "a0";
    let cum = durs[0];
    for (let k = 1; k < blocks.length; k++) {
      const last = k === blocks.length - 1;
      const vout = last ? "vf" : `vx${k}`;
      const aout = last ? "af" : `ax${k}`;
      chain.push(`[${vcur}][v${k}]xfade=transition=fade:duration=${XFADE_SEC}:offset=${(cum - XFADE_SEC).toFixed(3)}[${vout}]`);
      chain.push(`[${acur}][a${k}]acrossfade=d=${XFADE_SEC}[${aout}]`);
      vcur = vout;
      acur = aout;
      cum = cum + durs[k] - XFADE_SEC;
    }
    await ffmpeg([
      ...inputs, "-filter_complex", [...norm, ...chain].join(";"),
      "-map", "[vf]", "-map", "[af]", "-r", "60",
      "-c:v", "libx264", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", outPath,
    ]);
  } catch {
    const normV = blocks.map((_, i) => `[${i}:v]fps=60[v${i}]`).join(";");
    const concatIns = blocks.map((_, i) => `[v${i}][${i}:a]`).join("");
    await ffmpeg([
      ...inputs, "-filter_complex", `${normV};${concatIns}concat=n=${blocks.length}:v=1:a=1[v][a]`,
      "-map", "[v]", "-map", "[a]", "-r", "60",
      "-c:v", "libx264", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", outPath,
    ]);
  }
}

// Compose one final video for a format: cut the recording into scene segments (each
// reframed + element-zoomed), concat, burn captions, mux the body VO, sandwich the
// branded intro/outro, then mix the ducked music bed and normalize loudness.
export async function composeFormat(args: {
  fmt: FormatKey;
  recording: { videoPath: string; offsetMs: number; bboxes: (BBox | null)[]; srcOffsetsMs?: number[] };
  scenes: TimedScene[];
  bodyVoPath: string;
  musicPath: string;
  introPath: string;
  outroPath: string;
  preBodyClips?: string[]; // stock B-roll between intro and the demo body
  postBodyClips?: string[]; // stock B-roll between the demo body and outro
  workDir: string;
  outAbs: string;
  // Console-showcase sections: body + VO only — no intro/outro, no burned captions,
  // no music, no end fade. Sections are stitched (with the avatar) downstream.
  bare?: boolean;
  // Encoder for the heavy 4K per-scene encodes. Defaults to libx264 (CPU); the GPU
  // compose-runner passes h264_nvenc. Only affects the bare/showcase path.
  enc?: VEnc;
}): Promise<{ width: number; height: number }> {
  const F = FORMATS[args.fmt];
  const enc = args.enc ?? "libx264";
  const tag = args.fmt.replace(":", "x");
  const segDir = path.join(args.workDir, `seg_${tag}`);
  await fs.mkdir(segDir, { recursive: true });

  // 1) Per-scene segments.
  const segFiles: string[] = [];
  for (let i = 0; i < args.scenes.length; i++) {
    const sc = args.scenes[i];
    // Cut from where the scene ACTUALLY is in the recording (drift-corrected), falling
    // back to the planned offset if timestamps are unavailable.
    const srcMs = args.recording.srcOffsetsMs?.[i] ?? args.recording.offsetMs + sc.startMs;
    const startSec = (srcMs / 1000).toFixed(3);
    const durSec = (sc.durMs / 1000).toFixed(3);
    const seg = path.join(segDir, `s${i}.mp4`);
    // Showcase (bare) tours render at a FIXED frame: no emphasis push-in, ever. The
    // console tour composites a talking-head circle into the sidebar gap under
    // "Tess (Agent)" in post, and that gap only holds still if the frame never scales.
    // Owner decision, 2026-07-10. Beat maps still carry `focus` because the recorder
    // uses it to pick a scroll/centre target; only the zoom is suppressed.
    const vf = segVf(F, args.bare ? false : sc.focus, args.recording.bboxes[i] ?? null, sc.durMs);
    // NOTE: -ss/-t come AFTER -i on purpose (output seek). ffmpeg then decodes from the
    // top of the file and runs every frame through the filtergraph, so zoompan's `on`
    // counter is already in the thousands by the time this scene's frames arrive. Its
    // ease curve goes negative, zoom clamps to 1.0, and the push-in never renders — which
    // is why no showcase section has ever zoomed. Moving -ss before -i (input seek) turns
    // the zoom back ON for every focus:true beat. That is NOT wanted: see segVf above.
    // If you move it, suppress the zoom explicitly or you will silently change 18 videos.
    try {
      await ffmpeg([
        "-i", args.recording.videoPath, "-ss", startSec, "-t", durSec,
        "-vf", vf, "-an", "-r", "60",
        ...vEncArgs(enc, 18), seg,
      ]);
    } catch {
      // Fall back to a plain reframe if the zoom expression upset ffmpeg.
      await ffmpeg([
        "-i", args.recording.videoPath, "-ss", startSec, "-t", durSec,
        "-vf", `scale=${F.w}:${F.h}:flags=lanczos,setsar=1`, "-an", "-r", "60",
        ...vEncArgs(enc, 18), seg,
      ]);
    }
    segFiles.push(seg);
  }

  // 2) Concat segments → body video.
  const listPath = path.join(segDir, "list.txt");
  await fs.writeFile(listPath, segFiles.map((f) => `file '${f}'`).join("\n"));
  const bodyV = path.join(segDir, "bodyV.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", bodyV]);

  // 3) Burn captions (skipped in bare mode — a long tutorial reads better without
  // kinetic captions, and the GPU stitch adds its own lower-thirds if wanted).
  const bodyCap = path.join(segDir, "bodyCap.mp4");
  if (args.bare) {
    await fs.copyFile(bodyV, bodyCap);
  } else {
    const assPath = path.join(segDir, "caps.ass");
    await buildAss(args.scenes, args.fmt, assPath);
    try {
      await ffmpeg(["-i", bodyV, "-vf", `ass=${assPath}`, "-an", "-r", "60", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", bodyCap]);
    } catch {
      await fs.copyFile(bodyV, bodyCap); // captions are nice-to-have; never fail the render on them
    }
  }

  // 4) Mux body VO. NO-CUTOFF GUARANTEE: if the voiceover runs longer than the cut
  // footage (a long final line, drift, etc.), hold the last frame so the body covers
  // the FULL narration — the speech is never truncated at the body→outro hand-off.
  const body = path.join(segDir, "body.mp4");
  const voLen = await ffprobeDuration(args.bodyVoPath);
  const vidLen = await ffprobeDuration(bodyCap);
  let bodyVid = bodyCap;
  if (voLen > vidLen + 0.05) {
    bodyVid = path.join(segDir, "bodyFit.mp4");
    await ffmpeg([
      "-i", bodyCap, "-vf", `tpad=stop_mode=clone:stop_duration=${(voLen - vidLen + 0.15).toFixed(3)}`,
      "-an", "-r", "60", ...vEncArgs(enc, 18), bodyVid,
    ]);
    console.log(`[compose ${args.fmt}] held last frame +${(voLen - vidLen).toFixed(2)}s so the voiceover is not cut`);
  }
  // No -shortest: let the (now ≥ VO) video define the length, so the full VO plays.
  await ffmpeg(["-i", bodyVid, "-i", args.bodyVoPath, "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", body]);

  // 5) Assemble the ordered timeline: intro → [B-roll] → demo body → [B-roll] →
  // outro. With no B-roll this is exactly the legacy 3-way intro+body+outro concat.
  // Every block carries video+audio, so the concat filter is uniform.
  // Bare mode: the body IS the deliverable — normalize loudness and ship it (no
  // slides, no music, no end fade; sections get stitched downstream).
  if (args.bare) {
    await fs.mkdir(path.dirname(args.outAbs), { recursive: true });
    await ffmpeg([
      "-i", body, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", args.outAbs,
    ]);
    return { width: F.w, height: F.h };
  }
  const blocks = [args.introPath, ...(args.preBodyClips ?? []), body, ...(args.postBodyClips ?? []), args.outroPath];
  const combined = path.join(segDir, "combined.mp4");
  await assembleBlocks(blocks, combined);

  // 6) Music bed (ducked) + loudness. No track → loudnorm only. Falls back to
  // loudnorm-only if the mix errors.
  const total = (await ffprobeDuration(combined)).toFixed(3);
  // Gently fade the audio (the music bed, mainly) out over the last 2.5s as the outro ends.
  const fadeSt = Math.max(0, parseFloat(total) - 2.5).toFixed(2);
  await fs.mkdir(path.dirname(args.outAbs), { recursive: true });
  try {
    if (!args.musicPath) throw new Error("no music selected");
    await ffmpeg([
      "-i", combined, "-stream_loop", "-1", "-i", args.musicPath,
      "-filter_complex",
      // Music sits clearly under the voice, ducking gently when the voice speaks.
      // Both sidechain inputs MUST share sample format/rate/layout (aformat) or
      // sidechaincompress fails to negotiate; the voice is asplit so it can be both the
      // duck key and a mix input.
      // Music is a SUBTLE bed (0.12) that ducks HARD under the voice (ratio 14, low
      // threshold) so the voiceover always sits clearly on top — the bed only rises in
      // the gaps. (Was 0.28/ratio 8, which let the music overpower the narration.)
      "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=2[vkey][vmix];" +
        "[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=0.12[mraw];" +
        "[mraw][vkey]sidechaincompress=threshold=0.02:ratio=14:attack=5:release=320[mduck];" +
        `[vmix][mduck]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11,afade=t=out:st=${fadeSt}:d=2.5[a]`,
      "-map", "0:v", "-map", "[a]", "-t", total,
      "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", args.outAbs,
    ]);
  } catch {
    await ffmpeg([
      "-i", combined, "-af", `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${fadeSt}:d=2.5`,
      "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", args.outAbs,
    ]);
  }

  return { width: F.w, height: F.h };
}
