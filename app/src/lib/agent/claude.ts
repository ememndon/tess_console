import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getSecretValue } from "@/lib/secrets";

// Tess authenticates to Anthropic with a standard pay-per-use API key (x-api-key).
// (Subscription OAuth via anthropic_oauth_token is still supported as a fallback.)
export const TESS_MODEL = "claude-opus-4-8";

export async function getAnthropicClient(): Promise<Anthropic | null> {
  const apiKey = await getSecretValue("anthropic_api_key");
  if (apiKey) return new Anthropic({ apiKey, maxRetries: 2 });
  // Fallback: subscription OAuth token, if that's what's configured.
  const oauth = await getSecretValue("anthropic_oauth_token");
  if (oauth) return new Anthropic({ authToken: oauth, defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" }, maxRetries: 2 });
  return null;
}

// Back-compat alias used by earlier code paths.
export const getTessClient = getAnthropicClient;

export async function tessConfigured(): Promise<boolean> {
  return !!(await getSecretValue("anthropic_api_key")) || !!(await getSecretValue("anthropic_oauth_token"));
}
