"use server";

import { revalidatePath } from "next/cache";
import { requireOperator } from "@/lib/auth";
import { runTess } from "./run";
import { applyApprovalDecision } from "./approvals";
import { getThread, getPendingApprovals, type ThreadMsg, type ApprovalLite } from "./thread";
import {
  listConversations,
  getOrCreateActiveConversation,
  ownsConversation,
  createConversation,
  renameConversation as renameConv,
  deleteConversation as deleteConv,
  type ConversationLite,
} from "./conversations";

type SendOpts = { modelId?: string; conversationId?: string; attachmentIds?: string[] };

export async function sendToTess(text: string, opts?: SendOpts): Promise<{ ok: boolean; reply: string; conversationId?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, reply: "Not signed in." };
  if (!text.trim() && !opts?.attachmentIds?.length) return { ok: false, reply: "" };
  // Resolve/validate the conversation — it must belong to this admin.
  let conversationId = opts?.conversationId;
  if (!conversationId || !(await ownsConversation(conversationId, user.id))) {
    conversationId = await getOrCreateActiveConversation(user.id);
  }
  const r = await runTess({
    text: text.trim(),
    channel: "console",
    author: user.name,
    userId: user.id,
    modelId: opts?.modelId || undefined,
    conversationId,
    attachmentIds: opts?.attachmentIds,
  });
  return { ...r, conversationId };
}

export async function loadThread(
  conversationId?: string,
): Promise<{ messages: ThreadMsg[]; approvals: ApprovalLite[]; conversationId: string; conversations: ConversationLite[] }> {
  const user = await requireOperator();
  if (!user) return { messages: [], approvals: [], conversationId: "", conversations: [] };
  let convId = conversationId;
  if (!convId || !(await ownsConversation(convId, user.id))) convId = await getOrCreateActiveConversation(user.id);
  const [messages, approvalsList, conversations] = await Promise.all([
    getThread(convId),
    getPendingApprovals(),
    listConversations(user.id),
  ]);
  return { messages, approvals: approvalsList, conversationId: convId, conversations };
}

export async function newConversation(): Promise<{ id: string }> {
  const user = await requireOperator();
  if (!user) return { id: "" };
  return { id: await createConversation(user.id, "console") };
}

export async function renameConversation(id: string, title: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await renameConv(id, user.id, title);
  return { ok: true };
}

export async function removeConversation(id: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await deleteConv(id, user.id);
  return { ok: true };
}

export async function decideApproval(id: string, approve: boolean): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  const r = await applyApprovalDecision({ id, approve, actorId: user.id, actorName: user.name, via: "console" });
  revalidatePath("/agent");
  revalidatePath("/", "layout");
  return { ok: r.ok };
}
