import "server-only";
import path from "path";
import { promises as fs } from "fs";
import { openaiChat, type OAMessage, type OAContentPart } from "@/lib/agent/complete";
import { MODELS_BY_ID } from "@/lib/agent/models";
import { MEDIA_ROOT } from "@/lib/banner";
import { enforceNoDashPunctuation } from "@/lib/design";
import type { ThumbScore } from "@/lib/youtube/types";

// CTR scoring: after a thumbnail is rendered, a vision model judges how strongly it
// will earn the click — face visibility, text readability, emotion, contrast,
// curiosity, colour harmony, composition, object overlap, balance — and returns a
// 0-100 score plus a one-line critique. Used to auto-reject weak renders and to
// surface a quality read in the UI. Best-effort: returns null on any failure so it
// never blocks a pack. Uses the free vision lane (groq-vision → glm-vision).

const AXES = [
  "faceVisibility",
  "textReadability",
  "emotion",
  "contrast",
  "curiosity",
  "colorHarmony",
  "composition",
  "objectOverlap",
  "placement",
  "balance",
] as const;

function extractJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const clamp = (n: unknown): number | null => (typeof n === "number" && isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null);

// relPath is relative to MEDIA_ROOT (as returned by renderThumbnail). Accepts an
// absolute path too.
export async function scoreThumbnail(relOrAbsPath: string): Promise<ThumbScore | null> {
  if (!relOrAbsPath) return null;
  const abs = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(MEDIA_ROOT, relOrAbsPath);
  let dataUrl: string;
  try {
    const buf = await fs.readFile(abs);
    dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }

  const system =
    "You are a ruthless YouTube thumbnail critic who has studied what makes the biggest channels win the click. " +
    "Judge the attached thumbnail as it would look TINY on a crowded homepage (about 150px wide). Score each " +
    "criterion 0-100 and give an overall 0-100 for click-through potential. Be honest and harsh; an average " +
    "AI-looking thumbnail is around 55-65, only a genuinely scroll-stopping pro thumbnail is 85+. " +
    "Return STRICT JSON only, no prose, no markdown:\n" +
    `{"score":0,"axes":{${AXES.map((a) => `"${a}":0`).join(",")}},"critique":"one short sentence on the single biggest improvement"}\n` +
    "faceVisibility = is a large expressive face clearly visible and NOT touched by text. " +
    "textReadability = is the headline instantly legible at tiny size. " +
    "emotion = does the face/scene carry a strong, fitting emotion. " +
    "objectOverlap = penalise HARD if any text overlaps, touches, or sits on top of the face or key subject. " +
    "placement = is the headline on the EMPTY side of the frame, well clear of the subject? IMPORTANT: if the " +
    "headline is clearly on the OPPOSITE side from the face with the face fully visible, that is GOOD placement " +
    "— score it high (85+). Only penalise placement when text actually touches/overlaps the face, crowds the " +
    "head, or wastes the empty side while crowding the subject. Judge only what you can clearly see. " +
    "balance/composition/contrast/curiosity/colorHarmony as a pro designer would judge them.\n" +
    "Weight face-overlap and placement heavily: text genuinely ON the face is a serious flaw and should pull " +
    "the overall score well down. But do NOT invent overlap that isn't there — a clean opposite-side layout " +
    "with a fully visible face should score well overall.";

  const content: OAContentPart[] = [
    { type: "text", text: "Score this YouTube thumbnail." },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
  const messages: OAMessage[] = [
    { role: "system", content: system },
    { role: "user", content },
  ];

  for (const id of ["groq-vision", "glm-vision"]) {
    const model = MODELS_BY_ID[id];
    if (!model) continue;
    try {
      const r = await openaiChat(model, { messages, maxTokens: 400, temperature: 0.2 });
      const j = extractJson(r.message.content ?? "");
      if (!j) continue;
      const score = clamp(j.score);
      if (score == null) continue;
      const axes: Record<string, number> = {};
      const rawAxes = (j.axes as Record<string, unknown>) ?? {};
      for (const a of AXES) {
        const v = clamp(rawAxes[a]);
        if (v != null) axes[a] = v;
      }
      const critique = typeof j.critique === "string" ? enforceNoDashPunctuation(j.critique.trim()).slice(0, 200) : undefined;
      return { score, axes: Object.keys(axes).length ? axes : undefined, critique };
    } catch {
      // try the next free vision model
    }
  }
  return null;
}
