import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { notifications, settings } from "./db/schema";
import { DEFAULT_PREFS, type NotificationPrefs } from "./notification-prefs";

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "notification_prefs"));
  const v = (row?.value as Partial<NotificationPrefs>) ?? {};
  return { ...DEFAULT_PREFS, ...v, modules: { ...DEFAULT_PREFS.modules, ...(v.modules ?? {}) } };
}

export async function getNotifications(limit = 20) {
  return db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function getUnreadCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(notifications)
    .where(isNull(notifications.readAt));
  return row?.c ?? 0;
}

export type NotifFilters = { severity?: string; module?: string; unreadOnly?: boolean };

export async function getNotificationCenter(f: NotifFilters, limit = 300) {
  const conds = [];
  if (f.severity) conds.push(eq(notifications.severity, f.severity as "info" | "warning" | "critical"));
  if (f.module) conds.push(eq(notifications.module, f.module));
  if (f.unreadOnly) conds.push(isNull(notifications.readAt));
  return db
    .select()
    .from(notifications)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function notificationFacets(): Promise<{ modules: string[]; bySeverity: Record<string, number>; unread: number; total: number }> {
  const mods = await db.selectDistinct({ m: notifications.module }).from(notifications).orderBy(notifications.module);
  const sev = await db
    .select({ s: notifications.severity, c: sql<number>`count(*)`.mapWith(Number), u: sql<number>`count(*) FILTER (WHERE ${notifications.readAt} is null)`.mapWith(Number) })
    .from(notifications)
    .groupBy(notifications.severity);
  const bySeverity: Record<string, number> = {};
  let unread = 0;
  let total = 0;
  for (const r of sev) {
    bySeverity[r.s] = r.c;
    unread += r.u;
    total += r.c;
  }
  return { modules: mods.map((r) => r.m), bySeverity, unread, total };
}

// Notification routing config — per-severity delivery channels +
// quiet hours. Delivery itself joins via the agent's notify() chokepoint (Phase 7).
export type NotificationRouting = {
  info: { telegram: boolean; email: boolean };
  warning: { telegram: boolean; email: boolean };
  critical: { telegram: boolean; email: boolean };
  quietHours: { enabled: boolean; start: string; end: string }; // HH:MM UTC; criticals bypass quiet hours
};

export const DEFAULT_ROUTING: NotificationRouting = {
  info: { telegram: false, email: false },
  warning: { telegram: true, email: false },
  critical: { telegram: true, email: true },
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
};

export async function getNotificationRouting(): Promise<NotificationRouting> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "notification_routing"));
  return { ...DEFAULT_ROUTING, ...((row?.value as Partial<NotificationRouting>) ?? {}) };
}
