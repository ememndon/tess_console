import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Thin wrappers around ffmpeg/ffprobe. Each call is its own process with a large
// stdout buffer; on failure we surface the tail of stderr (where ffmpeg explains).
export async function ffmpeg(args: string[]): Promise<void> {
  try {
    await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`ffmpeg failed: ${(err.stderr || err.message || "").toString().slice(-600)}`);
  }
}

export async function ffprobeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      file,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : 0;
  } catch {
    return 0;
  }
}
