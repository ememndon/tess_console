import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { enqueueDemoJob } from "@/lib/demo/enqueue";

// Enqueue a specific demo recipe for rendering (writes the brand-voice script via
// Tess, then queues the job — the worker polls and renders it). Guarded by the
// internal key. Output lands as a Social Studio draft, never auto-posted.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const recipeId = String((body as Record<string, unknown>).recipeId ?? "");
  if (!recipeId) return Response.json({ ok: false, error: "recipeId required" }, { status: 400 });

  const b = body as Record<string, unknown>;
  try {
    const result = await enqueueDemoJob({
      recipeId,
      requestedBy: typeof b.requestedBy === "string" ? b.requestedBy : "owner",
      createdBy: "tess",
      actor: "Tess",
      voice: typeof b.voice === "string" ? b.voice : undefined,
      music: typeof b.music === "string" ? b.music : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
      formats: Array.isArray(b.formats) ? b.formats.map(String) : undefined,
    });
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
