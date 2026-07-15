import path from "node:path";
import fs from "node:fs/promises";
import { readCaptureBundle } from "./bundle.js";
import { composeFormat, type VEnc } from "./compose.js";
import { ffprobeDuration } from "./ffmpeg.js";

// GPU-side compose runner — the second half of the capture→compose split. Reads a
// capture bundle produced by the VPS capture-only pass and finishes ONE showcase
// section: per-scene emphasis zoompan → concat → mux the body VO → loudnorm. Runs on
// the VPS with libx264 (to prove the split) and on the rented GPU with --enc
// h264_nvenc (the heavy 4K encode on hardware). Avatar overlay + section stitch are
// separate downstream steps.
//
// Usage:
//   tsx src/compose-runner.ts <bundleDir> <outPath> [--enc libx264|h264_nvenc|hevc_nvenc]
const log = (m: string) => console.log(`${new Date().toISOString()} [compose-runner] ${m}`);

const VALID_ENC: VEnc[] = ["libx264", "h264_nvenc", "hevc_nvenc"];

async function main() {
  const argv = process.argv.slice(2);
  let enc: VEnc = "libx264";
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--enc") {
      enc = argv[++i] as VEnc;
    } else {
      positional.push(argv[i]);
    }
  }
  const [bundleDir, outPath] = positional;
  if (!bundleDir || !outPath) {
    console.error("usage: compose-runner <bundleDir> <outPath> [--enc libx264|h264_nvenc|hevc_nvenc]");
    process.exit(2);
  }
  if (!VALID_ENC.includes(enc)) {
    console.error(`invalid --enc "${enc}" (use one of: ${VALID_ENC.join(", ")})`);
    process.exit(2);
  }

  const dirAbs = path.resolve(bundleDir);
  const b = await readCaptureBundle(dirAbs);
  const workDir = path.join(dirAbs, "work");
  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });

  log(`composing ${b.fmt} — ${b.scenes.length} scenes, enc=${enc} → ${outPath}`);
  const t0 = Date.now();
  const { width, height } = await composeFormat({
    fmt: b.fmt,
    recording: b.recording,
    scenes: b.scenes,
    bodyVoPath: b.bodyVoPath,
    musicPath: "",
    introPath: "",
    outroPath: "",
    workDir,
    outAbs: path.resolve(outPath),
    bare: b.bare,
    enc,
  });
  const dur = await ffprobeDuration(path.resolve(outPath)).catch(() => -1);
  log(`done ${width}x${height}, ${dur.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outPath}`);
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}

main().catch((e) => {
  console.error("compose-runner fatal:", e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
