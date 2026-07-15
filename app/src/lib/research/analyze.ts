import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { brandProfiles } from "../db/schema";
import { generateRouted } from "../agent/complete";
import { enforceNoDashPunctuation } from "../design";
import { getOutliers, type OutlierVideo } from "./ingest";
import { FORMAT_VAULT_BRIEF, formatById } from "./formats";
import { getCachedStrategy, setCachedStrategy } from "./strategy-cache";

// The strategist layer: turn raw outliers into a real content strategy — ranked
// subtopics WITH the winning pattern + saturation, the formats that are actually
// winning (mapped to our vault, with templates), and reusable hook formulas mined
// from the winning titles. Runs on Tess's free-first multi-model routing.

export type Subtopic = {
  rank: number;
  title: string;
  pattern: string; // why this subtopic is winning / the angle that works
  hookStyle: string;
  exampleTitles: string[];
  strength: number; // 0..100 aggregate opportunity
  winningCount: number;
  saturation: "low" | "medium" | "high";
  difficultyNote: string; // how hard it is to break in
};
export type FormatPick = {
  id: string;
  name: string;
  whyWinning: string;
  template: string;
  winShare: number; // 0..100 share of winners in this format
  exampleTitles: string[];
};
export type HookPattern = { pattern: string; example: string };
export type NicheStrategy = {
  niche: string;
  analyzedVideos: number;
  summary: string;
  subtopics: Subtopic[];
  formats: FormatPick[];
  hookPatterns: HookPattern[];
  model: string | null;
  note?: string;
};

function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

const sat = (v: unknown): "low" | "medium" | "high" => (v === "low" || v === "high" ? v : "medium");
const num = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const strArr = (v: unknown, n = 3): string[] => (Array.isArray(v) ? v.map(String).slice(0, n) : []);

export async function analyzeNiche(niche: string, opts: { site?: string; allowCache?: boolean } = {}): Promise<NicheStrategy> {
  const q = niche.trim();
  // "Build 30-day plan" passes allowCache so it reuses the strategy "Analyze
  // strategy" just produced (no second LLM call). The Analyze button itself never
  // passes it, so it always re-runs fresh — and writes the result back to the cache.
  if (opts.allowCache) {
    const cached = getCachedStrategy(q);
    if (cached) return cached;
  }
  const outliers = await getOutliers(q, 40);
  if (!outliers.length) {
    return { niche: q, analyzedVideos: 0, summary: "", subtopics: [], formats: [], hookPatterns: [], model: null, note: "No research data for this niche yet. Run research first (research_niche)." };
  }

  const lines = outliers
    .map((v, i) => `${i + 1}. "${v.title}" | ${v.channelTitle ?? "?"} | ${v.views.toLocaleString()} views | outlier ${v.outlierScore ?? "?"}x | opp ${v.opportunityScore ?? "?"} | ${v.isShort ? "short" : "long"}`)
    .join("\n");

  // Ground the strategy in the ACTUAL brand. Without this, the analysis just
  // mirrors whatever dominates the YouTube niche (e.g. "use ChatGPT to write your
  // resume") even when the site does something different — producing off-brand,
  // factually wrong subtopics. The brief carries the binding DO/DON'T.
  const brand = opts.site ? (await db.select().from(brandProfiles).where(eq(brandProfiles.site, opts.site)))[0] : undefined;
  const brandBlock = brand
    ? [
        "CRITICAL — THIS STRATEGY IS FOR A SPECIFIC BRAND, NOT THE GENERIC NICHE.",
        "The videos below show the DEMAND, HOOKS and FORMATS that win in the broad niche. Your job is to channel that proven demand into subtopics about what THIS brand actually offers — never to copy a topic the brand does not do.",
        brand.voice ? `Brand voice: ${brand.voice}` : "",
        brand.audience ? `Audience: ${brand.audience}` : "",
        brand.brief ? `What the brand is (its DO / DON'T is BINDING):\n${brand.brief}` : "",
        "HARD RULES for every subtopic: (1) it must be something THIS brand can credibly create and that points back to its real product; (2) NEVER propose subtopics that misrepresent the brand or promote things it does not offer — e.g. do not frame it as an AI tool, or center it on third-party tools (ChatGPT, Claude, Gemini, etc.), unless that is genuinely what the brand is; (3) when the niche's winners revolve around a tool or angle the brand is NOT, translate the underlying viewer desire into the brand's actual offering instead. Reject off-brand clusters even if they have high opportunity scores.",
      ].filter(Boolean).join("\n")
    : "";

  const system = [
    "You are an elite short-form video strategist analyzing what is ALREADY winning in a niche so a creator can ride proven demand.",
    brandBlock,
    "You will receive the niche and its top videos ranked by an opportunity score (which already blends outlier strength, velocity, engagement and recency).",
    "Produce a rigorous strategy. Rank SUBTOPICS by how hard they are already winning (aggregate opportunity + how many winners cluster there), and be honest about saturation and difficulty. Subtopics must be DISTINCT from one another — do not list near-duplicates of the same angle.",
    "Map the winning videos onto THESE formats (use the exact id):",
    FORMAT_VAULT_BRIEF,
    "Mine reusable HOOK formulas from the actual winning titles (generalize them into templates with a slot, not copies).",
    "Never invent view counts or stats. Output ONLY minified JSON, no prose, in EXACTLY this shape:",
    `{"summary":"1-2 sentence executive read","subtopics":[{"title":"","pattern":"why it wins / the working angle","hookStyle":"","exampleTitles":["",""],"strength":0,"winningCount":0,"saturation":"low|medium|high","difficultyNote":""}],"formats":[{"id":"vault id","whyWinning":"","template":"","winShare":0,"exampleTitles":[""]}],"hookPatterns":[{"pattern":"template with a [slot]","example":""}]}`,
    "Give 6 subtopics, 5 formats, and 4 to 6 hookPatterns. strength and winShare are 0 to 100.",
  ].join("\n");
  const user = `Niche: ${q}\n\nTop videos (already ranked):\n${lines}`;

  // The analysis JSON is large, and free models occasionally truncate or wrap it.
  // Give plenty of room, keep the temperature low for clean structure, and retry
  // once with a stricter "valid JSON only" instruction before giving up.
  let parsed: Record<string, unknown> | null = null;
  let model: string | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const sys = attempt === 0 ? system : `${system}\n\nIMPORTANT: your previous reply was not valid JSON. Reply with ONE complete, valid JSON object and NOTHING else — no markdown, no commentary, every brace and bracket closed.`;
    const gen = await generateRouted({ taskId: "content_strategy", system: sys, user, maxTokens: 3200, temperature: attempt === 0 ? 0.4 : 0.2 });
    model = gen.model;
    parsed = extractJson(gen.text) as Record<string, unknown> | null;
  }
  if (!parsed) return { niche: q, analyzedVideos: outliers.length, summary: "", subtopics: [], formats: [], hookPatterns: [], model, note: "Analysis could not be parsed after a retry; please try again." };

  const subtopics: Subtopic[] = (Array.isArray(parsed.subtopics) ? parsed.subtopics : [])
    .map((s) => s as Record<string, unknown>)
    .map((s) => ({
      rank: 0,
      title: String(s.title ?? "").slice(0, 120),
      pattern: enforceNoDashPunctuation(String(s.pattern ?? "")),
      hookStyle: enforceNoDashPunctuation(String(s.hookStyle ?? "")),
      exampleTitles: strArr(s.exampleTitles),
      strength: Math.max(0, Math.min(100, num(s.strength))),
      winningCount: num(s.winningCount),
      saturation: sat(s.saturation),
      difficultyNote: enforceNoDashPunctuation(String(s.difficultyNote ?? "")),
    }))
    .filter((s) => s.title)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 6)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const formats: FormatPick[] = (Array.isArray(parsed.formats) ? parsed.formats : [])
    .map((f) => f as Record<string, unknown>)
    .map((f) => {
      const def = formatById(String(f.id ?? ""));
      return {
        id: String(f.id ?? ""),
        name: def?.name ?? String(f.id ?? ""),
        whyWinning: enforceNoDashPunctuation(String(f.whyWinning ?? def?.whyItWorks ?? "")),
        template: enforceNoDashPunctuation(String(f.template ?? def?.template ?? "")),
        winShare: Math.max(0, Math.min(100, num(f.winShare))),
        exampleTitles: strArr(f.exampleTitles),
      };
    })
    .filter((f) => f.id && (formatById(f.id) || f.name))
    .sort((a, b) => b.winShare - a.winShare)
    .slice(0, 5);

  const hookPatterns: HookPattern[] = (Array.isArray(parsed.hookPatterns) ? parsed.hookPatterns : [])
    .map((h) => h as Record<string, unknown>)
    .map((h) => ({ pattern: enforceNoDashPunctuation(String(h.pattern ?? "")), example: enforceNoDashPunctuation(String(h.example ?? "")) }))
    .filter((h) => h.pattern)
    .slice(0, 6);

  const result: NicheStrategy = { niche: q, analyzedVideos: outliers.length, summary: enforceNoDashPunctuation(String(parsed.summary ?? "")), subtopics, formats, hookPatterns, model };
  setCachedStrategy(q, result); // so a following Build reuses it
  return result;
}

// Fresh, contrarian angles for a topic+format cell — the spark the creator adds on
// top of a proven topic/format (used by the 30-day grid builder).
export async function generateAngles(topic: string, formatName: string, count = 3): Promise<string[]> {
  const system = [
    "You are a short-form content strategist. Given a topic and a video format, propose sharp, CONTRARIAN or fresh angles that stand out from the obvious take.",
    "Each angle is one specific sentence a creator could build a video around. Honest, no fake claims, no invented stats.",
    `Output ONLY a JSON array of ${count} strings.`,
  ].join("\n");
  const gen = await generateRouted({ taskId: "content_strategy", system, user: `Topic: ${topic}\nFormat: ${formatName}`, maxTokens: 400, temperature: 0.9 });
  const parsed = extractJson(gen.text.replace(/^\s*\[/, "{\"a\":[").replace(/\]\s*$/, "]}")) as { a?: unknown } | null;
  const arr = parsed && Array.isArray(parsed.a) ? parsed.a.map(String) : [];
  if (arr.length) return arr.slice(0, count).map(enforceNoDashPunctuation);
  // Fallback: tolerant line parse.
  return gen.text.split(/\n+/).map((l) => l.replace(/^[\s\-*\d.]+/, "").trim()).filter(Boolean).slice(0, count).map(enforceNoDashPunctuation);
}

export type { OutlierVideo };
