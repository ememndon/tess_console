import "server-only";
import { promises as fs } from "fs";

// Telegram Bot API client (channels + command channel). A single bot
// posts to each brand's channel (added as admin) and DMs admins. Channel target
// is a chat id or public @username.

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function tgGetMe(token: string): Promise<{ username: string }> {
  const r = await fetch(api(token, "getMe"));
  const j = (await r.json()) as { ok?: boolean; result?: { username?: string } };
  if (!j.ok) throw new Error("invalid bot token");
  return { username: j.result?.username ?? "?" };
}

// Validate that the bot can see a target chat/channel (must be added as admin).
// Used by the connect flow to confirm a brand's channel id before saving it.
export async function tgGetChat(token: string, chatId: string): Promise<{ title: string; type: string }> {
  const r = await fetch(api(token, "getChat") + `?chat_id=${encodeURIComponent(chatId)}`);
  const j = (await r.json()) as { ok?: boolean; description?: string; result?: { title?: string; username?: string; type?: string } };
  if (!j.ok) throw new Error(j.description ?? "chat not found — add the bot to the channel as an admin");
  return { title: j.result?.title ?? j.result?.username ?? chatId, type: j.result?.type ?? "channel" };
}

export async function tgSendMessage(token: string, chatId: string, text: string): Promise<{ id: number }> {
  const r = await fetch(api(token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const j = (await r.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
  if (!j.ok) throw new Error(`telegram: ${j.description ?? "send failed"}`);
  return { id: j.result?.message_id ?? 0 };
}

export type TgButton = { text: string; callback_data: string };

// Send a message with an inline keyboard (one row of buttons) — used for one-tap
// approve/reject of queued actions in the Telegram command channel.
export async function tgSendButtons(token: string, chatId: string, text: string, buttons: TgButton[]): Promise<{ id: number }> {
  const r = await fetch(api(token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: { inline_keyboard: [buttons] } }),
  });
  const j = (await r.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
  if (!j.ok) throw new Error(`telegram: ${j.description ?? "send failed"}`);
  return { id: j.result?.message_id ?? 0 };
}

// Acknowledge a button tap (stops the client's loading spinner) and optionally
// replace the original message's buttons with a settled label.
export async function tgAnswerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  await fetch(api(token, "answerCallbackQuery"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: text ?? "" }),
  }).catch(() => {});
}

export async function tgEditMessageText(token: string, chatId: string, messageId: number, text: string): Promise<void> {
  await fetch(api(token, "editMessageText"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: [] } }),
  }).catch(() => {});
}

export async function tgSetWebhook(token: string, url: string, secret: string): Promise<void> {
  const r = await fetch(api(token, "setWebhook"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true }),
  });
  const j = (await r.json()) as { ok?: boolean; description?: string };
  if (!j.ok) throw new Error(`telegram setWebhook: ${j.description ?? "failed"}`);
}

export async function tgDeleteWebhook(token: string): Promise<void> {
  await fetch(api(token, "deleteWebhook"), { method: "POST" }).catch(() => {});
}

export async function tgGetWebhookInfo(token: string): Promise<{ url: string; pendingUpdates: number; lastError?: string }> {
  const r = await fetch(api(token, "getWebhookInfo"));
  const j = (await r.json()) as { ok?: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string } };
  return { url: j.result?.url ?? "", pendingUpdates: j.result?.pending_update_count ?? 0, lastError: j.result?.last_error_message };
}

export async function tgSendPhoto(
  token: string,
  chatId: string,
  filePath: string,
  caption: string,
): Promise<{ id: number }> {
  const data = await fs.readFile(filePath);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([new Uint8Array(data)], { type: "image/png" }), "banner.png");
  const r = await fetch(api(token, "sendPhoto"), { method: "POST", body: form });
  const j = (await r.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
  if (!j.ok) throw new Error(`telegram: ${j.description ?? "send failed"}`);
  return { id: j.result?.message_id ?? 0 };
}
