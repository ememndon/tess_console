import type { NextRequest } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { renderBanner, type BannerSpec } from "@/lib/banner";
import { fetchStockPhoto } from "@/lib/stock-media";

// Internal banner-render smoke endpoint — renders one sample per
// brand so the templated engine can be verified end-to-end. Guarded by the
// shared internal key; called from inside the container.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One sample per brand, each using its OWN layout, so the three designs can be
// compared side by side. checkinvest keeps the left-rail "rail" layout; the two
// new ones (calc, resume) are previewed via the explicit layout override.
const SAMPLES: { id: string; spec: BannerSpec }[] = [
  {
    id: "sample-calculatry",
    spec: {
      site: "calculatry",
      layout: "calc",
      title: "Loan Payoff Calculator",
      subtitle: "Plan your payoff in minutes",
    },
  },
  {
    id: "sample-resumehub",
    spec: {
      site: "resumehub",
      layout: "resume",
      title: "Build a CV that gets interviews",
      subtitle: "Free, recruiter-ready templates for 195 countries",
    },
  },
  {
    id: "sample-checkinvest",
    spec: {
      site: "checkinvest",
      layout: "rail",
      title: "Check before you invest",
      subtitle: "Run the numbers and verify first",
    },
  },
];

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  const rendered = [];
  for (const s of SAMPLES) rendered.push(await renderBanner(s.id, s.spec));

  // Bonus: ResumeHub over a stock photo, to show the CV documents are dropped
  // (and the headline goes full-width) when there's a photo/AI backdrop.
  try {
    const photo = await fetchStockPhoto("career office professional");
    if (photo) {
      rendered.push(
        await renderBanner("sample-resumehub-photo", {
          site: "resumehub",
          layout: "resume",
          title: "Build a CV that gets interviews",
          subtitle: "Free, recruiter-ready templates for 195 countries",
          bgImage: photo.data,
        }),
      );
    }
  } catch {
    /* no stock key / fetch failed — skip the overlay sample */
  }

  return Response.json({ ok: true, rendered });
}
