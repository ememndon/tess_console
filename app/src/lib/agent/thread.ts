import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { tessMessages, approvals } from "@/lib/db/schema";

export type Attachment = { id: string; name: string; mime: string; size: number };
export type ThreadMsg = { id: string; role: string; author: string | null; content: string | null; tool: string | null; channel: string; at: string; attachments: Attachment[] };

// Scoped to one conversation (console chats are private per admin).
export async function getThread(conversationId: string, limit = 80): Promise<ThreadMsg[]> {
  const rows = (
    await db.select().from(tessMessages).where(eq(tessMessages.conversationId, conversationId)).orderBy(desc(tessMessages.createdAt)).limit(limit)
  ).reverse();
  return rows
    .filter((r) => r.role !== "system")
    .map((r) => ({ id: r.id, role: r.role, author: r.author, content: r.content, tool: r.toolName, channel: r.channel, at: r.createdAt.toISOString(), attachments: (r.attachments as Attachment[]) ?? [] }));
}

export type ApprovalLite = { id: string; kind: string; title: string; summary: string | null; module: string; requestedVia: string; at: string };

export async function getPendingApprovals(): Promise<ApprovalLite[]> {
  const rows = await db.select().from(approvals).where(eq(approvals.status, "pending")).orderBy(desc(approvals.createdAt));
  return rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, summary: a.summary, module: a.module, requestedVia: a.requestedVia, at: a.createdAt.toISOString() }));
}

export async function pendingApprovalCount(): Promise<number> {
  const rows = await db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.status, "pending"), isNull(approvals.decidedAt)));
  return rows.length;
}

// Full agent-screen log (activity feed + instruction history). Returns the
// newest tess_messages; the page splits them into Tess's actions vs. the
// instructions she's been given.
export async function getAgentLog(limit = 120): Promise<ThreadMsg[]> {
  const rows = await db.select().from(tessMessages).orderBy(desc(tessMessages.createdAt)).limit(limit);
  return rows
    .filter((r) => r.role !== "system")
    .map((r) => ({ id: r.id, role: r.role, author: r.author, content: r.content, tool: r.toolName, channel: r.channel, at: r.createdAt.toISOString(), attachments: (r.attachments as Attachment[]) ?? [] }));
}
