import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, tessMessages } from "@/lib/db/schema";

export type ConversationLite = { id: string; title: string; updatedAt: string };

export async function listConversations(userId: string): Promise<ConversationLite[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.channel, "console"), eq(conversations.userId, userId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(100);
  return rows.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }));
}

export async function createConversation(userId: string | null, channel = "console", title = "New chat"): Promise<string> {
  const [row] = await db.insert(conversations).values({ userId, channel, title }).returning({ id: conversations.id });
  return row.id;
}

// Most recent console conversation for this admin, or a fresh one.
export async function getOrCreateActiveConversation(userId: string): Promise<string> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channel, "console"), eq(conversations.userId, userId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return row?.id ?? createConversation(userId, "console");
}

// Shared, ownerless conversation per non-console channel (telegram/autonomous).
export async function getOrCreateChannelConversation(channel: string): Promise<string> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channel, channel), isNull(conversations.userId)))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return row?.id ?? createConversation(null, channel, channel === "telegram" ? "Telegram" : "Autonomous");
}

export async function ownsConversation(id: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ userId: conversations.userId }).from(conversations).where(eq(conversations.id, id));
  return !!row && row.userId === userId;
}

// Bump updatedAt; set the title from the first user message while still default.
export async function touchConversation(id: string, titleFrom?: string): Promise<void> {
  const set: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
  if (titleFrom) {
    const [c] = await db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, id));
    if (c && (c.title === "New chat" || !c.title)) set.title = titleFrom.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
  }
  await db.update(conversations).set(set).where(eq(conversations.id, id));
}

export async function renameConversation(id: string, userId: string, title: string): Promise<void> {
  await db
    .update(conversations)
    .set({ title: title.replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled" })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
}

export async function deleteConversation(id: string, userId: string): Promise<void> {
  if (!(await ownsConversation(id, userId))) return;
  await db.delete(tessMessages).where(eq(tessMessages.conversationId, id));
  await db.delete(conversations).where(eq(conversations.id, id));
}
