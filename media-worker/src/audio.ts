import path from "node:path";
import fs from "node:fs/promises";
import { ffmpeg } from "./ffmpeg.js";
import { CFG, TIMING } from "./config.js";
import type { TimedScene } from "./types.js";

// Assemble the body voiceover track: each scene's mastered narration is delayed to
// its absolute position on a silent bed exactly as long as the body. Because the
// scene timeline is shared across formats, this single track aligns in all three.
export async function buildBodyVo(scenes: TimedScene[], totalBodyMs: number, outPath: string): Promise<void> {
  const withVo = scenes.filter((s) => s.voPath);
  const totalSec = (totalBodyMs / 1000).toFixed(3);

  if (withVo.length === 0) {
    await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", totalSec, "-c:a", "pcm_s16le", outPath]);
    return;
  }

  const inputs: string[] = [];
  const parts: string[] = [];
  withVo.forEach((s, i) => {
    inputs.push("-i", s.voPath!);
    const delay = Math.max(0, s.startMs + TIMING.prePadMs);
    parts.push(`[${i}]adelay=${delay}:all=1[a${i}]`);
  });
  const mixIns = withVo.map((_, i) => `[a${i}]`).join("");
  // apad pads UP TO the body length (min), but we do NOT cap with -t: if the last
  // line's audio runs slightly past the planned body end, the track keeps its full
  // natural length so the voiceover is NEVER truncated (compose extends the video to
  // match). This is the core "no cut-off" guarantee.
  const graph = `${parts.join(";")};${mixIns}amix=inputs=${withVo.length}:normalize=0:dropout_transition=0,apad=whole_dur=${totalSec}[m]`;

  await ffmpeg([...inputs, "-filter_complex", graph, "-map", "[m]", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", outPath]);
}

// Resolve the music bed for a job based on the admin's choice:
//   "none"      → no music (returns "")
//   "auto"      → first real track in media/assets/music, else a synthesized pad
//   "<filename>"→ that specific track in media/assets/music (falls back to auto)
// Whatever is returned is mixed in low and ducked under the voice in compose.
export async function resolveMusic(choice: string, totalSec: number, outPath: string): Promise<string> {
  const c = (choice || "auto").trim();
  if (c.toLowerCase() === "none") return "";

  const dir = path.join(CFG.mediaRoot, "assets", "music");
  const isAudio = (f: string) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f);

  // Specific track requested.
  if (c.toLowerCase() !== "auto") {
    const p = path.join(dir, c);
    if (await exists(p)) return p;
  }
  // Auto / fallback: pick a RANDOM track from the library so videos vary across the bed
  // collection instead of always using the alphabetically-first one.
  try {
    const files = (await fs.readdir(dir)).filter(isAudio);
    if (files.length) return path.join(dir, files[Math.floor(Math.random() * files.length)]);
  } catch {
    /* no library — synthesize a pad below */
  }

  // Soft A-major pad: three detuned sines, slow tremolo, mellow low-pass, light room.
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000",
    "-f", "lavfi", "-i", "sine=frequency=277.18:sample_rate=48000",
    "-f", "lavfi", "-i", "sine=frequency=329.63:sample_rate=48000",
    "-filter_complex",
    "[0][1][2]amix=inputs=3:normalize=0,tremolo=f=0.2:d=0.6,lowpass=f=950,aecho=0.8:0.85:900:0.3,volume=0.9,aresample=48000[m]",
    "-map", "[m]", "-t", totalSec.toFixed(3), "-ac", "2", "-c:a", "pcm_s16le", outPath,
  ]);
  return outPath;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
