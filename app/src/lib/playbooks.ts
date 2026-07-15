import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { playbooks } from "./db/schema";
import type { PlaybookLite, Step } from "./playbooks-types";

function toLite(p: typeof playbooks.$inferSelect): PlaybookLite {
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    trigger: p.trigger,
    steps: (p.steps as Step[]) ?? [],
    body: p.body,
    tags: (p.tags as string[]) ?? [],
    status: p.status,
    createdBy: p.createdBy,
    updatedBy: p.updatedBy,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getPlaybooks(): Promise<PlaybookLite[]> {
  const rows = await db.select().from(playbooks).orderBy(desc(playbooks.updatedAt));
  return rows.map(toLite);
}

export async function getPlaybook(id: string): Promise<PlaybookLite | null> {
  const [p] = await db.select().from(playbooks).where(eq(playbooks.id, id)).limit(1);
  return p ? toLite(p) : null;
}

export async function playbookCategoryCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ category: playbooks.category, n: sql<number>`count(*)`.mapWith(Number) })
    .from(playbooks)
    .groupBy(playbooks.category);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category] = r.n;
  return out;
}
