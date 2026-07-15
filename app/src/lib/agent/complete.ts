import "server-only";
import { getSecretValue } from "@/lib/secrets";
import { getAnthropicClient } from "./claude";
import { recordCost, budgetStatus } from "./cost";
import { resolveChainForTask } from "./routing";
import { type ModelDef } from "./models";
import { llmCacheKey, readLlmCache, writeLlmCache } from "./cache";

// ── OpenAI-compatible chat (OpenAI, DeepSeek, Qwen, GLM/Zhipu, Kimi, Groq) ──
export type OAToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
// Content is usually a string; for vision turns the user message becomes an array
// of parts (text + image_url data URLs), which OpenAI-compatible vision endpoints accept.
export type OAContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type OAMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null | OAContentPart[]; tool_calls?: OAToolCall[]; tool_call_id?: string };
export type OATool = { type: "function"; function: { name: string; description: string; parameters: object } };

export type OAResult = { message: { content: string | null; tool_calls?: OAToolCall[] }; usage: { in: number; out: number; cachedIn: number } };

// PROMPT CACHING. Every provider Tess uses caches automatically: it matches the
// leading prefix of a request (system prompt + tool definitions) against recently
// seen prefixes and bills/serves the match cheaper and faster. There is no opt-in
// flag — the lever is keeping that prefix byte-stable (our system+tools block is)
// and, where supported, passing a stable routing key so related requests land on
// the same cache node.
//
// `prompt_cache_key` is an OpenAI-style routing hint. Cerebras + OpenAI document
// it; Zhipu/GLM strictly validates request fields and 400s on unknown params, and
// Groq/DeepSeek/DeepInfra cache automatically without it — so we only send it to
// the providers that accept it.
const CACHE_KEY_PROVIDERS = new Set(["cerebras", "gpt", "gpt-mini"]);

export async function openaiChat(model: ModelDef, opts: { messages: OAMessage[]; tools?: OATool[]; maxTokens?: number; temperature?: number; cacheKey?: string; reasoningEffort?: string }): Promise<OAResult> {
  const key = await getSecretValue(model.secret);
  if (!key) throw new Error(`${model.secret} not set`);
  const body: Record<string, unknown> = {
    model: model.apiModel,
    messages: opts.messages,
    tools: opts.tools && opts.tools.length ? opts.tools : undefined,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.6,
    stream: false,
  };
  // gpt-oss models emit reasoning tokens that share the max_tokens budget; light
  // tasks (captions) can dial reasoning down so the visible answer isn't truncated
  // mid-sentence. Gated to gpt-oss so other providers don't reject the field.
  if (opts.reasoningEffort && /gpt-oss/i.test(model.apiModel)) body.reasoning_effort = opts.reasoningEffort;
  if (opts.cacheKey && CACHE_KEY_PROVIDERS.has(model.id)) body.prompt_cache_key = opts.cacheKey.slice(0, 1024);
  const r = await fetch(`${model.baseURL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${model.provider} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: OAToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number };
  };
  const tokensIn = j.usage?.prompt_tokens ?? 0;
  // Cache-hit input tokens: OpenAI/Groq/Cerebras report prompt_tokens_details.cached_tokens;
  // DeepSeek reports prompt_cache_hit_tokens. Either way these bill at the cheaper read rate.
  const cachedIn = j.usage?.prompt_tokens_details?.cached_tokens ?? j.usage?.prompt_cache_hit_tokens ?? 0;
  if (cachedIn > 0) console.log(`[cache] ${model.id} served ${cachedIn}/${tokensIn} input tokens from cache (${Math.round((100 * cachedIn) / Math.max(1, tokensIn))}%)`);
  return {
    message: { content: j.choices?.[0]?.message?.content ?? null, tool_calls: j.choices?.[0]?.message?.tool_calls },
    usage: { in: tokensIn, out: j.usage?.completion_tokens ?? 0, cachedIn },
  };
}

async function geminiText(model: ModelDef, system: string, user: string, maxTokens: number): Promise<{ text: string; usage: { in: number; out: number } }> {
  const key = await getSecretValue(model.secret);
  if (!key) throw new Error(`${model.secret} not set`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.apiModel}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  return {
    text: (j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim(),
    usage: { in: j.usageMetadata?.promptTokenCount ?? 0, out: j.usageMetadata?.candidatesTokenCount ?? 0 },
  };
}

// Per-model cache-read discount: cached input tokens bill cheaper than fresh ones.
// Only set where the provider documents the rate; default 1 (no discount) keeps
// budget estimates conservative. Free-tier models are $0 so the factor is moot for
// them — this only changes real spend on the paid DeepInfra floor / DeepSeek / GPT.
const CACHE_READ_FACTOR: Record<string, number> = {
  "deepseek-chat": 0.1,
  "deepseek-reasoner": 0.1, // DeepSeek disk cache ≈ 10% of the input price
  "deepinfra-deepseek": 0.1, // DeepInfra DeepSeek disk cache ≈ 10% when it serves a hit
  "deepinfra-deepseek-v32": 0.5, // DeepSeek V3.2 cached read ≈ $0.13 vs $0.26 input (50%)
  gpt: 0.5,
  "gpt-mini": 0.5, // OpenAI cached input ≈ 50% off
  groq: 0.5,
  "groq-vision": 0.5, // Groq cached prefix ≈ 50% off (free tier, so $0 anyway)
  // Anthropic prompt caching: cached reads bill at ~10% of the input price.
  opus: 0.1,
  sonnet: 0.1,
  haiku: 0.1,
  fable: 0.1,
};

export function modelCost(model: ModelDef, tokensIn: number, tokensOut: number, cachedIn = 0): number {
  const factor = CACHE_READ_FACTOR[model.id] ?? 1;
  const billedIn = tokensIn - cachedIn + cachedIn * factor;
  return (billedIn / 1_000_000) * model.priceIn + (tokensOut / 1_000_000) * model.priceOut;
}

// Single-shot text generation, routed through the model chain (Groq → MiniMax →
// DeepSeek → OpenAI → Claude) with metering. Tries each model until one answers,
// so a throttled/failed provider never strands the task (reliability).
export async function generateRouted(opts: { taskId: string; system: string; user: string; maxTokens?: number; temperature?: number; preferModel?: string; cache?: boolean; usHosted?: boolean; reasoningEffort?: string }): Promise<{ text: string; model: string }> {
  const maxTokens = opts.maxTokens ?? 1024;

  // Exact-match response cache (mirrors the voiceover cache). Only DETERMINISTIC calls
  // are eligible: explicit `cache: true`, or an unspecified flag with a low temperature
  // (<=0.3). Creative lanes (scripts/captions at temp 0.8-0.9) are meant to vary, so
  // they're never cached. A hit returns the stored answer with no provider call.
  const cacheable = opts.cache === true || (opts.cache !== false && typeof opts.temperature === "number" && opts.temperature <= 0.3);
  const cacheKey = cacheable ? llmCacheKey({ taskId: opts.taskId, system: opts.system, user: opts.user, maxTokens, temperature: opts.temperature, preferModel: opts.preferModel }) : "";
  if (cacheKey) {
    const hit = await readLlmCache(cacheKey);
    if (hit) {
      console.log(`[llm-cache] hit ${opts.taskId} (${hit.model}) — no model call`);
      return hit;
    }
  }

  const budget = await budgetStatus();
  const chain = await resolveChainForTask(opts.taskId, false, { freeOnly: budget.pct >= 100, prefer: opts.preferModel, usHostedOnly: opts.usHosted });
  if (chain.length === 0) {
    throw new Error(budget.pct >= 100
      ? `Monthly budget cap ($${budget.capUsd.toFixed(0)}) reached — paid AI is paused. Raise it in Settings → Budgets.`
      : "No usable model — add or fix a provider key in Settings → Secrets Vault.");
  }
  let lastErr = "";

  for (const model of chain) {
    try {
      let text = "";
      let usage = { in: 0, out: 0, cachedIn: 0 };
      if (model.kind === "anthropic") {
        const client = await getAnthropicClient();
        if (!client) throw new Error("Anthropic key not set");
        const resp = await client.messages.create({ model: model.apiModel, max_tokens: maxTokens, system: opts.system, messages: [{ role: "user", content: opts.user }] });
        text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
        usage = { in: resp.usage.input_tokens, out: resp.usage.output_tokens, cachedIn: 0 };
      } else if (model.kind === "gemini") {
        const g = await geminiText(model, opts.system, opts.user, maxTokens);
        text = g.text;
        usage = { ...g.usage, cachedIn: 0 };
      } else {
        // Stable cache key per task type so a provider that supports it (Cerebras/
        // OpenAI) routes Tess's repeated single-shot calls onto the same cache node.
        const r = await openaiChat(model, { messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }], maxTokens, temperature: opts.temperature, cacheKey: `task:${opts.taskId}`, reasoningEffort: opts.reasoningEffort });
        text = (r.message.content ?? "").trim();
        usage = r.usage;
      }
      await recordCost({ taskType: opts.taskId, provider: model.id, tokensIn: usage.in, tokensOut: usage.out, costUsd: modelCost(model, usage.in, usage.out, usage.cachedIn) });
      if (text) {
        if (cacheKey) await writeLlmCache(cacheKey, { text, model: model.id });
        return { text, model: model.id };
      }
      lastErr = `${model.label} returned empty`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 160) : String(e);
    }
  }
  throw new Error(`All models failed (${lastErr}).`);
}
