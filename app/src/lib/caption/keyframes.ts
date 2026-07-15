import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

// ffmpeg/ffprobe live in the app image (used by the video pipeline). We read the
// EXISTING file on the shared media volume — no copy, no re-upload — and pull a
// few evenly-spaced frames so a vision model can "watch" the clip.

async function probeDuration(absPath: string): Promise<number> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      absPath,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

// Extract a single frame at `t` seconds, downscaled to 512px wide, as a JPEG
// buffer. Downscaling keeps the base64 payload small for the vision endpoint.
async function frameAt(absPath: string, t: number): Promise<Buffer | null> {
  try {
    const { stdout } = await run(
      "ffmpeg",
      [
        "-ss", t.toFixed(2),
        "-i", absPath,
        "-frames:v", "1",
        "-vf", "scale=512:-1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 12 * 1024 * 1024 },
    );
    const buf = stdout as unknown as Buffer;
    return buf && buf.length ? buf : null;
  } catch {
    return null;
  }
}

// Sample up to `n` keyframes from a video file and return them as data URLs ready
// for an OpenAI-style vision message. Empty array if the file can't be read.
export async function sampleKeyframes(absPath: string, n = 5): Promise<string[]> {
  const duration = await probeDuration(absPath);
  // Pick timestamps inside the clip (skip the very start/end which are often
  // black intro/outro frames). If duration is unknown, grab a few early frames.
  const times: number[] = [];
  if (duration > 0) {
    for (let i = 0; i < n; i++) {
      times.push(((i + 1) / (n + 1)) * duration);
    }
  } else {
    for (let i = 0; i < n; i++) times.push(i * 1.5);
  }

  const frames = await Promise.all(times.map((t) => frameAt(absPath, t)));
  return frames
    .filter((b): b is Buffer => !!b)
    .map((b) => `data:image/jpeg;base64,${b.toString("base64")}`);
}
