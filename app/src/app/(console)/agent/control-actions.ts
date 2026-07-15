"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { getControl, setControl, type AgentModule } from "@/lib/agent/control";
import { generatePairing, registerWebhook } from "@/lib/agent/telegram-bot";

export async function setTessPaused(paused: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false };
  const c = await getControl();
  await setControl({ ...c, paused, pausedBy: paused ? user.name : undefined, pausedAt: paused ? new Date().toISOString() : undefined });
  await audit({ actorId: user.id, actorName: user.name, action: paused ? "agent.pause" : "agent.resume" });
  await notify({ severity: paused ? "warning" : "info", title: paused ? "⏸ Tess paused" : "▶ Tess resumed", body: `${paused ? "Paused" : "Resumed"} by ${user.name}. Deterministic monitoring & backups keep running.`, module: "agent" });
  revalidatePath("/agent");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setModulePaused(module: AgentModule, paused: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false };
  const c = await getControl();
  await setControl({ ...c, modules: { ...c.modules, [module]: paused } });
  await audit({ actorId: user.id, actorName: user.name, action: "agent.module_pause", target: module, detail: { paused } });
  revalidatePath("/agent");
  return { ok: true };
}

export async function startTelegramPairing(): Promise<{ ok: boolean; message: string; code?: string; botUsername?: string; deepLink?: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Only an admin can connect Telegram." };
  const r = await generatePairing(user.name);
  if (r.ok) await audit({ actorId: user.id, actorName: user.name, action: "agent.telegram.pair_code" });
  revalidatePath("/agent");
  return r;
}

export async function reRegisterTelegramWebhook(): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Only an admin can do that." };
  const r = await registerWebhook();
  if (r.ok) await audit({ actorId: user.id, actorName: user.name, action: "agent.telegram.webhook_register" });
  revalidatePath("/agent");
  return r;
}

export async function removeTelegramAdmin(chatId: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { ok: false };
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "telegram_admins"));
  const list = ((row?.value as { list?: { chatId: string }[] })?.list ?? []).filter((a) => a.chatId !== chatId);
  await db.insert(settings).values({ key: "telegram_admins", value: { list } }).onConflictDoUpdate({ target: settings.key, set: { value: { list }, updatedAt: new Date() } });
  await audit({ actorId: user.id, actorName: user.name, action: "agent.telegram.unpair", target: chatId });
  revalidatePath("/agent");
  return { ok: true };
}
