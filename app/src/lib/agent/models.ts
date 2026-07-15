// Multi-provider model registry + per-task routing (client-safe: no server imports).
// Tess can use Anthropic (Opus/Sonnet/Haiku/Fable), OpenAI, and several
// cost-effective Chinese providers (DeepSeek, Qwen, GLM/Zhipu, Kimi/Moonshot),
// plus Gemini and Groq. "Tier" maps task difficulty → model capability so auto
// routing sends light work to cheap models and hard work to capable ones.

export type ModelKind = "anthropic" | "openai" | "gemini"; // wire protocol
export type ModelTier = "light" | "standard" | "heavy";

export type ModelDef = {
  id: string; // our stable key
  label: string;
  provider: string; // display group
  kind: ModelKind;
  apiModel: string; // the provider's model id
  tier: ModelTier;
  tools: boolean; // usable in the agent tool loop
  vision?: boolean; // can see images (multimodal) — used to route image attachments
  secret: string; // vault key that unlocks it
  baseURL?: string; // for openai-compatible providers
  priceIn: number; // USD / 1M tokens (for budget visibility)
  priceOut: number;
};

export const MODELS: ModelDef[] = [
  // ── Anthropic ──
  { id: "opus", label: "Claude Opus 4.8", provider: "Anthropic", kind: "anthropic", apiModel: "claude-opus-4-8", tier: "heavy", tools: true, vision: true, secret: "anthropic_api_key", priceIn: 5, priceOut: 25 },
  { id: "sonnet", label: "Claude Sonnet 4.6", provider: "Anthropic", kind: "anthropic", apiModel: "claude-sonnet-4-6", tier: "standard", tools: true, vision: true, secret: "anthropic_api_key", priceIn: 3, priceOut: 15 },
  { id: "haiku", label: "Claude Haiku 4.5", provider: "Anthropic", kind: "anthropic", apiModel: "claude-haiku-4-5", tier: "light", tools: true, vision: true, secret: "anthropic_api_key", priceIn: 1, priceOut: 5 },
  { id: "fable", label: "Claude Fable 5", provider: "Anthropic", kind: "anthropic", apiModel: "claude-fable-5", tier: "heavy", tools: true, secret: "anthropic_api_key", priceIn: 10, priceOut: 50 },

  // ── OpenAI ──
  { id: "gpt", label: "GPT-4o", provider: "OpenAI", kind: "openai", apiModel: "gpt-4o", tier: "standard", tools: true, secret: "openai_api_key", baseURL: "https://api.openai.com/v1", priceIn: 2.5, priceOut: 10 },
  { id: "gpt-mini", label: "GPT-4o mini", provider: "OpenAI", kind: "openai", apiModel: "gpt-4o-mini", tier: "light", tools: true, secret: "openai_api_key", baseURL: "https://api.openai.com/v1", priceIn: 0.15, priceOut: 0.6 },

  // ── DeepSeek (CN) ──
  { id: "deepseek-chat", label: "DeepSeek V3", provider: "DeepSeek", kind: "openai", apiModel: "deepseek-chat", tier: "standard", tools: true, secret: "deepseek_api_key", baseURL: "https://api.deepseek.com", priceIn: 0.27, priceOut: 1.1 },
  { id: "deepseek-reasoner", label: "DeepSeek R1 (reasoner)", provider: "DeepSeek", kind: "openai", apiModel: "deepseek-reasoner", tier: "heavy", tools: false, secret: "deepseek_api_key", baseURL: "https://api.deepseek.com", priceIn: 0.55, priceOut: 2.19 },

  // ── Qwen / Alibaba DashScope (CN) ──
  { id: "qwen-max", label: "Qwen Max", provider: "Qwen", kind: "openai", apiModel: "qwen-max", tier: "heavy", tools: true, secret: "qwen_api_key", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", priceIn: 1.6, priceOut: 6.4 },
  { id: "qwen-plus", label: "Qwen Plus", provider: "Qwen", kind: "openai", apiModel: "qwen-plus", tier: "standard", tools: true, secret: "qwen_api_key", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", priceIn: 0.4, priceOut: 1.2 },
  { id: "qwen-turbo", label: "Qwen Turbo", provider: "Qwen", kind: "openai", apiModel: "qwen-turbo", tier: "light", tools: true, secret: "qwen_api_key", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", priceIn: 0.05, priceOut: 0.2 },

  // ── GLM / Zhipu (CN) ── (GLM-4.7-Flash is free for all users — 203K context, tools)
  { id: "glm-plus", label: "GLM-4-Plus", provider: "Zhipu GLM", kind: "openai", apiModel: "glm-4-plus", tier: "standard", tools: true, secret: "zhipu_api_key", baseURL: "https://open.bigmodel.cn/api/paas/v4", priceIn: 0.7, priceOut: 0.7 },
  { id: "glm-flash", label: "GLM-4.7-Flash (free)", provider: "Zhipu GLM", kind: "openai", apiModel: "glm-4.7-flash", tier: "standard", tools: true, secret: "zhipu_api_key", baseURL: "https://open.bigmodel.cn/api/paas/v4", priceIn: 0, priceOut: 0 },

  // ── Kimi / Moonshot (CN) ──
  { id: "kimi", label: "Kimi (Moonshot v1 32k)", provider: "Moonshot", kind: "openai", apiModel: "moonshot-v1-32k", tier: "standard", tools: true, secret: "moonshot_api_key", baseURL: "https://api.moonshot.cn/v1", priceIn: 1.7, priceOut: 1.7 },

  // ── MiniMax (CN) ──
  { id: "minimax", label: "MiniMax-M2", provider: "MiniMax", kind: "openai", apiModel: "MiniMax-M2", tier: "standard", tools: true, secret: "minimax_api_key", baseURL: "https://api.minimax.io/v1", priceIn: 0.3, priceOut: 1.2 },

  // ── Google Gemini ──
  { id: "gemini-flash", label: "Gemini 2.0 Flash", provider: "Gemini", kind: "gemini", apiModel: "gemini-2.0-flash", tier: "light", tools: false, secret: "gemini_api_key", priceIn: 0, priceOut: 0 },
  { id: "gemini-pro", label: "Gemini 1.5 Pro", provider: "Gemini", kind: "gemini", apiModel: "gemini-1.5-pro", tier: "standard", tools: false, secret: "gemini_api_key", priceIn: 1.25, priceOut: 5 },

  // ── Groq (free tier) — priced 0 so it serves as the budget-cap fallback ──
  { id: "groq", label: "Llama 3.3 70B (Groq, free tier)", provider: "Groq", kind: "openai", apiModel: "llama-3.3-70b-versatile", tier: "standard", tools: true, secret: "groq_api_key", baseURL: "https://api.groq.com/openai/v1", priceIn: 0, priceOut: 0 },

  // ── Cerebras (free tier) — very fast, 1M tokens/day; priced 0. Uses GPT-OSS-120B:
  // the key only has gpt-oss-120b + zai-glm-4.7 (the old llama-3.3-70b id 404'd),
  // and both support Cerebras prompt caching (verified ~99% prefix cache hits). ──
  { id: "cerebras", label: "GPT-OSS-120B (Cerebras, free tier)", provider: "Cerebras", kind: "openai", apiModel: "gpt-oss-120b", tier: "standard", tools: true, secret: "cerebras_api_key", baseURL: "https://api.cerebras.ai/v1", priceIn: 0, priceOut: 0 },

  // ── DeepInfra — the cheap PAID floor when all free tiers are exhausted ──
  // gpt-oss-120b is the floor: same strong reasoning model Cerebras serves free,
  // cheaper than DeepSeek-V4-Flash and built for agentic tool use. V3.2 is the
  // heavy-reasoning option; V4-Flash kept as a further cheap fallback.
  { id: "deepinfra-gptoss", label: "GPT-OSS-120B (DeepInfra)", provider: "DeepInfra", kind: "openai", apiModel: "openai/gpt-oss-120b", tier: "heavy", tools: true, secret: "deepinfra_api_key", baseURL: "https://api.deepinfra.com/v1/openai", priceIn: 0.039, priceOut: 0.19 },
  { id: "deepinfra-deepseek-v32", label: "DeepSeek V3.2 (DeepInfra)", provider: "DeepInfra", kind: "openai", apiModel: "deepseek-ai/DeepSeek-V3.2", tier: "heavy", tools: true, secret: "deepinfra_api_key", baseURL: "https://api.deepinfra.com/v1/openai", priceIn: 0.26, priceOut: 0.38 },
  { id: "deepinfra-deepseek", label: "DeepSeek V4 Flash (DeepInfra)", provider: "DeepInfra", kind: "openai", apiModel: "deepseek-ai/DeepSeek-V4-Flash", tier: "standard", tools: true, secret: "deepinfra_api_key", baseURL: "https://api.deepinfra.com/v1/openai", priceIn: 0.1, priceOut: 0.2 },

  // ── Vision models (multimodal) — used when a chat turn includes an image ──
  // Free first: Groq Llama 4 Scout, then GLM-4.5V; paid backup: Qwen2.5-VL on DeepInfra.
  { id: "groq-vision", label: "Llama 4 Scout (Groq, vision, free)", provider: "Groq", kind: "openai", apiModel: "meta-llama/llama-4-scout-17b-16e-instruct", tier: "standard", tools: true, vision: true, secret: "groq_api_key", baseURL: "https://api.groq.com/openai/v1", priceIn: 0, priceOut: 0 },
  { id: "glm-vision", label: "GLM-4.5V (vision, free)", provider: "Zhipu GLM", kind: "openai", apiModel: "glm-4.5v", tier: "standard", tools: true, vision: true, secret: "zhipu_api_key", baseURL: "https://open.bigmodel.cn/api/paas/v4", priceIn: 0, priceOut: 0 },
  { id: "deepinfra-vision", label: "Qwen2.5-VL 72B (DeepInfra, vision)", provider: "DeepInfra", kind: "openai", apiModel: "Qwen/Qwen2.5-VL-72B-Instruct", tier: "standard", tools: true, vision: true, secret: "deepinfra_api_key", baseURL: "https://api.deepinfra.com/v1/openai", priceIn: 0.3, priceOut: 0.8 },
];

// "Free" = zero marginal cost against the paid-API budget (Groq/Gemini free
// tiers). Used as the fallback once the monthly cap is hit.
export function isFreeModel(m: ModelDef): boolean {
  return m.priceIn === 0 && m.priceOut === 0;
}

// US-hosted = safe for customer PII (keeps personal data off CN-hosted endpoints).
// Used to lock support/outreach email drafting to US providers. NOTE: DeepInfra-
// hosted DeepSeek counts as US (provider "DeepInfra"); only NATIVE DeepSeek
// (api.deepseek.com) is CN. Excludes Zhipu GLM, Qwen, Moonshot/Kimi, MiniMax.
const US_HOSTED_PROVIDERS = new Set(["OpenAI", "Groq", "Cerebras", "DeepInfra", "Anthropic", "Gemini"]);
export function isUsHosted(m: ModelDef): boolean {
  return US_HOSTED_PROVIDERS.has(m.provider);
}

export const MODELS_BY_ID: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

// Task catalog — each job Tess does, with the difficulty tier auto-routing uses.
export type TessTask = { id: string; label: string; tier: ModelTier; toolsNeeded: boolean; help: string };
export const TESS_TASKS: TessTask[] = [
  { id: "chat", label: "Agent chat / reasoning", tier: "heavy", toolsNeeded: true, help: "The main brain — answering, planning, using tools." },
  { id: "support_reply", label: "Support email drafts", tier: "standard", toolsNeeded: false, help: "Customer replies (personal data — prefer a strong-data-handling model)." },
  { id: "social_caption", label: "Social captions", tier: "light", toolsNeeded: false, help: "Short brand-voice posts." },
  { id: "outreach_draft", label: "Outreach drafts", tier: "light", toolsNeeded: false, help: "Partnership outreach emails." },
  { id: "daily_report", label: "Daily report", tier: "standard", toolsNeeded: false, help: "The morning summary narrative." },
  { id: "content_strategy", label: "Content Director analysis", tier: "heavy", toolsNeeded: false, help: "Turns viral outliers into ranked subtopics, winning formats and hook formulas (a large structured-JSON reasoning job — a stronger model gives a richer, more reliable analysis)." },
  { id: "summary", label: "Summaries / triage", tier: "light", toolsNeeded: false, help: "Quick condensing and classification." },
];

// Per-tier preference order for auto routing. Free-first (Groq/Cerebras/GLM-Flash),
// then the DeepInfra paid floor, then the rest — matching the cost strategy.
const TIER_PRIORITY: Record<ModelTier, string[]> = {
  heavy: ["cerebras", "groq", "glm-flash", "deepinfra-gptoss", "deepinfra-deepseek-v32", "deepinfra-deepseek", "opus", "fable", "qwen-max", "minimax", "gpt", "deepseek-reasoner", "sonnet"],
  standard: ["cerebras", "groq", "glm-flash", "deepinfra-gptoss", "deepinfra-deepseek", "sonnet", "gpt", "deepseek-chat", "minimax", "qwen-plus", "glm-plus", "kimi", "gemini-pro"],
  light: ["cerebras", "glm-flash", "groq", "deepinfra-deepseek", "haiku", "gpt-mini", "qwen-turbo", "deepseek-chat", "gemini-flash"],
};

export type ModelRouting = {
  mode: "auto" | "manual";
  defaultModel: string; // used in manual mode when a task has no explicit pick
  tasks: Record<string, string>; // taskId → modelId, or "auto"
};

// Owner strategy (2026-06-17): free-first per duty, with the routing.ts
// FALLBACK_ORDER (free trio → DeepInfra paid floor) covering exhaustion/outages.
// Per-task primaries below are DEFAULTS — override any of them in Settings → Models.
//  • chat/support_reply → Groq first (US-hosted; support_reply keeps PII off the
//    free CN endpoint as the primary)
//  • captions/outreach/summary → Cerebras first (huge free budget, fast)
//  • daily_report → GLM-4.7-Flash first (203K context for summarizing a lot)
export const DEFAULT_ROUTING: ModelRouting = {
  mode: "manual",
  defaultModel: "groq",
  tasks: {
    chat: "cerebras", // gpt-oss-120b (free, strong reasoning, ~99% cached) — the smart default brain
    support_reply: "cerebras", // gpt-oss-120b (US-hosted → PII-safe, smart, free) — better support drafts than Llama
    social_caption: "cerebras",
    outreach_draft: "cerebras",
    daily_report: "glm-flash",
    content_strategy: "cerebras", // gpt-oss-120b (free, strong, US-hosted); bump to opus/fable in Settings for richer analysis
    summary: "cerebras",
  },
};

// Pure resolver: given the routing config, the available model ids, and a task,
// return the chosen ModelDef. `requireTools` filters to tool-capable models
// (and never picks Gemini, which the tool loop doesn't drive).
export function resolveModel(
  taskId: string,
  routing: ModelRouting,
  available: Set<string>,
  requireTools = false,
): ModelDef | null {
  const ok = (id: string | undefined): ModelDef | null => {
    if (!id) return null;
    const m = MODELS_BY_ID[id];
    if (!m || !available.has(id)) return null;
    if (requireTools && (!m.tools || m.kind === "gemini")) return null;
    return m;
  };

  // 1) explicit per-task pick
  const pick = routing.tasks[taskId];
  if (pick && pick !== "auto") {
    const m = ok(pick);
    if (m) return m;
  }

  const task = TESS_TASKS.find((t) => t.id === taskId);
  const tier = task?.tier ?? "standard";

  // 2) auto by tier (when mode=auto, or the task is explicitly "auto")
  if (routing.mode === "auto" || pick === "auto") {
    for (const id of TIER_PRIORITY[tier]) {
      const m = ok(id);
      if (m) return m;
    }
  }

  // 3) manual default
  const def = ok(routing.defaultModel);
  if (def) return def;

  // 4) anything available (respecting tool requirement)
  for (const m of MODELS) {
    const c = ok(m.id);
    if (c) return c;
  }
  return null;
}
