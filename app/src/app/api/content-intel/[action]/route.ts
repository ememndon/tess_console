import type { NextRequest } from "next/server";
import { tokenOk, runContentIntel, CONTENT_INTEL_TOOL_NAMES } from "@/lib/research/api";

// Plain authenticated REST surface for the Content Director — usable by ANY AI
// model, agent or automation (not just MCP clients). Bearer token = the vault's
// mcp_access_token. POST /api/content-intel/<action> with a JSON body of args.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // grid builds run many caption generations

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!(await tokenOk(req.headers.get("authorization")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { action } = await params;
  if (!CONTENT_INTEL_TOOL_NAMES.includes(action as (typeof CONTENT_INTEL_TOOL_NAMES)[number])) {
    return Response.json({ error: `unknown action '${action}'`, actions: CONTENT_INTEL_TOOL_NAMES }, { status: 404 });
  }
  let args: Record<string, unknown> = {};
  try {
    const body = await req.text();
    if (body.trim()) args = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const result = await runContentIntel(action, args, "rest-api");
    return Response.json({ ok: true, result });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// Discovery: list the available actions (still token-gated).
export async function GET(req: NextRequest) {
  if (!(await tokenOk(req.headers.get("authorization")))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ actions: CONTENT_INTEL_TOOL_NAMES });
}
