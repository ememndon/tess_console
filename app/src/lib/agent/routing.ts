import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getSecretValue, listSecretState } from "@/lib/secrets";
import { MODELS, MODELS_BY_ID, DEFAULT_ROUTING, resolveModel, isFreeModel, isUsHosted, type ModelRouting, type ModelDef } from "./models";

// Owner strategy (updated 2026-06-22): free-first recovery led by Cerebras
// (gpt-oss-120b — strongest free reasoning model, ~99% cached) → Groq → GLM-4.7-Flash
// (the free trio) → gpt-oss-120b on DeepInfra ($0.039, same brain, cheap paid floor)
// → DeepSeek V4 Flash → then the rest, so Tess stays smart even after the daily
// free budgets are exhausted.
export const FALLBACK_ORDER = ["cerebras", "groq", "glm-flash", "deepinfra-gptoss", "deepinfra-deepseek", "minimax", "deepseek-chat", "gpt", "opus"];

// Vision (multimodal) recovery order — used when a chat turn includes an image.
// Free first (Groq Llama 4 Scout, GLM-4.5V) → cheap paid (Qwen-VL on DeepInfra) →
// Anthropic (always reliable for image + tools).
export const VISION_ORDER = ["groq-vision", "glm-vision", "deepinfra-vision", "sonnet", "haiku", "opus"];

export async function getRouting(): Promise<ModelRouting> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "model_routing"));
  const v = (row?.value as Partial<ModelRouting>) ?? {};
  // Merge per-task picks: DB overrides sit on top of the DEFAULT_ROUTING per-duty
  // defaults (so the defaults apply until the owner overrides a specific task).
  return { ...DEFAULT_ROUTING, ...v, tasks: { ...DEFAULT_ROUTING.tasks, ...(v.tasks ?? {}) } };
}

export async function saveRouting(r: ModelRouting): Promise<void> {
  await db.insert(settings).values({ key: "model_routing", value: r }).onConflictDoUpdate({ target: settings.key, set: { value: r, updatedAt: new Date() } });
}

// Which models have their unlocking secret present in the vault.
export async function availableModelIds(): Promise<Set<string>> {
  const secrets = [...new Set(MODELS.map((m) => m.secret))];
  const present = new Set<string>();
  for (const s of secrets) if (await getSecretValue(s)) present.add(s);
  return new Set(MODELS.filter((m) => present.has(m.secret)).map((m) => m.id));
}

export async function resolveForTask(taskId: string, requireTools = false): Promise<ModelDef | null> {
  const [routing, available] = await Promise.all([getRouting(), availableModelIds()]);
  return resolveModel(taskId, routing, available, requireTools);
}

// Once the monthly budget cap is hit, paid models are forbidden. This
// resolves the best *free-tier* (zero-cost) model still available for the task,
// auto-routing by tier and ignoring manual picks (which may be paid).
export async function resolveFreeForTask(taskId: string, requireTools = false): Promise<ModelDef | null> {
  const available = await availableModelIds();
  const freeAvail = new Set([...available].filter((id) => { const m = MODELS_BY_ID[id]; return m && isFreeModel(m); }));
  return resolveModel(taskId, { mode: "auto", defaultModel: "", tasks: {} }, freeAvail, requireTools);
}

// The ordered list of models to ATTEMPT for a task: the routed primary first,
// then FALLBACK_ORDER, deduped. Skips models with no key or a failed last-test,
// honours requireTools, and (when over the hard budget cap) keeps only free-tier
// models. Callers try each in turn until one succeeds (reliability).
export async function resolveChainForTask(taskId: string, requireTools = false, opts?: { freeOnly?: boolean; prefer?: string; visionOnly?: boolean; usHostedOnly?: boolean }): Promise<ModelDef[]> {
  const [routing, available, state] = await Promise.all([getRouting(), availableModelIds(), listSecretState()]);
  const usable = (m: ModelDef | undefined): m is ModelDef => {
    if (!m || !available.has(m.id)) return false;
    if (state[m.secret]?.status === "failed") return false; // don't burn calls on a known-bad key
    if (requireTools && (!m.tools || m.kind === "gemini")) return false;
    if (opts?.visionOnly && !m.vision) return false; // image attached → only multimodal models
    if (opts?.freeOnly && !isFreeModel(m)) return false;
    if (opts?.usHostedOnly && !isUsHosted(m)) return false; // PII tasks: keep off CN-hosted endpoints
    return true;
  };
  const ordered: ModelDef[] = [];
  const seen = new Set<string>();
  const push = (id?: string) => {
    if (!id || seen.has(id)) return;
    const m = MODELS_BY_ID[id];
    if (usable(m)) { ordered.push(m); seen.add(id); }
  };
  // Caller-preferred model goes first (e.g. demo scripts prefer Sonnet) — still
  // skipped if its key is missing/failed, paid while over the cap, or non-vision
  // when an image is attached.
  if (opts?.prefer) push(opts.prefer);
  if (opts?.visionOnly) {
    // Image attached: walk the vision recovery order instead of the text chain.
    for (const id of VISION_ORDER) push(id);
  } else {
    const primary = resolveModel(taskId, routing, available, requireTools);
    if (primary) push(primary.id);
    for (const id of FALLBACK_ORDER) push(id);
  }
  // Backstop: anything else usable (filtered by the same rules), so a missing key
  // never strands her.
  for (const m of MODELS) push(m.id);
  return ordered;
}
