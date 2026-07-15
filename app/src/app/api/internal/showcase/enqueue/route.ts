import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { insertMediaJob } from "@/lib/demo/enqueue";
import type { DemoScenario } from "@/lib/demo/types";

// Console-showcase section renders: enqueue a HAND-AUTHORED scenario directly —
// no LLM scriptwriting, no recipe lookup. The showcase script is human-approved
// word-for-word, so the scenario arrives complete (say lines + click path) and
// the worker just plays it. Sections render as separate bare 16:9 jobs and are
// stitched downstream. Guarded by INTERNAL_SYNC_KEY; compose network only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  let body: { scenario?: DemoScenario; voice?: string; formats?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sc = body.scenario;
  if (!sc || typeof sc.url !== "string" || !/^https?:\/\//.test(sc.url) || !Array.isArray(sc.scenes) || sc.scenes.length === 0) {
    return Response.json({ error: "scenario with url + scenes required" }, { status: 400 });
  }
  // Showcase sections are always bare + authenticated; the flags ride in the
  // scenario so the worker needs no schema change.
  const scenario: DemoScenario = { ...sc, consoleAuth: true, bare: true };
  const jobId = await insertMediaJob({
    site: "console",
    recipeId: sc.recipeId || "console-showcase",
    feature: sc.feature || "Console showcase section",
    url: sc.url,
    scenario,
    requestedBy: "showcase",
    createdBy: "owner",
    actor: "Showcase build",
    voice: body.voice,
    music: "none",
    // 4K from a smaller CSS viewport (crisper, larger UI text) by default; overridable.
    formats: body.formats?.length ? body.formats : ["16:9uhd"],
  });
  return Response.json({ ok: true, jobId });
}
