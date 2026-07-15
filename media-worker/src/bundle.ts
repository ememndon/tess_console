import path from "node:path";
import fs from "node:fs/promises";
import type { BBox, TimedScene } from "./types.js";
import type { FormatKey } from "./config.js";
import type { RecordResult } from "./recorder.js";

const log = (m: string) => console.log(`${new Date().toISOString()} [bundle] ${m}`);

// The portable capture bundle: everything the compose-runner needs to finish a
// showcase section on ANOTHER machine (a rented GPU), with no dependency on this
// job's /tmp workDir. Produced by the VPS capture-only pass, shipped to the GPU.
//   body.mp4   — the near-lossless 4K body mezzanine (crf16 assembly of the frames)
//   bodyVo.wav — the muxed body narration (defines the section's audio + length)
//   meta.json  — scene timeline + drift-corrected per-scene cut offsets + zoom boxes
export type CaptureMeta = {
  version: 1;
  fmt: FormatKey;
  site: string;
  jobId: string;
  bare: boolean;
  body: string; // filename within the bundle dir
  bodyVo: string; // filename within the bundle dir
  recording: { offsetMs: number; bboxes: (BBox | null)[]; srcOffsetsMs: number[] };
  // Only the fields composeFormat actually reads — kept small + machine-portable.
  scenes: Pick<TimedScene, "id" | "action" | "focus" | "startMs" | "durMs" | "say" | "voDurMs" | "voWords">[];
};

// Write the bundle under <mediaRoot>/showcase-capture/<jobId>/<fmt>/ and return the
// absolute dir + its media-relative path (for the job's media list).
export async function writeCaptureBundle(args: {
  mediaRoot: string;
  site: string;
  jobId: string;
  fmt: FormatKey;
  recording: RecordResult;
  scenes: TimedScene[];
  bodyVoPath: string;
  bare: boolean;
}): Promise<{ dirAbs: string; relDir: string }> {
  const tag = args.fmt.replace(":", "x");
  const relDir = path.posix.join("showcase-capture", args.jobId, tag);
  const dirAbs = path.join(args.mediaRoot, relDir);
  await fs.mkdir(dirAbs, { recursive: true });

  await fs.copyFile(args.recording.videoPath, path.join(dirAbs, "body.mp4"));
  await fs.copyFile(args.bodyVoPath, path.join(dirAbs, "bodyVo.wav"));

  const meta: CaptureMeta = {
    version: 1,
    fmt: args.fmt,
    site: args.site,
    jobId: args.jobId,
    bare: args.bare,
    body: "body.mp4",
    bodyVo: "bodyVo.wav",
    recording: {
      offsetMs: args.recording.offsetMs,
      bboxes: args.recording.bboxes,
      srcOffsetsMs: args.recording.srcOffsetsMs,
    },
    scenes: args.scenes.map((s) => ({
      id: s.id,
      action: s.action,
      focus: s.focus,
      startMs: s.startMs,
      durMs: s.durMs,
      say: s.say,
      voDurMs: s.voDurMs,
      voWords: s.voWords,
    })),
  };
  await fs.writeFile(path.join(dirAbs, "meta.json"), JSON.stringify(meta, null, 2));
  log(`wrote capture bundle ${relDir} (${meta.scenes.length} scenes)`);
  return { dirAbs, relDir };
}

// Read a bundle dir back into composeFormat-ready inputs. All paths resolve against
// the bundle dir, so it works wherever the bundle was shipped to.
export async function readCaptureBundle(dirAbs: string): Promise<{
  fmt: FormatKey;
  bare: boolean;
  scenes: TimedScene[];
  bodyVoPath: string;
  recording: { videoPath: string; offsetMs: number; bboxes: (BBox | null)[]; srcOffsetsMs: number[] };
}> {
  const meta = JSON.parse(await fs.readFile(path.join(dirAbs, "meta.json"), "utf8")) as CaptureMeta;
  // Rehydrate to TimedScene. Fields composeFormat never reads on this path (target,
  // settleMs, voPath) are filled with harmless defaults.
  const scenes = meta.scenes.map((s) => ({
    ...s,
    target: undefined,
    settleMs: 0,
    voPath: undefined,
  })) as unknown as TimedScene[];
  return {
    fmt: meta.fmt,
    bare: meta.bare,
    scenes,
    bodyVoPath: path.join(dirAbs, meta.bodyVo),
    recording: {
      videoPath: path.join(dirAbs, meta.body),
      offsetMs: meta.recording.offsetMs,
      bboxes: meta.recording.bboxes,
      srcOffsetsMs: meta.recording.srcOffsetsMs,
    },
  };
}
