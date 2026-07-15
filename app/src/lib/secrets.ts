import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { secrets } from "./db/schema";
import { decryptSecret } from "./vault";

export type SecretState = {
  status: "untested" | "ok" | "failed";
  lastTestedAt: Date | null;
  updatedAt: Date;
  updatedBy: string;
};

/** Which secrets are set and their last-test status — never the values themselves. */
export async function listSecretState(): Promise<Record<string, SecretState>> {
  const rows = await db.select().from(secrets);
  const out: Record<string, SecretState> = {};
  for (const r of rows) {
    out[r.key] = {
      status: r.status,
      lastTestedAt: r.lastTestedAt,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    };
  }
  return out;
}

/** Decrypt a single secret — server-only, used by test probes and (later) integrations. */
export async function getSecretValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(secrets).where(eq(secrets.key, key)).limit(1);
  return row ? decryptSecret(row.valueEnc) : null;
}

export type TestResult = { ok: boolean; message: string };

async function timedFetch(url: string, init: RequestInit = {}, ms = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Each probe is a cheap, free, authenticated request that validates the key
// without side effects or token spend. Dispatched by secret key.
const PROBES: Record<string, (value: string) => Promise<TestResult>> = {
  async anthropic_oauth_token(v) {
    // Subscription / Claude Code OAuth tokens authenticate with a Bearer header
    // plus the oauth beta header — NOT x-api-key (that's for pay-per-use keys).
    const r = await timedFetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: {
        Authorization: `Bearer ${v}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
    if (r.ok) return { ok: true, message: "Token valid — subscription auth reachable." };
    if (r.status === 401) return { ok: false, message: "Rejected (401): invalid or expired OAuth token." };
    return { ok: false, message: `Unexpected response (${r.status}).` };
  },
  async anthropic_api_key(v) {
    // Pay-per-use API keys use x-api-key (not Bearer).
    const r = await timedFetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": v, "anthropic-version": "2023-06-01" },
    });
    if (r.ok) return { ok: true, message: "Key valid — Anthropic reachable." };
    if (r.status === 401) return { ok: false, message: "Rejected (401): invalid API key." };
    return { ok: false, message: `Unexpected response (${r.status}).` };
  },
  async openai_api_key(v) {
    const r = await timedFetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${v}` } });
    return r.ok ? { ok: true, message: "Key valid." } : { ok: false, message: `Rejected (${r.status}).` };
  },
  async deepseek_api_key(v) {
    const r = await timedFetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${v}` },
    });
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async qwen_api_key(v) {
    const r = await timedFetch("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", { headers: { Authorization: `Bearer ${v}` } });
    return r.ok ? { ok: true, message: "Key valid." } : { ok: false, message: `Rejected (${r.status}).` };
  },
  async zhipu_api_key(v) {
    const r = await timedFetch("https://open.bigmodel.cn/api/paas/v4/models", { headers: { Authorization: `Bearer ${v}` } });
    // Some Zhipu deployments return 400 on a bare GET but still authenticate; treat non-401/403 as reachable.
    if (r.ok) return { ok: true, message: "Key valid." };
    return r.status === 401 || r.status === 403 ? { ok: false, message: `Rejected (${r.status}).` } : { ok: true, message: "Reachable (key accepted)." };
  },
  async moonshot_api_key(v) {
    const r = await timedFetch("https://api.moonshot.cn/v1/models", { headers: { Authorization: `Bearer ${v}` } });
    return r.ok ? { ok: true, message: "Key valid." } : { ok: false, message: `Rejected (${r.status}).` };
  },
  async minimax_api_key(v) {
    // No reliable /models listing on the OpenAI-compat layer — do a 1-token
    // completion and read MiniMax's base_resp.status_code (essentially free).
    const r = await timedFetch("https://api.minimax.io/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${v}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "MiniMax-M2", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Rejected (${r.status}): invalid API key.` };
    const j = (await r.json().catch(() => null)) as { base_resp?: { status_code?: number; status_msg?: string } } | null;
    const code = j?.base_resp?.status_code;
    if (code === 1004 || code === 2049) return { ok: false, message: "Rejected: invalid API key." };
    if (code === 1008) return { ok: true, message: "Key valid (account balance is empty)." };
    if (r.ok || code === 0) return { ok: true, message: "Key valid." };
    return { ok: false, message: j?.base_resp?.status_msg ? `Rejected: ${j.base_resp.status_msg}` : `Rejected (${r.status}).` };
  },
  async gemini_api_key(v) {
    const r = await timedFetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(v)}&pageSize=1`,
    );
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async groq_api_key(v) {
    const r = await timedFetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${v}` },
    });
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async cerebras_api_key(v) {
    const r = await timedFetch("https://api.cerebras.ai/v1/models", {
      headers: { Authorization: `Bearer ${v}` },
    });
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async deepinfra_api_key(v) {
    const r = await timedFetch("https://api.deepinfra.com/v1/openai/models", {
      headers: { Authorization: `Bearer ${v}` },
    });
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async telegram_bot_token(v) {
    const r = await timedFetch(`https://api.telegram.org/bot${encodeURIComponent(v)}/getMe`);
    const j = (await r.json().catch(() => null)) as { ok?: boolean; result?: { username?: string } } | null;
    return r.ok && j?.ok
      ? { ok: true, message: `Bot @${j.result?.username ?? "?"} reachable.` }
      : { ok: false, message: "Invalid bot token." };
  },
  async healthchecks_api_key(v) {
    const r = await timedFetch("https://healthchecks.io/api/v3/checks/", {
      headers: { "X-Api-Key": v },
    });
    return r.ok
      ? { ok: true, message: "Key valid — checks readable." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async uptimerobot_api_key(v) {
    const r = await timedFetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: `api_key=${encodeURIComponent(v)}&format=json`,
    });
    const j = (await r.json().catch(() => null)) as { stat?: string; error?: { message?: string } } | null;
    return j?.stat === "ok"
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: j?.error?.message ?? "Invalid API key." };
  },
  async gsc_service_account(v) {
    const { gscListSites, domainMatchesProperty } = await import("./gsc");
    const { SITE_META, SITE_KEYS } = await import("./site-scope");
    let sites;
    try {
      sites = await gscListSites(v);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Could not reach Search Console." };
    }
    const ours = SITE_KEYS.filter((k) =>
      sites.some((s) => domainMatchesProperty(SITE_META[k].domain, s.siteUrl)),
    );
    if (sites.length === 0)
      return { ok: false, message: "Key is valid but has no properties yet — add it as a user on each GSC property." };
    const names = ours.map((k) => SITE_META[k].name);
    return {
      ok: true,
      message: `Connected — ${sites.length} propert${sites.length === 1 ? "y" : "ies"} visible${
        names.length ? `; matched: ${names.join(", ")}` : " (none of your sites added yet)"
      }.`,
    };
  },
  async elevenlabs_api_key(v) {
    const hdr = { "xi-api-key": v };
    // Prefer /v1/user (shows the credit balance) — but that needs the user_read scope.
    // ElevenLabs returns 401 with detail.status="missing_permissions" for an otherwise
    // valid key that lacks a scope, so distinguish that from a genuinely bad key.
    const userRes = await timedFetch("https://api.elevenlabs.io/v1/user", { headers: hdr });
    if (userRes.ok) {
      const j = (await userRes.json().catch(() => null)) as {
        subscription?: { tier?: string; character_count?: number; character_limit?: number };
      } | null;
      const s = j?.subscription;
      if (s && s.character_limit != null && s.character_count != null) {
        const left = Math.max(0, s.character_limit - s.character_count);
        return { ok: true, message: `Key valid — ${s.tier ?? "plan"}: ${left.toLocaleString()} of ${s.character_limit.toLocaleString()} credits left this month.` };
      }
      return { ok: true, message: "Key valid." };
    }
    const userBody = await userRes.text().catch(() => "");
    const userMissingPerm = /missing_permissions/i.test(userBody);
    // user_read absent (or key bad) — fall back to /v1/voices, which Demo Studio actually
    // uses (resolving voice names→IDs). If that works, the key is fine for voiceover.
    const voicesRes = await timedFetch("https://api.elevenlabs.io/v1/voices?page_size=1", { headers: hdr });
    if (voicesRes.ok) {
      return { ok: true, message: "Key valid for voiceover. Add the 'User' read scope too if you want the credit balance shown here." };
    }
    const voicesBody = await voicesRes.text().catch(() => "");
    if (/missing_permissions/i.test(voicesBody) || userMissingPerm) {
      return {
        ok: false,
        message: "Key is valid but too narrowly scoped — Demo Studio needs Voices (read) + Text to Speech. In ElevenLabs → API Keys, give this key access to those (or set it to 'Has access to all').",
      };
    }
    if (voicesRes.status === 401 || userRes.status === 401) return { ok: false, message: "Rejected (401): invalid API key." };
    return { ok: false, message: `Rejected (${voicesRes.status}).` };
  },
  async pexels_api_key(v) {
    const r = await timedFetch("https://api.pexels.com/v1/curated?per_page=1", {
      headers: { Authorization: v },
    });
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
  async youtube_api_key(v) {
    // Cheap (1 unit), no side effects, no special params.
    const r = await timedFetch(`https://www.googleapis.com/youtube/v3/i18nLanguages?part=snippet&hl=en&key=${encodeURIComponent(v)}`);
    if (r.ok) return { ok: true, message: "Key valid — YouTube Data API reachable." };
    const body = await r.text().catch(() => "");
    if (/API key not valid|keyInvalid|API_KEY_INVALID/i.test(body)) return { ok: false, message: "Rejected: invalid API key." };
    if (/has not been used|accessNotConfigured|SERVICE_DISABLED/i.test(body)) return { ok: false, message: "Enable 'YouTube Data API v3' for this key's project in Google Cloud Console, then retry." };
    if (/quotaExceeded|RESOURCE_EXHAUSTED/i.test(body)) return { ok: false, message: "Key valid but daily quota is exhausted; it resets at midnight Pacific." };
    return { ok: false, message: `Rejected (${r.status}).` };
  },
  async tavily_api_key(v) {
    const r = await timedFetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { authorization: `Bearer ${v}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "partnership outreach test", max_results: 1, search_depth: "basic" }),
    });
    if (r.ok) return { ok: true, message: "Key valid — prospect search ready." };
    if (r.status === 401) return { ok: false, message: "Rejected (401): invalid Tavily API key." };
    return { ok: false, message: `Rejected (${r.status}).` };
  },
  async pixabay_api_key(v) {
    const r = await timedFetch(`https://pixabay.com/api/?key=${encodeURIComponent(v)}&per_page=3`);
    return r.ok
      ? { ok: true, message: "Key valid." }
      : { ok: false, message: `Rejected (${r.status}).` };
  },
};

export async function runSecretProbe(key: string, value: string): Promise<TestResult> {
  const probe = PROBES[key];
  if (!probe) return { ok: false, message: "No automated test for this connection yet." };
  try {
    return await probe(value);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, message: aborted ? "Timed out after 10s." : "Network error reaching the provider." };
  }
}
