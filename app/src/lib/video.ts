import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import { MEDIA_ROOT } from "./banner";

const exec = promisify(execFile);

// Templated video engine: renders short branded videos on the VPS
// (free, unlimited) — brand-styled slides composed by sharp, assembled by ffmpeg.
// Data-driven (e.g. CheckInvest "today's rates"); numbers are injected, never
// invented. Stock footage / TTS / crossfades are later enhancements.

const BRAND: Record<string, { name: string; c1: string; c2: string; accent: string; domain: string }> = {
  calculatry: { name: "Calculatry", c1: "#1E3A8A", c2: "#2563EB", accent: "#93C5FD", domain: "calculatry.com" },
  resumehub: { name: "GlobalResumeHub", c1: "#4C1D95", c2: "#7C3AED", accent: "#C4B5FD", domain: "globalresumehub.com" },
  checkinvest: { name: "CheckInvest", c1: "#134E4A", c2: "#0D9488", accent: "#5EEAD4", domain: "checkinvestng.com" },
};
const FONT = "DejaVu Sans, sans-serif";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) (lines.push(cur), (cur = w));
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

export type VideoSpec = {
  site: string;
  title: string;
  badge?: string;
  dataLines?: { label: string; value: string }[];
  hashtags?: string[];
};

const W = 1080;
const H = 1080;

function frame(site: string, inner: string): string {
  const b = BRAND[site] ?? BRAND.calculatry;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${b.c1}"/><stop offset="1" stop-color="${b.c2}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="900" cy="180" r="340" fill="#FFFFFF" opacity="0.06"/>
    <circle cx="180" cy="940" r="240" fill="#FFFFFF" opacity="0.05"/>
    <text x="64" y="92" font-family="${FONT}" font-size="34" font-weight="700" fill="#FFFFFF">${esc(b.name)}</text>
    ${inner}
    <text x="64" y="1010" font-family="${FONT}" font-size="30" font-weight="700" fill="#FFFFFF">${esc(b.domain)}</text>
  </svg>`;
}

function titleSlide(spec: VideoSpec): string {
  const b = BRAND[spec.site] ?? BRAND.calculatry;
  const lines = wrap(spec.title, 18).slice(0, 4);
  const startY = 520 - (lines.length - 1) * 42;
  const spans = lines.map((l, i) => `<tspan x="64" dy="${i === 0 ? 0 : 84}">${esc(l)}</tspan>`).join("");
  const badge = spec.badge
    ? `<g transform="translate(64,300)"><rect rx="20" width="${Math.min(640, 30 + spec.badge.length * 15)}" height="46" fill="#FFFFFF" opacity="0.15"/><text x="20" y="31" font-family="${FONT}" font-size="24" fill="${b.accent}">${esc(spec.badge)}</text></g>`
    : "";
  return frame(spec.site, `${badge}<text y="${startY}" font-family="${FONT}" font-size="76" font-weight="800" fill="#FFFFFF">${spans}</text>`);
}

function dataSlide(spec: VideoSpec): string {
  const b = BRAND[spec.site] ?? BRAND.calculatry;
  const rows = (spec.dataLines ?? [])
    .slice(0, 5)
    .map(
      (d, i) => `<g transform="translate(64,${340 + i * 110})">
        <text x="0" y="0" font-family="${FONT}" font-size="44" fill="${b.accent}">${esc(d.label)}</text>
        <text x="952" y="0" text-anchor="end" font-family="${FONT}" font-size="56" font-weight="800" fill="#FFFFFF">${esc(d.value)}</text>
      </g>`,
    )
    .join("");
  return frame(spec.site, `<text x="64" y="240" font-family="${FONT}" font-size="40" fill="#E5E7EB">${esc(spec.title)}</text>${rows}`);
}

function outroSlide(spec: VideoSpec): string {
  const b = BRAND[spec.site] ?? BRAND.calculatry;
  const tags = spec.hashtags?.length
    ? `<text x="64" y="640" font-family="${FONT}" font-size="34" fill="${b.accent}">${esc(spec.hashtags.slice(0, 4).join("  "))}</text>`
    : "";
  return frame(
    spec.site,
    `<text x="64" y="540" font-family="${FONT}" font-size="72" font-weight="800" fill="#FFFFFF">${esc(b.name)}</text>${tags}`,
  );
}

export async function renderVideo(
  id: string,
  spec: VideoSpec,
): Promise<{ path: string; relPath: string; width: number; height: number; durationSec: number }> {
  const slides = [titleSlide(spec)];
  if (spec.dataLines?.length) slides.push(dataSlide(spec));
  slides.push(outroSlide(spec));

  const work = path.join(MEDIA_ROOT, "videos", spec.site, `${id}_frames`);
  await fs.mkdir(work, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const f = path.join(work, `s${i}.png`);
    await sharp(Buffer.from(slides[i])).png().toFile(f);
    files.push(f);
  }

  const per = 3; // seconds per slide
  const lines: string[] = [];
  for (const f of files) {
    lines.push(`file '${f}'`);
    lines.push(`duration ${per}`);
  }
  lines.push(`file '${files[files.length - 1]}'`); // concat demuxer needs the last repeated
  const listPath = path.join(work, "list.txt");
  await fs.writeFile(listPath, lines.join("\n"));

  const outDir = path.join(MEDIA_ROOT, "videos", spec.site);
  await fs.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${id}.mp4`);
  await exec("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-vf", "fps=30,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-movflags", "+faststart",
    out,
  ]);
  await fs.rm(work, { recursive: true, force: true });

  return { path: out, relPath: path.relative(MEDIA_ROOT, out), width: W, height: H, durationSec: per * files.length };
}
