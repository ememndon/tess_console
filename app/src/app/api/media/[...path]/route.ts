import type { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { MEDIA_ROOT } from "@/lib/banner";

// Serves generated media (banners/videos, handoff files) behind the console
// login. Used by <img> previews and download links.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const { path: parts } = await ctx.params;
  const rel = parts.join("/");
  if (rel.includes("..") || path.isAbsolute(rel)) return new Response("bad path", { status: 400 });

  const file = path.join(MEDIA_ROOT, rel);
  try {
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] ?? "application/octet-stream";
    const size = (await fs.stat(file)).size;

    // Range support: <video>/<audio> elements send `Range: bytes=start-end` and the
    // Chromium media stack STALLS (readyState 0, never plays) if the server answers
    // 200 with no Accept-Ranges instead of 206. Serving byte ranges also gives the
    // browser progressive playback + seeking instead of buffering the whole file first.
    const range = req.headers.get("range");
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (m) {
      let start = m[1] === "" ? 0 : parseInt(m[1], 10);
      let end = m[2] === "" ? size - 1 : parseInt(m[2], 10);
      // suffix range "bytes=-N" → last N bytes
      if (m[1] === "" && m[2] !== "") { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
      end = Math.min(end, size - 1);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response("range not satisfiable", { status: 416, headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" } });
      }
      const len = end - start + 1;
      const fh = await fs.open(file, "r");
      try {
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, start);
        return new Response(new Uint8Array(buf), {
          status: 206,
          headers: {
            "content-type": type,
            "content-length": String(len),
            "content-range": `bytes ${start}-${end}/${size}`,
            "accept-ranges": "bytes",
            "cache-control": "private, max-age=60",
          },
        });
      } finally {
        await fh.close();
      }
    }

    // No range: full file, but advertise range support + length so the player can seek.
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": type,
        "content-length": String(size),
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=60",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
