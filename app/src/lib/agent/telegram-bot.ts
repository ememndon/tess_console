import "server-only";
import { randomBytes, randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getSecretValue } from "@/lib/secrets";
import {
  tgGetMe,
  tgSendMessage,
  tgSetWebhook,
  tgGetWebhookInfo,
  tgAnswerCallback,
  tgEditMessageText,
} from "@/lib/telegram";
import { getControl, setControl } from "./control";
import { budgetStatus } from "./cost";
import { pendingApprovalCount } from "./thread";
import { applyApprovalDecision } from "./approvals";
import { runTess } from "./run";

// Telegram command channel ("one brain, two mouths"). Admins pair their
// chat once (a code from the console), then instruct Tess and tap approve/reject
// — the same thread the console panel shows. The webhook self-secures with a
// secret token; only paired chat ids may issue commands.

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://staging.tessconsole.cloud";

type Admin = { chatId: string; name: string; pairedAt: string };
type TelegramAdmins = { list: Admin[] };
type TelegramWebhook = { secret: string; registeredUrl: string; registeredAt: string };
type TelegramPairing = { code: string; expiresAt: string; createdBy: string; attempts?: number } | null;
const MAX_PAIR_ATTEMPTS = 5;
type AlertDestinations = { telegramChatId?: string; email?: string; fromMailboxId?: string };

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  return (row?.value as T) ?? null;
}
async function writeSetting(key: string, value: unknown): Promise<void> {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function getAdmins(): Promise<Admin[]> {
  return (await readSetting<TelegramAdmins>("telegram_admins"))?.list ?? [];
}
async function isAdmin(chatId: string): Promise<boolean> {
  return (await getAdmins()).some((a) => a.chatId === chatId);
}

// ── Webhook registration ──
export async function registerWebhook(): Promise<{ ok: boolean; message: string }> {
  const token = await getSecretValue("telegram_bot_token");
  if (!token) return { ok: false, message: "Add the Telegram bot token in Settings → Secrets Vault first." };
  let wh = await readSetting<TelegramWebhook>("telegram_webhook");
  const secret = wh?.secret || randomBytes(24).toString("hex");
  const url = `${PUBLIC_BASE_URL}/api/telegram`;
  try {
    await tgSetWebhook(token, url, secret);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "setWebhook failed" };
  }
  wh = { secret, registeredUrl: url, registeredAt: new Date().toISOString() };
  await writeSetting("telegram_webhook", wh);
  return { ok: true, message: `Webhook registered at ${url}` };
}

export async function verifyWebhookSecret(headerSecret: string | null): Promise<boolean> {
  const wh = await readSetting<TelegramWebhook>("telegram_webhook");
  return !!wh?.secret && !!headerSecret && headerSecret === wh.secret;
}

// ── Pairing ──
export async function generatePairing(createdBy: string): Promise<{ ok: boolean; message: string; code?: string; botUsername?: string; deepLink?: string }> {
  const token = await getSecretValue("telegram_bot_token");
  if (!token) return { ok: false, message: "Add the Telegram bot token in Settings → Secrets Vault first." };
  let botUsername = "";
  try {
    botUsername = (await tgGetMe(token)).username;
  } catch {
    return { ok: false, message: "That bot token looks invalid — re-test it in the Secrets Vault." };
  }
  const reg = await registerWebhook();
  if (!reg.ok) return { ok: false, message: `Couldn't register the webhook: ${reg.message}` };

  const code = String(randomInt(100000, 1000000)); // 6 digits
  const pairing: TelegramPairing = { code, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), createdBy, attempts: 0 };
  await writeSetting("telegram_pairing", pairing);
  return { ok: true, message: "Pairing code generated — valid 15 minutes.", code, botUsername, deepLink: `https://t.me/${botUsername}?start=${code}` };
}

export type TelegramState = {
  tokenSet: boolean;
  botUsername: string | null;
  webhookUrl: string | null;
  webhookHealthy: boolean;
  webhookError: string | null;
  admins: { chatId: string; name: string; pairedAt: string }[];
  alertChatId: string | null;
};

export async function getTelegramState(): Promise<TelegramState> {
  const token = await getSecretValue("telegram_bot_token");
  const admins = await getAdmins();
  const dest = (await readSetting<AlertDestinations>("alert_destinations")) ?? {};
  let botUsername: string | null = null;
  let webhookUrl: string | null = null;
  let webhookHealthy = false;
  let webhookError: string | null = null;
  if (token) {
    try {
      botUsername = (await tgGetMe(token)).username;
      const info = await tgGetWebhookInfo(token);
      webhookUrl = info.url || null;
      webhookHealthy = !!info.url && !info.lastError;
      webhookError = info.lastError ?? null;
    } catch {
      /* leave defaults */
    }
  }
  return { tokenSet: !!token, botUsername, webhookUrl, webhookHealthy, webhookError, admins, alertChatId: dest.telegramChatId ?? null };
}

// ── Incoming update handling ──
type TgUser = { id?: number; first_name?: string; last_name?: string; username?: string };
type TgChat = { id?: number };
type TgMessage = { chat?: TgChat; from?: TgUser; text?: string };
type TgCallback = { id: string; from?: TgUser; message?: { chat?: TgChat; message_id?: number }; data?: string };
type TgUpdate = { message?: TgMessage; callback_query?: TgCallback };

function displayName(u?: TgUser): string {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "Telegram user";
}

async function reply(chatId: string, text: string): Promise<void> {
  const token = await getSecretValue("telegram_bot_token");
  if (token) await tgSendMessage(token, chatId, text).catch(() => {});
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.message) return handleMessage(update.message);
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat?.id != null ? String(msg.chat.id) : "";
  if (!chatId) return;
  const text = (msg.text ?? "").trim();
  const name = displayName(msg.from);

  // /start [code] — pairing or greeting.
  if (/^\/start\b/i.test(text)) {
    const code = text.replace(/^\/start@?\S*/i, "").trim();
    if (await isAdmin(chatId)) return reply(chatId, `Hi ${name} — you're already connected. Message me anything, or use /status, /pause, /resume.`);
    if (!code) return reply(chatId, "To connect, open the Tess Console → Agent → Connect Telegram, then send me /start followed by the code.");
    return pairChat(chatId, name, code);
  }

  // Everything past this point requires an authorized (paired) admin.
  if (!(await isAdmin(chatId))) {
    return reply(chatId, "You're not authorized yet. Ask the owner for a pairing code (Console → Agent → Connect Telegram), then send /start <code>.");
  }

  const cmd = text.toLowerCase().replace(/@\S+/, "");
  if (cmd === "/pause") {
    const c = await getControl();
    await setControl({ ...c, paused: true, pausedBy: name, pausedAt: new Date().toISOString() });
    return reply(chatId, "⏸️ Tess paused. Monitoring, watchdogs, scheduled publishing and backups keep running. Use /resume to bring me back.");
  }
  if (cmd === "/resume") {
    const c = await getControl();
    await setControl({ ...c, paused: false });
    return reply(chatId, "▶️ Tess resumed.");
  }
  if (cmd === "/status") return reply(chatId, await statusText());
  if (cmd === "/help") {
    return reply(chatId, "I'm Tess. Just message me normally and I'll help with your sites. Commands:\n/status — health & budget\n/pause — stop my brain\n/resume — restart\n/help — this");
  }

  // Plain instruction → the one brain. runTess persists both turns, so the console
  // panel shows this conversation too.
  if (!text) return;
  const res = await runTess({ text, channel: "telegram", author: name });
  await reply(chatId, res.reply || "(no response)");
}

async function pairChat(chatId: string, name: string, code: string): Promise<void> {
  const pairing = await readSetting<TelegramPairing>("telegram_pairing");
  if (!pairing) return reply(chatId, "There's no active pairing request. Generate a code in Console → Agent → Connect Telegram.");
  if (new Date(pairing.expiresAt).getTime() < Date.now()) {
    await writeSetting("telegram_pairing", null);
    return reply(chatId, "That code expired. Generate a new one in Console → Agent → Connect Telegram.");
  }
  if (pairing.code !== code) {
    // Brute-force guard: burn the code after too many wrong tries.
    const attempts = (pairing.attempts ?? 0) + 1;
    if (attempts >= MAX_PAIR_ATTEMPTS) {
      await writeSetting("telegram_pairing", null);
      return reply(chatId, "Too many wrong codes — this pairing request is now locked. Generate a fresh code in Console → Agent → Connect Telegram.");
    }
    await writeSetting("telegram_pairing", { ...pairing, attempts });
    return reply(chatId, `That code isn't valid (${MAX_PAIR_ATTEMPTS - attempts} attempt(s) left).`);
  }

  const admins = await getAdmins();
  if (!admins.some((a) => a.chatId === chatId)) admins.push({ chatId, name, pairedAt: new Date().toISOString() });
  await writeSetting("telegram_admins", { list: admins });

  // Make this chat the default alert destination if none is set yet.
  const dest = (await readSetting<AlertDestinations>("alert_destinations")) ?? {};
  if (!dest.telegramChatId) await writeSetting("alert_destinations", { ...dest, telegramChatId: chatId });

  await writeSetting("telegram_pairing", null); // one-time use
  await reply(chatId, `✅ Connected, ${name}! You'll get alerts here and can chat with me — this is the same conversation as the console panel. Try /status.`);
}

async function handleCallback(cb: TgCallback): Promise<void> {
  const token = await getSecretValue("telegram_bot_token");
  const chatId = cb.message?.chat?.id != null ? String(cb.message.chat.id) : "";
  const fromId = cb.from?.id != null ? String(cb.from.id) : "";
  const name = displayName(cb.from);

  if (!(await isAdmin(fromId)) && !(await isAdmin(chatId))) {
    if (token) await tgAnswerCallback(token, cb.id, "Not authorized.");
    return;
  }
  const m = /^(approve|reject):(.+)$/.exec(cb.data ?? "");
  if (!m) {
    if (token) await tgAnswerCallback(token, cb.id, "Unknown action.");
    return;
  }
  const approve = m[1] === "approve";
  const res = await applyApprovalDecision({ id: m[2], approve, actorId: `telegram:${fromId}`, actorName: name, via: "telegram" });
  if (token) {
    await tgAnswerCallback(token, cb.id, res.message);
    if (chatId && cb.message?.message_id) {
      await tgEditMessageText(token, chatId, cb.message.message_id, `${approve ? "✅" : "🚫"} ${res.title ?? "Action"} — ${approve ? "approved" : "rejected"} by ${name}.`);
    }
  }
}

async function statusText(): Promise<string> {
  const [control, budget, pending] = await Promise.all([getControl(), budgetStatus(), pendingApprovalCount()]);
  const lines = [
    control.paused ? "⏸️ Tess is PAUSED (monitoring still running)." : "▶️ Tess is active.",
    `💰 Budget: $${budget.spentUsd.toFixed(2)} / $${budget.capUsd.toFixed(0)} this month (${budget.pct}%)${budget.degraded ? " — degrade mode" : ""}.`,
    `📥 ${pending} approval${pending === 1 ? "" : "s"} waiting.`,
  ];
  return lines.join("\n");
}
