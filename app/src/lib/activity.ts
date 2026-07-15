import "server-only";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { auditLog, costLedger } from "./db/schema";

// "What Tess did" — her own autonomous actions (actor names all start with Tess:
// "Tess", "Tess (daily posts)", "Tess (manual)", …). Excludes the owner + builder.
export type ActivityRow = { actor: string; action: string; target: string | null; at: string };
export async function getTessActivity(limit = 60): Promise<ActivityRow[]> {
  const rows = await db
    .select()
    .from(auditLog)
    .where(sql`${auditLog.actorName} ILIKE 'tess%'`)
    .orderBy(desc(auditLog.id))
    .limit(limit);
  return rows.map((r) => ({ actor: r.actorName, action: r.action, target: r.target, at: r.createdAt.toISOString() }));
}

// AI token + cost usage over the last N days, for the cost view.
export type UsageDay = { day: string; tokens: number; costUsd: number };
export type UsageProvider = { provider: string; tokens: number; costUsd: number };
export type Usage = { byDay: UsageDay[]; byProvider: UsageProvider[]; totalTokens: number; totalCost: number };

export async function getUsage(days = 14): Promise<Usage> {
  const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const tokens = sql<number>`coalesce(sum(${costLedger.tokensIn} + ${costLedger.tokensOut}), 0)`.mapWith(Number);
  const cost = sql<number>`coalesce(sum(${costLedger.costUsd}), 0)`.mapWith(Number);

  const dayRows = await db
    .select({ day: costLedger.day, tokens, cost })
    .from(costLedger)
    .where(gte(costLedger.day, since))
    .groupBy(costLedger.day)
    .orderBy(costLedger.day);
  const provRows = await db
    .select({ provider: costLedger.provider, tokens, cost })
    .from(costLedger)
    .where(gte(costLedger.day, since))
    .groupBy(costLedger.provider);

  const byDay = dayRows.map((r) => ({ day: String(r.day), tokens: r.tokens, costUsd: r.cost }));
  const byProvider = provRows
    .map((r) => ({ provider: r.provider, tokens: r.tokens, costUsd: r.cost }))
    .sort((a, b) => b.tokens - a.tokens);
  return {
    byDay,
    byProvider,
    totalTokens: byProvider.reduce((s, p) => s + p.tokens, 0),
    totalCost: byProvider.reduce((s, p) => s + p.costUsd, 0),
  };
}
