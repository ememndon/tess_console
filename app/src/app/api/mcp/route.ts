import type { NextRequest } from "next/server";
import { tokenOk, runContentIntel, CONTENT_INTEL_TOOLS } from "@/lib/research/api";

// MCP server for the Content Director over Streamable HTTP (JSON-RPC 2.0, JSON
// responses). MCP is an open protocol, so Claude AND other MCP-capable clients
// connect here as a custom connector. Auth = Bearer <mcp_access_token>.
// Implemented directly (no SDK) to keep the standalone Docker build lean.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROTOCOL = "2024-11-05";
type RpcMsg = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: RpcMsg["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: RpcMsg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(msg: RpcMsg): Promise<object | null> {
  const { method, id, params } = msg;
  // Notifications (no id) get no response.
  const isNotification = id === undefined || id === null;
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: (params?.protocolVersion as string) || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "Tess Content Director", version: "1.0.0" },
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: CONTENT_INTEL_TOOLS });
    case "tools/call": {
      const name = String(params?.name ?? "");
      const args = (params?.arguments as Record<string, unknown>) ?? {};
      try {
        const result = await runContentIntel(name, args, "mcp");
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return isNotification ? null : err(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req: NextRequest) {
  if (!(await tokenOk(req.headers.get("authorization")))) {
    return new Response("unauthorized", { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(err(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handle(m as RpcMsg)))).filter(Boolean);
    return responses.length ? Response.json(responses) : new Response(null, { status: 202 });
  }
  const response = await handle(body as RpcMsg);
  return response ? Response.json(response) : new Response(null, { status: 202 });
}

// No server-initiated SSE stream; clients use request/response over POST.
export async function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}
