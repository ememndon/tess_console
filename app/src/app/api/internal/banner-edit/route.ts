import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { editBannerText } from "@/lib/banner-edit";

// Internal helper to re-render an image post's banner header/subhead. Guarded by
// INTERNAL_SYNC_KEY; same code the post-detail editor and Tess's edit_post_image
// tool use. POST ?ref=363909 with JSON { headline?, subhead? }.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  const body = (await req.json().catch(() => ({}))) as { headline?: string; subhead?: string };
  const r = await editBannerText(ref, { headline: body.headline, subhead: body.subhead });
  return Response.json(r, { status: r.ok ? 200 : 400 });
}
