import path from "node:path";
import { chromium } from "playwright";
import { FORMATS, type FormatKey } from "./config.js";
import { ffmpeg } from "./ffmpeg.js";
import { hasHtmlIntro, introHtml, outroHtml } from "./brand-intro.js";

export { hasHtmlIntro };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Brand = { name: string; c1: string; c2: string; accent: string; domain: string };

// Render an animated HTML/CSS brand intro/outro in the browser at native resolution,
// record it, then mux the voiceover. A black fade-in masks the pre-paint frame and
// gives a clean cinematic start; a fade-out closes it.
export async function renderHtmlSlide(
  kind: "intro" | "outro",
  site: string,
  fmt: FormatKey,
  brand: Brand,
  opts: { title?: string; voPath?: string; durMs: number },
  workDir: string,
  outPath: string,
): Promise<void> {
  const F = FORMATS[fmt];
  const html = kind === "intro" ? await introHtml(site, brand, opts.title ?? "") : await outroHtml(site, brand);
  const videoDir = path.join(workDir, `htmlslide_${kind}_${fmt.replace(":", "x")}`);

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: F.w, height: F.h },
    deviceScaleFactor: 1,
    recordVideo: { dir: videoDir, size: { width: F.w, height: F.h } },
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready).catch(() => {});
    await sleep(opts.durMs + 500);
    await context.close();
    const webm = await video!.path();
    await browser.close();

    const durSec = (opts.durMs / 1000).toFixed(2);
    const audioInput = opts.voPath ? ["-i", opts.voPath] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
    await ffmpeg([
      "-i", webm, ...audioInput,
      "-filter_complex",
      `[0:v]scale=${F.w}:${F.h},fps=30,format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st=${(opts.durMs / 1000 - 0.5).toFixed(2)}:d=0.5[v];[1:a]apad,aresample=48000[a]`,
      "-map", "[v]", "-map", "[a]", "-t", durSec,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-ar", "48000", "-ac", "2",
      outPath,
    ]);
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}
