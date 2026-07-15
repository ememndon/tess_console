// The vault's catalog of known connections. The list is the
// source of truth for what can be configured; values live encrypted in the DB.
// Client-safe (no server imports) so the Settings UI can render from it.

export type SecretDef = {
  key: string;
  label: string;
  category: string;
  help: string;
  placeholder?: string;
  // true when a real "test connection" probe exists (status indicator).
  testable: boolean;
};

export const SECRET_CATEGORIES = [
  "LLM Providers",
  "Messaging",
  "Monitoring",
  "Search & SEO",
  "Media",
  "Integrations",
] as const;

export const SECRET_CATALOG: SecretDef[] = [
  {
    key: "anthropic_api_key",
    label: "Claude (Anthropic API key)",
    category: "LLM Providers",
    help: "Pay-per-use Anthropic API key (starts with sk-ant-api…) — powers Tess (Opus/Sonnet/Haiku/Fable). Test validates it against the models endpoint.",
    placeholder: "sk-ant-api…",
    testable: true,
  },
  {
    key: "anthropic_oauth_token",
    label: "Claude (subscription OAuth — fallback)",
    category: "LLM Providers",
    help: "Optional alternative to the API key: a Claude subscription OAuth token (from `claude setup-token`, sk-ant-oat01-…). Used only if no API key is set.",
    placeholder: "sk-ant-oat01-…",
    testable: true,
  },
  {
    key: "openai_api_key",
    label: "OpenAI",
    category: "LLM Providers",
    help: "GPT-4o / GPT-4o-mini. Test calls the models endpoint.",
    placeholder: "sk-…",
    testable: true,
  },
  {
    key: "deepseek_api_key",
    label: "DeepSeek (China)",
    category: "LLM Providers",
    help: "Low-cost V3 + R1 reasoner — very cost-effective for bulk text.",
    placeholder: "sk-…",
    testable: true,
  },
  {
    key: "qwen_api_key",
    label: "Qwen / Alibaba (China)",
    category: "LLM Providers",
    help: "DashScope key for Qwen Max/Plus/Turbo (OpenAI-compatible international endpoint).",
    testable: true,
  },
  {
    key: "zhipu_api_key",
    label: "Zhipu GLM (China)",
    category: "LLM Providers",
    help: "GLM-4-Plus / GLM-4-Flash from Zhipu AI (open.bigmodel.cn).",
    testable: true,
  },
  {
    key: "moonshot_api_key",
    label: "Kimi / Moonshot (China)",
    category: "LLM Providers",
    help: "Moonshot (Kimi) long-context models, OpenAI-compatible.",
    placeholder: "sk-…",
    testable: true,
  },
  {
    key: "minimax_api_key",
    label: "MiniMax (China)",
    category: "LLM Providers",
    help: "MiniMax-M2 — cost-effective agentic model (tool use, 205K context), OpenAI-compatible. Get the key + group from platform.minimax.io.",
    testable: true,
  },
  {
    key: "gemini_api_key",
    label: "Google Gemini",
    category: "LLM Providers",
    help: "Gemini 2.0 Flash / 1.5 Pro — generous free tier.",
    testable: true,
  },
  {
    key: "groq_api_key",
    label: "Groq",
    category: "LLM Providers",
    help: "Fast free-tier inference (Llama 3.3 70B).",
    placeholder: "gsk_…",
    testable: true,
  },
  {
    key: "cerebras_api_key",
    label: "Cerebras",
    category: "LLM Providers",
    help: "Very fast free-tier inference (Llama 3.3 70B) — 1M tokens/day. Part of Tess's free trio.",
    placeholder: "csk-…",
    testable: true,
  },
  {
    key: "deepinfra_api_key",
    label: "DeepInfra",
    category: "LLM Providers",
    help: "Cheap pay-as-you-go floor (DeepSeek V4 Flash) — used only when the free tiers are exhausted.",
    placeholder: "…",
    testable: true,
  },
  {
    key: "telegram_bot_token",
    label: "Telegram Bot",
    category: "Messaging",
    help: "Bot token from @BotFather — powers approvals and alerts. Test calls getMe.",
    placeholder: "123456:ABC-DEF…",
    testable: true,
  },
  {
    key: "healthchecks_api_key",
    label: "healthchecks.io",
    category: "Monitoring",
    help: "Read-only project API key so the console can show heartbeat status. Owner's personal account.",
    testable: true,
  },
  {
    key: "uptimerobot_api_key",
    label: "UptimeRobot",
    category: "Monitoring",
    help: "Read-only API key for external uptime of the console and the three sites.",
    placeholder: "u1234567-…",
    testable: true,
  },
  {
    key: "gsc_service_account",
    label: "Google Search Console (service account)",
    category: "Search & SEO",
    help: "Paste the full service-account JSON key. Grant access by adding its client_email as a user on each Search Console property (Settings → Users and permissions). Test lists the properties the key can read and matches them to your sites.",
    placeholder: '{ "type": "service_account", "client_email": "…", "private_key": "…" }',
    testable: true,
  },
  {
    key: "tavily_api_key",
    label: "Tavily (prospect web search)",
    category: "Search & SEO",
    help: "Powers admin-initiated prospect discovery in Outreach → Prospects (Tess never auto-searches). Free tier ~1,000 searches/mo. Get the key at app.tavily.com (starts with tvly-). Test runs a sample search.",
    placeholder: "tvly-…",
    testable: true,
  },
  {
    key: "elevenlabs_api_key",
    label: "ElevenLabs (demo voiceover)",
    category: "Media",
    help: "Powers Demo Studio voiceover (eleven:<voice>, e.g. Aria). Starter plan = 30,000 credits/mo, no daily cap. Get the key from elevenlabs.io → Profile → API Keys. Test validates it and shows remaining credits this month.",
    placeholder: "sk_…",
    testable: true,
  },
  {
    key: "pexels_api_key",
    label: "Pexels",
    category: "Media",
    help: "Free stock photos/video for banners and clips.",
    testable: true,
  },
  {
    key: "pixabay_api_key",
    label: "Pixabay",
    category: "Media",
    help: "Free stock media, second source.",
    testable: true,
  },
  {
    key: "youtube_api_key",
    label: "YouTube Data API (viral research)",
    category: "Search & SEO",
    help: "Powers the Content Director: finds viral videos in your niche and scores outliers (views vs each channel's baseline). Free quota ~10,000 units/day. Create a key in Google Cloud Console → APIs & Services → Credentials, after enabling 'YouTube Data API v3'. Test makes a cheap API call.",
    placeholder: "AIza…",
    testable: true,
  },
  {
    key: "mcp_access_token",
    label: "Content Director access token (MCP / REST)",
    category: "Integrations",
    help: "Bearer token that lets an external AI (Claude or any model/agent) connect to Tess's Content Director over the MCP server and REST API. Generate a long random string and paste it here; use the same value as the bearer token in the connector. Keep it secret; rotate any time by changing it here.",
    placeholder: "a long random string",
    testable: false,
  },
];
