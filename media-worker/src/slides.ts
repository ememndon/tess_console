import path from "node:path";
import fs from "node:fs/promises";
import { ffmpeg } from "./ffmpeg.js";
import { CFG, FORMATS, type FormatKey } from "./config.js";

// drawtext alpha expression: 0 until `start`s, then ramps to 1 over `dur`s.
const fadeAlpha = (start: number, dur: number) => `'if(lt(t,${start}),0,min(1,(t-${start})/${dur}))'`;
// 0→1 ramp (unquoted; used inside a larger quoted expression).
const ramp = (start: number, dur: number) => `min(1,max(0,(t-${start})/${dur}))`;

function wrap(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

// Branded intro/outro clip at the target resolution, with its own voiceover muxed in.
// Text is written to files and pulled in via drawtext textfile= to dodge ffmpeg's
// brutal inline-escaping rules. Audio is always present so the later concat is clean.
export async function genSlide(
  kind: "intro" | "outro",
  fmt: FormatKey,
  brand: { name: string; c1: string; c2: string; accent: string; domain: string },
  opts: { title?: string; voPath?: string; durMs: number },
  workDir: string,
  outPath: string,
): Promise<void> {
  const F = FORMATS[fmt];
  const durSec = (opts.durMs / 1000).toFixed(3);
  const color = kind === "intro" ? brand.c1 : brand.c2;
  const font = CFG.captionFont;

  const bigText = kind === "intro" ? wrap(opts.title || brand.name, 18) : brand.name;
  const topText = kind === "intro" ? brand.name : "";
  const subText = kind === "intro" ? "" : "Try it free today";

  const bigFile = path.join(workDir, `slide_${kind}_${fmt.replace(":", "x")}_big.txt`);
  const domFile = path.join(workDir, `slide_${kind}_${fmt.replace(":", "x")}_dom.txt`);
  await fs.writeFile(bigFile, bigText);
  await fs.writeFile(domFile, brand.domain);

  const fsBig = Math.round(F.h * (kind === "intro" ? 0.062 : 0.082));
  const fsDom = Math.round(F.h * 0.03);
  const fsTop = Math.round(F.h * 0.034);
  const fsSub = Math.round(F.h * 0.036);

  const draws: string[] = [];
  if (topText) {
    const topFile = path.join(workDir, `slide_${kind}_${fmt.replace(":", "x")}_top.txt`);
    await fs.writeFile(topFile, topText);
    draws.push(`drawtext=fontfile=${font}:textfile=${topFile}:fontcolor=${hex(brand.accent)}:fontsize=${fsTop}:x=(w-text_w)/2:y=h*0.16:alpha=${fadeAlpha(0.2, 0.6)}`);
  }
  // Big title fades in AND rises a few px as it appears (subtle motion-graphics feel).
  const riseY = `'(h-text_h)/2 + ${Math.round(F.h * 0.03)}*(1-${ramp(0.45, 0.6)})'`;
  draws.push(
    `drawtext=fontfile=${font}:textfile=${bigFile}:fontcolor=white:fontsize=${fsBig}:line_spacing=14:x=(w-text_w)/2:y=${riseY}:alpha=${fadeAlpha(0.45, 0.6)}`,
  );
  if (subText) {
    const subFile = path.join(workDir, `slide_${kind}_${fmt.replace(":", "x")}_sub.txt`);
    await fs.writeFile(subFile, subText);
    draws.push(`drawtext=fontfile=${font}:textfile=${subFile}:fontcolor=${hex(brand.accent)}:fontsize=${fsSub}:x=(w-text_w)/2:y=h*0.62:alpha=${fadeAlpha(0.8, 0.5)}`);
  }
  draws.push(`drawtext=fontfile=${font}:textfile=${domFile}:fontcolor=white@0.9:fontsize=${fsDom}:x=(w-text_w)/2:y=h*0.85:alpha=${fadeAlpha(0.9, 0.5)}`);

  // Slow push-in on the whole card + a clean fade out at the end.
  const motion =
    `zoompan=z='min(zoom+0.0007,1.08)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${F.w}x${F.h}:fps=30,` +
    `fade=t=in:st=0:d=0.4,fade=t=out:st=${(opts.durMs / 1000 - 0.5).toFixed(2)}:d=0.5`;

  const audioInput = opts.voPath ? ["-i", opts.voPath] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];

  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=${color}:s=${F.w}x${F.h}:r=30:d=${durSec}`,
    ...audioInput,
    "-filter_complex", `[0:v]${draws.join(",")},${motion}[v];[1:a]apad,aresample=48000[a]`,
    "-map", "[v]", "-map", "[a]",
    "-t", durSec,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-ar", "48000", "-ac", "2",
    outPath,
  ]);
}

// ffmpeg color= wants 0xRRGGBB or a name; convert "#RRGGBB" → "0xRRGGBB".
function hex(c: string): string {
  return c.startsWith("#") ? `0x${c.slice(1)}` : c;
}
