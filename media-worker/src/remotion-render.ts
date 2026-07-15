import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, ensureBrowser } from "@remotion/renderer";
import { CFG, FORMATS, type FormatKey } from "./config.js";
import { ffmpeg } from "./ffmpeg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(__dirname, "../remotion/index.ts");
const PUBLIC = path.resolve(__dirname, "../remotion/public");
const FPS = 60; // 60fps for buttery motion graphics (motion-blurred in the composition)

type Brand = { name: string; c1: string; c2: string; accent: string; domain: string };

// Bundle the Remotion project once per worker process (the poll loop is long-lived).
let serveUrlPromise: Promise<string> | null = null;
function getServeUrl(): Promise<string> {
  if (!serveUrlPromise) {
    serveUrlPromise = (async () => {
      await ensureBrowser();
      return bundle({ entryPoint: ENTRY, publicDir: PUBLIC });
    })();
  }
  return serveUrlPromise;
}

// Real brand logo (dropped at media/assets/brand/<site>/logo.*) as a data URI, or null.
async function logoDataUri(site: string): Promise<string | null> {
  const dir = path.join(CFG.mediaRoot, "assets", "brand", site);
  const tries: [string, string][] = [["logo.svg", "image/svg+xml"], ["logo.png", "image/png"], ["logo.webp", "image/webp"], ["logo.jpg", "image/jpeg"], ["logo.jpeg", "image/jpeg"]];
  for (const [f, mime] of tries) {
    try {
      const buf = await fs.readFile(path.join(dir, f));
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      /* next */
    }
  }
  return null;
}

// Render a Remotion-composed intro/outro for one site+format, then mux the voiceover.
// Same signature as the old renderHtmlSlide so render.ts swaps in cleanly.
export async function renderRemotionSlide(
  kind: "intro" | "outro",
  site: string,
  fmt: FormatKey,
  _brand: Brand,
  opts: { title?: string; voPath?: string; durMs: number },
  workDir: string,
  outPath: string,
): Promise<void> {
  const F = FORMATS[fmt];
  const durationInFrames = Math.max(2, Math.round((opts.durMs / 1000) * FPS));
  const serveUrl = await getServeUrl();
  const logo = await logoDataUri(site);

  const inputProps = {
    site,
    kind,
    logo,
    tagline: "",
    width: F.w,
    height: F.h,
    fps: FPS,
    durationInFrames,
  };

  const composition = await selectComposition({ serveUrl, id: "BrandSlide", inputProps });
  const silent = path.join(workDir, `remotion_${kind}_${fmt.replace(":", "x")}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: silent,
    inputProps,
    imageFormat: "jpeg",
    logLevel: "error",
    // Generous per-frame timeout headroom: the ~11s outro is 660 frames at 60fps.
    timeoutInMilliseconds: 240000,
    // Cap parallel render tabs — the motion-blur layer is memory-heavy, and too many
    // tabs on the 3-CPU/4GB worker can stall one mid-render.
    concurrency: 2,
  });

  // The Remotion mp4 already carries the timed SFX on [0:a]. Mix that UNDER the
  // voiceover [1:a] (VO dominant), and normalize to the pipeline's 60fps encode params.
  const durSec = (opts.durMs / 1000).toFixed(3);
  const audioInput = opts.voPath ? ["-i", opts.voPath] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  await ffmpeg([
    "-i", silent,
    ...audioInput,
    "-filter_complex",
    `[0:v]fps=${FPS},format=yuv420p,scale=${F.w}:${F.h}[v];` +
      // ~200ms VO lead-in so the first/last spoken word never sits on the hard segment
      // boundary (and the final loudnorm ramp happens before the word, not on it).
      `[1:a]adelay=200:all=1,apad,aresample=48000[vo];` +
      `[0:a]aresample=48000[sfx];` +
      `[vo][sfx]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "[v]", "-map", "[a]", "-t", durSec,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-ar", "48000", "-ac", "2",
    outPath,
  ]);
  await fs.rm(silent, { force: true }).catch(() => {});
}
