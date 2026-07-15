import { NextRequest, NextResponse } from "next/server";
import { safeKeyEqual } from "@/lib/internal-auth";
import { runGscFeedback } from "@/lib/research/feedback";

// Monthly feedback loop: re-read Search Console for past GSC-anchored posts, record
// which pages climbed (so the next plan doubles down), and notify the owner.
// Triggered by scripts/gsc-feedback.sh on a cron. Internal-key guarded.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const results = await runGscFeedback();
  const totals = results.reduce((a, r) => ({ analyzed: a.analyzed + r.analyzed, improved: a.improved + r.improved }), { analyzed: 0, improved: 0 });
  return NextResponse.json({ ok: true, ...totals, results });
}
