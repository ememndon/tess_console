import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { generateCaption } from "@/lib/generate";

// Generation smoke endpoint — one sample per brand, incl. a data-bound
// one, to verify brand voice + the numeric guard. Guarded by the internal key.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const tests = [
    await generateCaption({ site: "calculatry", topic: "Why a free mortgage calculator helps first-time buyers plan" }),
    await generateCaption({
      site: "checkinvest",
      topic: "Today's naira exchange rates update",
      data: [
        { label: "USD/NGN", value: "1,580" },
        { label: "GBP/NGN", value: "2,010" },
      ],
    }),
    await generateCaption({ site: "resumehub", topic: "One practical CV tip for applying to jobs in Germany" }),
  ];
  return Response.json({ ok: true, tests });
}
