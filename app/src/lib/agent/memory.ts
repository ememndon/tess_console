import "server-only";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tessNotes } from "@/lib/db/schema";

// Tess's durable memory. She writes facts/decisions she wants to keep
// beyond the rolling chat window; the most relevant are injected into her prompt.
export async function remember(input: { note: string; scope?: string; tags?: string[]; createdBy?: string; pinned?: boolean }): Promise<{ id: string }> {
  const [row] = await db
    .insert(tessNotes)
    .values({
      note: input.note.slice(0, 2000),
      scope: (input.scope ?? "global").slice(0, 64),
      tags: (input.tags ?? []).slice(0, 12),
      createdBy: input.createdBy ?? "tess",
      pinned: !!input.pinned,
    })
    .returning({ id: tessNotes.id });
  return { id: row.id };
}

export type MemoryNote = { id: string; scope: string; note: string; tags: string[]; createdAt: string; pinned: boolean };

// Pinned notes first, then the most recent — capped for the prompt budget.
export async function recallNotes(limit = 14): Promise<MemoryNote[]> {
  const rows = await db
    .select()
    .from(tessNotes)
    .orderBy(desc(tessNotes.pinned), desc(tessNotes.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, scope: r.scope, note: r.note, tags: (r.tags as string[]) ?? [], createdAt: r.createdAt.toISOString(), pinned: r.pinned }));
}

// Compact block for the system prompt; empty string when she has no notes yet.
export async function getMemoryBlock(): Promise<string> {
  const notes = await recallNotes(14);
  if (notes.length === 0) return "";
  const lines = notes.map((n) => `- (${n.scope}) ${n.note}`);
  return ["MEMORY — things you chose to remember (treat as your own prior decisions):", ...lines].join("\n");
}

export async function forget(id: string): Promise<void> {
  await db.delete(tessNotes).where(sql`${tessNotes.id} = ${id}`);
}
