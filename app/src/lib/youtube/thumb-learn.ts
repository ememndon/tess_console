import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { generateRouted } from "@/lib/agent/complete";
import { budgetStatus } from "@/lib/agent/cost";
import { isTessPaused } from "@/lib/agent/control";
import { audit } from "@/lib/audit";
import type { ThumbLayers } from "./types";

// ── Thumbnail style-learning loop ─────────────────────────────────────────────
// Every time the owner edits + saves a thumbnail, we compare what the system
// GENERATED to what the owner SHIPPED and distil durable design preferences
// (fonts, sizes, colours, outline use, casing, layout). They're stored per brand
// and injected back into the thumbnail planner (generateBrief) so Tess's own
// designs drift toward the owner's taste over time. Best-effort: never blocks the
// save, never throws.

const KEY = (site: string) => `thumb_style_prefs:${site}`;
type Store = { prefs: string[]; samples: number; updatedAt: string };

export async function getThumbStylePrefs(site: string): Promise<string[]> {
  try {
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY(site)));
    const v = row?.value as Store | undefined;
    return Array.isArray(v?.prefs) ? v!.prefs.slice(0, 10) : [];
  } catch {
    return [];
  }
}

// Compact, LLM-friendly view of a layer set (drops noise, rounds numbers).
function summarize(layers?: ThumbLayers | null): unknown {
  if (!layers || !Array.isArray(layers.items)) return null;
  return layers.items.map((l) =>
    l.type === "text"
      ? {
          kind: "text",
          text: (l.text || "").slice(0, 48),
          font: l.family || "Archivo Black",
          sizePx: Math.round(l.fontSize),
          color: l.fill,
          outline: !!l.stroke,
          outlineColor: l.stroke ? l.strokeColor ?? "#0B0B0B" : undefined,
          outlineWidthPx: l.stroke ? l.strokeWidth ?? Math.round(l.fontSize * 0.05) : undefined,
          highlightBox: l.box ?? null,
          allCaps: !!l.uppercase,
          rotationDeg: l.rotation ?? 0,
          x: Math.round(l.left),
          y: Math.round(l.top),
        }
      : { kind: "shape", shape: l.kind, color: l.color, sizePx: Math.round(l.size) },
  );
}

// A normalized fingerprint that ignores wording + small position nudges, so we
// only spend an LLM call when something STYLE-relevant actually changed.
function styleFingerprint(layers?: ThumbLayers | null): string {
  if (!layers || !Array.isArray(layers.items)) return "";
  return JSON.stringify(
    layers.items.map((l) =>
      l.type === "text"
        ? ["t", l.family || "A", Math.round(l.fontSize / 8), l.fill, !!l.stroke, l.strokeColor ?? "", Math.round((l.strokeWidth ?? 0) / 4), l.box ?? "", !!l.uppercase, Math.round((l.rotation ?? 0) / 5), Math.round(l.left / 80), Math.round(l.top / 80)]
        : ["s", l.kind, l.color, Math.round(l.size / 40)],
    ),
  );
}

function parsePrefs(raw: string): string[] | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { prefs?: unknown };
    if (!Array.isArray(j.prefs)) return null;
    return j.prefs.map((p) => String(p).trim()).filter(Boolean).slice(0, 8);
  } catch {
    return null;
  }
}

export async function learnFromThumbEdit(site: string, generated: ThumbLayers | null | undefined, edited: ThumbLayers | null | undefined): Promise<void> {
  try {
    if (!generated || !edited) return;
    if (styleFingerprint(generated) === styleFingerprint(edited)) return; // only wording/tiny moves changed
    if (await isTessPaused()) return;
    const b = await budgetStatus();
    if (b.pct >= 100) return; // respect the hard budget cap

    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY(site)));
    const prev = (row?.value as Store | undefined) ?? { prefs: [], samples: 0, updatedAt: "" };

    const system = [
      "You maintain a concise DESIGN-STYLE memory for one brand's YouTube thumbnails.",
      "You are given three things: (A) the thumbnail our system generated, (B) the SAME thumbnail after the brand OWNER edited and approved it, and (C) the preferences learned so far.",
      "Infer the owner's DURABLE design taste from how they changed A into B: font family choices, text size, colours, outline use (and its colour/thickness), highlight boxes, ALL-CAPS, rotation, layout/position tendencies, and when they add or remove shapes (X / check / circle / arrow).",
      "IGNORE one-off things: the literal wording of the headline and tiny position nudges are NOT preferences.",
      "MERGE with the existing preferences in C: keep what still holds, refine what changed, drop anything the new edit contradicts, and deduplicate.",
      "Each preference is a short, imperative, generalizable rule (e.g. 'Prefer the Anton font for headlines', 'Use a thick black outline on busy photos', 'Keep headlines in ALL CAPS', 'Avoid highlight boxes').",
      'Return STRICT JSON only, no prose, no markdown: { "prefs": ["rule", "rule"] } with at most 8 rules.',
    ].join("\n");
    const user = JSON.stringify({
      generated: summarize(generated),
      ownerEditedAndApproved: summarize(edited),
      existingPreferences: prev.prefs,
    });

    const out = (await generateRouted({ taskId: "social_caption", system, user, maxTokens: 480, temperature: 0.3, reasoningEffort: "low" })).text;
    const prefs = parsePrefs(out);
    if (!prefs || prefs.length === 0) return;

    const store: Store = { prefs, samples: (prev.samples ?? 0) + 1, updatedAt: new Date().toISOString() };
    await db
      .insert(settings)
      .values({ key: KEY(site), value: store })
      .onConflictDoUpdate({ target: settings.key, set: { value: store, updatedAt: new Date() } });
    await audit({ actorName: "tess", action: "youtube.thumb_learn", target: site, detail: { samples: store.samples, prefs: prefs.length } }).catch(() => {});
  } catch {
    /* best-effort: a failed lesson must never affect the save */
  }
}
