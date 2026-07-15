import type { NextRequest } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { requireOperator } from "@/lib/auth";
import { runCaptionStudio } from "@/lib/caption/studio";
import { CAPTION_PLATFORMS, type CaptionPlatform, type CaptionTone } from "@/lib/caption-platforms";

// Off-queue uploads for Caption Studio: an image still or a raw video file that
// isn't already a post. (In-queue media is read by Post ID with no upload.) Image
// → data URL; video → temp file, sample keyframes, then delete. Session-gated.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = { kind: "image" | "video"; site: string; note?: string; platforms: string[]; tone?: CaptionTone; locale?: string };

const bad = (error: string, status = 400) => Response.json({ ok: false, results: [], error }, { status });

export async function POST(req: NextRequest) {
  if (!(await requireOperator())) return new Response("forbidden", { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return bad("Expected a multipart form.");
  const payloadRaw = form.get("payload");
  const file = form.get("file");
  if (typeof payloadRaw !== "string" || !(file instanceof File)) return bad("Missing file or payload.");

  let payload: Payload;
  try {
    payload = JSON.parse(payloadRaw) as Payload;
  } catch {
    return bad("Bad payload JSON.");
  }
  if (!payload.site) return bad("Missing site.");
  const platforms = (payload.platforms ?? []).filter((p): p is CaptionPlatform => (CAPTION_PLATFORMS as readonly string[]).includes(p));
  if (!platforms.length) return bad("Pick at least one platform.");

  const buf = Buffer.from(await file.arrayBuffer());

  if (payload.kind === "image") {
    const mime = file.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    const out = await runCaptionStudio({
      source: { kind: "image", site: payload.site, imageDataUrl: dataUrl, note: payload.note },
      platforms,
      tone: payload.tone,
      locale: payload.locale,
    });
    return Response.json(out);
  }

  // video: persist to a temp file so ffmpeg can read it, then clean up
  const safeName = (file.name || "clip").replace(/[^a-zA-Z0-9._-]/g, "");
  const tmp = path.join(os.tmpdir(), `cap-${crypto.randomBytes(6).toString("hex")}-${safeName}`);
  try {
    await fs.writeFile(tmp, buf);
    const out = await runCaptionStudio({
      source: { kind: "video", site: payload.site, videoPath: tmp, note: payload.note },
      platforms,
      tone: payload.tone,
      locale: payload.locale,
    });
    return Response.json(out);
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}
