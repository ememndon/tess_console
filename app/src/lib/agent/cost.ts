import "server-only";
import { gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { costLedger, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notify } from "@/lib/notify";

// Cost metering. The paid-API budget excludes the owner's Claude
// subscription + Hostinger, so subscription token usage records tokens but $0
// cost. Paid providers (DeepSeek, future image/video) record real cost.
const PRICING: Record<string, { in: number; out: number }> = {
  // USD per 1M tokens — list prices for visibility; subscription cost counts as 0.
  "anthropic-subscription": { in: 0, out: 0 },
  deepseek: { in: 0.27, out: 1.1 },
  groq: { in: 0.59, out: 0.79 },
  gemini: { in: 0, out: 0 }, // free tier
};

export function estimateCost(provider: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[provider] ?? { in: 0, out: 0 };
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
}

export async function recordCost(input: { taskType: string; provider: string; tokensIn: number; tokensOut: number; costUsd?: number }): Promise<void> {
  const costUsd = input.costUsd ?? estimateCost(input.provider, input.tokensIn, input.tokensOut);
  await db.insert(costLedger).values({
    day: new Date().toISOString().slice(0, 10),
    taskType: input.taskType,
    provider: input.provider,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costUsd,
  });
  // Any spend can push us across a threshold — alert admins at most once/day each.
  if (costUsd > 0) await maybeAlertBudget();
}

// Inform admins when we cross the degrade threshold (≥80%) or the hard cap
// (≥100%) — once per day per threshold ("auto-degrade and inform").
export async function maybeAlertBudget(): Promise<void> {
  try {
    const b = await budgetStatus();
    if (!b.degraded && b.pct < 100) return;
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "budget_alert_state"));
    const state = (row?.value as { capDay?: string; degradeDay?: string }) ?? {};
    let changed = false;
    if (b.pct >= 100 && state.capDay !== today) {
      await notify({ severity: "critical", title: "🚨 Budget cap reached", body: `Paid AI spend is $${b.spentUsd.toFixed(2)} of the $${b.capUsd.toFixed(0)} monthly cap. Tess has paused paid models and will use free-tier fallbacks only until next month or until you raise the cap in Settings → Budgets.`, module: "agent" });
      state.capDay = today;
      changed = true;
    } else if (b.degraded && b.pct < 100 && state.degradeDay !== today) {
      await notify({ severity: "warning", title: "⚠️ Budget at degrade threshold", body: `Paid AI spend is $${b.spentUsd.toFixed(2)} (${b.pct}% of the $${b.capUsd.toFixed(0)} cap). Tess is trimming to essentials. Raise the cap in Settings → Budgets if needed.`, module: "agent" });
      state.degradeDay = today;
      changed = true;
    }
    if (changed) await db.insert(settings).values({ key: "budget_alert_state", value: state }).onConflictDoUpdate({ target: settings.key, set: { value: state, updatedAt: new Date() } });
  } catch {
    /* alerting must never break a spend path */
  }
}

export type BudgetStatus = { spentUsd: number; capUsd: number; pct: number; degraded: boolean; degradeAtPct: number };

export async function budgetStatus(): Promise<BudgetStatus> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const ymd = monthStart.toISOString().slice(0, 10);
  const [row] = await db.select({ s: sql<number>`coalesce(sum(${costLedger.costUsd}),0)`.mapWith(Number) }).from(costLedger).where(gte(costLedger.day, ymd));
  const [cfg] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "budgets"));
  const b = (cfg?.value as { monthlyCapUsd?: number; degradeAtPct?: number }) ?? {};
  const capUsd = b.monthlyCapUsd ?? 20;
  const degradeAtPct = b.degradeAtPct ?? 80;
  const spentUsd = row?.s ?? 0;
  const pct = capUsd > 0 ? Math.round((100 * spentUsd) / capUsd) : 0;
  return { spentUsd, capUsd, pct, degraded: pct >= degradeAtPct, degradeAtPct };
}

export async function usageThisMonth(): Promise<{ provider: string; tokensIn: number; tokensOut: number; costUsd: number }[]> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const ymd = monthStart.toISOString().slice(0, 10);
  return db
    .select({
      provider: costLedger.provider,
      tokensIn: sql<number>`coalesce(sum(${costLedger.tokensIn}),0)`.mapWith(Number),
      tokensOut: sql<number>`coalesce(sum(${costLedger.tokensOut}),0)`.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${costLedger.costUsd}),0)`.mapWith(Number),
    })
    .from(costLedger)
    .where(gte(costLedger.day, ymd))
    .groupBy(costLedger.provider);
}
