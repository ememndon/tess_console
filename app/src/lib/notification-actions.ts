"use server";

import { revalidatePath } from "next/cache";
import { eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { notifications, settings } from "./db/schema";
import { getCurrentUser, requireOperator } from "./auth";
import { audit } from "./audit";
import type { NotificationRouting } from "./notifications";
import type { NotificationPrefs } from "./notification-prefs";

// The notification center is shared (not per-user): marking read or clearing it
// affects what everyone — including admins — sees. These mutations carry no auth
// check on their own, and server actions are callable directly, so each one must
// require an operator (manager+). Read-only "user" accounts can view but not wipe.
export async function markAllNotificationsRead() {
  if (!(await requireOperator())) return;
  await db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt));
  revalidatePath("/", "layout");
}

export async function markNotificationRead(id: string) {
  if (!(await requireOperator())) return;
  await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  revalidatePath("/", "layout");
}

export async function markNotificationUnread(id: string) {
  if (!(await requireOperator())) return;
  await db.update(notifications).set({ readAt: null }).where(eq(notifications.id, id));
  revalidatePath("/", "layout");
}

// Clear already-read notifications to keep the center tidy.
export async function clearReadNotifications() {
  if (!(await requireOperator())) return;
  await db.delete(notifications).where(isNotNull(notifications.readAt));
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

// Clear the whole list — read and unread alike. Used by the bell panel's
// "Clear list" action. Deterministic monitors re-raise anything still active
// (e.g. a pending security update) on their next run, so this is safe to use.
export async function clearAllNotifications() {
  if (!(await requireOperator())) return;
  await db.delete(notifications);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function saveNotificationRouting(routing: NotificationRouting): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Only an admin can change routing." };
  await db
    .insert(settings)
    .values({ key: "notification_routing", value: routing })
    .onConflictDoUpdate({ target: settings.key, set: { value: routing, updatedAt: new Date() } });
  await audit({ actorId: user.id, actorName: user.name, action: "settings.notification_routing.update" });
  revalidatePath("/settings");
  return { ok: true, message: "Routing saved." };
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Only an admin can change notification preferences." };
  await db
    .insert(settings)
    .values({ key: "notification_prefs", value: prefs })
    .onConflictDoUpdate({ target: settings.key, set: { value: prefs, updatedAt: new Date() } });
  await audit({ actorId: user.id, actorName: user.name, action: "settings.notification_prefs.update" });
  revalidatePath("/settings");
  return { ok: true, message: "In-app notification preferences saved." };
}
