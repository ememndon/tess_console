import path from "node:path";
import fs from "node:fs/promises";
import { ffmpeg } from "./ffmpeg.js";
import { CFG, FORMATS, TIMING, type FormatKey } from "./config.js";
import type { BRoll } from "./types.js";

// Renders one stock-footage B-roll segment: download the clip, cover-crop it to the
// target format, color-grade, overlay the spoken caption (boxed for legibility over
// footage) + the brand domain + a tiny credit, fade in/out, and mux its voiceover.
// Mirrors slides.ts genSlide so the output concats cleanly with intro/body/outro.

const fadeAlpha = (start: number, dur: number) => `'if(lt(t,${start}),0,min(1,(t-${start})/${dur}))'`;

// Clip length from its VO (with pads), clamped so a silent/long line can't run wild.
export function brollDurMs(voDurMs: number): number {
  return Math.min(9000, Math.max(3000, (voDurMs || 0) + TIMING.prePadMs + TIMING.postPadMs));
}

async function download(url: string, dest: string): Promise<void> {
  // http(s) → fetch (stock clips). Otherwise it's a local path on the shared media
  // volume (e.g. an AI-generated b-roll image written by the app) → copy it.
  if (/^https?:\/\//i.test(url)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`broll fetch ${r.status}`);
    await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
  } else {
    await fs.copyFile(url, dest);
  }
}

export async function renderBRoll(
  clip: BRoll,
  fmt: FormatKey,
  brand: { name: string; c1: string; c2: string; accent: string; domain: string },
  vo: { voPath?: string; voDurMs: number },
  workDir: string,
  outPath: string,
): Promise<void> {
  const F = FORMATS[fmt];
  const tag = `${clip.id}_${fmt.replace(":", "x")}`;
  const durMs = brollDurMs(vo.voDurMs);
  const durSec = (durMs / 1000).toFixed(3);
  const font = CFG.captionFont;

  // Clean footage: NO burned caption and NO stock-library credit (Pexels & Pixabay
  // licenses don't require attribution) — the voiceover carries the line. Only a
  // subtle brand-domain watermark, for continuity with the intro/body/outro.
  const domFile = path.join(workDir, `broll_dom_${tag}.txt`);
  await fs.writeFile(domFile, brand.domain);
  const fsDom = Math.round(F.h * 0.026);
  const draws = [
    `drawtext=fontfile=${font}:textfile=${domFile}:fontcolor=white@0.85:fontsize=${fsDom}:x=(w-text_w)/2:y=h*0.92:shadowcolor=black@0.5:shadowx=2:shadowy=2:alpha=${fadeAlpha(0.5, 0.5)}`,
  ];
  const grade = `eq=contrast=1.06:saturation=1.12,${draws.join(",")},fade=t=in:st=0:d=0.4,fade=t=out:st=${(durMs / 1000 - 0.5).toFixed(2)}:d=0.5`;
  const audioInput = vo.voPath ? ["-i", vo.voPath] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];

  if (clip.kind === "image") {
    // Still photo → a slow Ken-Burns push-in (60fps so the zoom duration is correct).
    const dlImg = path.join(workDir, `broll_src_${tag}.jpg`);
    await download(clip.videoUrl, dlImg);
    const frames = Math.max(60, Math.round((durMs / 1000) * 60));
    // ANTI-SHAKE: zoompan computes the crop x/y by integer-truncating per frame, so on a
    // small canvas the picture visibly jitters as it zooms. Fix = upscale the source to a
    // much larger canvas (4× the output) BEFORE zoompan, then zoompan back down to output:
    // the per-frame integer rounding becomes sub-pixel after the 4× downscale, so the
    // push-in is smooth. (~13 GB RAM headroom; a 4× canvas is ~100 MB/frame.)
    const UP = 4;
    const vfImg =
      `[0:v]scale=${F.w * UP}:${F.h * UP}:force_original_aspect_ratio=increase,crop=${F.w * UP}:${F.h * UP},setsar=1,` +
      `zoompan=z='min(zoom+0.0006,1.16)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${F.w}x${F.h}:fps=60,` +
      `${grade}[v];[1:a]apad,aresample=48000[a]`;
    await ffmpeg([
      "-loop", "1", "-i", dlImg,
      ...audioInput,
      "-t", durSec,
      "-filter_complex", vfImg,
      "-map", "[v]", "-map", "[a]", "-r", "60",
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-preset", "veryfast",
      "-c:a", "aac", "-ar", "48000", "-ac", "2",
      outPath,
    ]);
    return;
  }

  // Video: cover-crop, grade, loop to fill the segment.
  const dl = path.join(workDir, `broll_src_${tag}.mp4`);
  await download(clip.videoUrl, dl);
  const vf =
    `[0:v]scale=${F.w}:${F.h}:force_original_aspect_ratio=increase,crop=${F.w}:${F.h},setsar=1,${grade}[v];` +
    `[1:a]apad,aresample=48000[a]`;
  // Optional startSec: seek into the clip so we skip an unwanted opening (e.g. a montage
  // shot that's off-brand). Applied as an input seek before -i so it's frame-accurate enough.
  const seek = typeof clip.startSec === "number" && clip.startSec > 0 ? ["-ss", clip.startSec.toFixed(2)] : [];
  await ffmpeg([
    "-stream_loop", "-1", ...seek, "-i", dl, // loop the source so a short clip fills the segment
    ...audioInput,
    "-t", durSec,
    "-filter_complex", vf,
    "-map", "[v]", "-map", "[a]",
    "-r", "60",
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-preset", "veryfast",
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    outPath,
  ]);
}
