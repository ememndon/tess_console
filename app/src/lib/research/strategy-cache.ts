import "server-only";
import type { NicheStrategy } from "./analyze";

// Tiny in-process cache of the last computed strategy per niche. Lets "Build
// 30-day plan" REUSE the strategy that "Analyze strategy" just produced instead
// of paying for a second LLM call. Lives in its own module (only a type import
// from analyze) so analyze.ts and ingest.ts can both use it without a runtime
// import cycle. Per-process + non-persistent by design: a miss just recomputes.

const cache = new Map<string, { strategy: NicheStrategy; at: number }>();
const TTL_MS = 2 * 60 * 60 * 1000; // 2h backstop; fresh research invalidates immediately

const key = (niche: string) => niche.trim().toLowerCase();

export function getCachedStrategy(niche: string): NicheStrategy | null {
  const hit = cache.get(key(niche));
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) { cache.delete(key(niche)); return null; }
  return hit.strategy;
}

export function setCachedStrategy(niche: string, strategy: NicheStrategy): void {
  if (strategy.subtopics.length) cache.set(key(niche), { strategy, at: Date.now() });
}

/** Drop the cached strategy for a niche — called when new research lands so the
 * next analyze/build recomputes against the fresh outliers. */
export function invalidateStrategyCache(niche: string): void {
  cache.delete(key(niche));
}
