"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { playbooks } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { Step } from "@/lib/playbooks-types";
import { PB_CATEGORIES } from "@/lib/playbooks-types";

export type PlaybookInput = {
  id?: string;
  title: string;
  category: string;
  trigger?: string;
  steps: Step[];
  body?: string;
  tags: string[];
  status: string;
};

function clean(input: PlaybookInput) {
  const steps = (input.steps ?? []).map((s) => ({ text: s.text.trim(), needsApproval: !!s.needsApproval })).filter((s) => s.text);
  return {
    title: input.title.trim(),
    category: (PB_CATEGORIES as readonly string[]).includes(input.category) ? input.category : "general",
    trigger: input.trigger?.trim() || null,
    steps,
    body: input.body?.trim() || null,
    tags: (input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    status: ["active", "draft", "archived"].includes(input.status) ? input.status : "active",
  };
}

export async function savePlaybook(input: PlaybookInput): Promise<{ ok: boolean; message: string; id?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const v = clean(input);
  if (!v.title) return { ok: false, message: "Give the playbook a title." };
  if (v.steps.length === 0) return { ok: false, message: "Add at least one step." };

  if (input.id) {
    await db
      .update(playbooks)
      .set({ ...v, status: v.status as typeof playbooks.$inferInsert.status, updatedBy: user.name, updatedAt: new Date() })
      .where(eq(playbooks.id, input.id));
    await audit({ actorId: user.id, actorName: user.name, action: "playbook.update", target: input.id, detail: { title: v.title } });
    revalidatePath("/playbooks");
    return { ok: true, message: "Playbook saved.", id: input.id };
  }
  const [created] = await db
    .insert(playbooks)
    .values({ ...v, status: v.status as typeof playbooks.$inferInsert.status, createdBy: user.name })
    .returning({ id: playbooks.id });
  await audit({ actorId: user.id, actorName: user.name, action: "playbook.create", target: created.id, detail: { title: v.title } });
  revalidatePath("/playbooks");
  return { ok: true, message: "Playbook created.", id: created.id };
}

export async function deletePlaybook(id: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.delete(playbooks).where(eq(playbooks.id, id));
  await audit({ actorId: user.id, actorName: user.name, action: "playbook.delete", target: id });
  revalidatePath("/playbooks");
  return { ok: true };
}

export async function duplicatePlaybook(id: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  const [p] = await db.select().from(playbooks).where(eq(playbooks.id, id)).limit(1);
  if (!p) return { ok: false };
  await db.insert(playbooks).values({
    title: `${p.title} (copy)`,
    category: p.category,
    trigger: p.trigger,
    steps: p.steps,
    body: p.body,
    tags: p.tags,
    status: "draft",
    createdBy: user.name,
  });
  revalidatePath("/playbooks");
  return { ok: true };
}
