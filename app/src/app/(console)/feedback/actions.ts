"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { feedback } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FeedbackStatus } from "@/lib/feedback";

export async function setFeedbackStatus(id: string, status: FeedbackStatus) {
  const user = await requireOperator();
  if (!user) return;
  await db.update(feedback).set({ status }).where(eq(feedback.id, id));
  await audit({
    actorId: user.id,
    actorName: user.name,
    action: "feedback.triage",
    target: id,
    detail: { status },
  });
  revalidatePath("/feedback");
}

export async function bulkSetFeedbackStatus(ids: string[], status: FeedbackStatus) {
  const user = await requireOperator();
  if (!user || ids.length === 0) return;
  await db.update(feedback).set({ status }).where(inArray(feedback.id, ids));
  await audit({ actorId: user.id, actorName: user.name, action: "feedback.bulk_triage", detail: { status, count: ids.length } });
  revalidatePath("/feedback");
}

export async function deleteFeedback(ids: string[]) {
  const user = await requireOperator();
  if (!user || ids.length === 0) return;
  await db.delete(feedback).where(inArray(feedback.id, ids));
  await audit({ actorId: user.id, actorName: user.name, action: "feedback.delete", detail: { count: ids.length } });
  revalidatePath("/feedback");
}
