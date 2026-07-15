import "server-only";
import { getSecretValue } from "./secrets";

// LLM text generation. Cheap providers for bulk text; routing is
// configurable per task type. DeepSeek is the default for social copy; support-
// email drafting prefers a stronger-data-handling provider — see draft-reply.
export type LlmProvider = "deepseek" | "groq" | "gemini";

// OpenAI-compatible chat-completions providers (DeepSeek, Groq).
const OPENAI_COMPAT: Partial<Record<LlmProvider, { url: string; model: string; secret: string }>> = {
  deepseek: { url: "https://api.deepseek.com/chat/completions", model: "deepseek-chat", secret: "deepseek_api_key" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", secret: "groq_api_key" },
};

const PROVIDER_SECRET: Record<LlmProvider, string> = {
  deepseek: "deepseek_api_key",
  groq: "groq_api_key",
  gemini: "gemini_api_key",
};

/** Which providers actually have a key in the vault (for provider auto-selection). */
export async function availableProviders(): Promise<LlmProvider[]> {
  const all: LlmProvider[] = ["deepseek", "groq", "gemini"];
  const found: LlmProvider[] = [];
  for (const p of all) if (await getSecretValue(PROVIDER_SECRET[p])) found.push(p);
  return found;
}

export async function generateText(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  provider?: LlmProvider;
}): Promise<string> {
  const provider = opts.provider ?? "deepseek";

  if (provider === "gemini") {
    const key = await getSecretValue("gemini_api_key");
    if (!key) throw new Error("gemini_api_key not set");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.system }] },
        contents: [{ role: "user", parts: [{ text: opts.user }] }],
        generationConfig: { maxOutputTokens: opts.maxTokens ?? 600, temperature: opts.temperature ?? 0.7 },
      }),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim();
  }

  const cfg = OPENAI_COMPAT[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  const key = await getSecretValue(cfg.secret);
  if (!key) throw new Error(`${cfg.secret} not set`);
  const r = await fetch(cfg.url, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      max_tokens: opts.maxTokens ?? 400,
      temperature: opts.temperature ?? 0.85,
      stream: false,
    }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
  return (j.choices?.[0]?.message?.content ?? "").trim();
}
