import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { renderVideo } from "@/lib/video";

// Video-engine smoke endpoint — renders a data-driven sample so the
// templated FFmpeg engine can be verified. Guarded by the internal key.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const out = await renderVideo("sample-rates", {
    site: "checkinvest",
    badge: "Today's rates",
    title: "Naira exchange rates",
    dataLines: [
      { label: "USD / NGN", value: "1,580" },
      { label: "GBP / NGN", value: "2,010" },
      { label: "EUR / NGN", value: "1,720" },
    ],
    hashtags: ["#Nigeria", "#forex", "#CheckInvest"],
  });
  return Response.json({ ok: true, video: out });
}
