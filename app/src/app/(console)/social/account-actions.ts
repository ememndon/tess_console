"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { socialAccounts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { encryptSecret, decryptSecret } from "@/lib/vault";
import { getSecretValue } from "@/lib/secrets";
import { SITE_KEYS } from "@/lib/site-scope";
import * as X from "@/lib/x";
import { tgGetChat } from "@/lib/telegram";

type Result = { ok: boolean; message: string };

async function admin() {
  const user = await getCurrentUser();
  return user && user.role === "admin" ? user : null;
}
function okSite(site: string) {
  return (SITE_KEYS as string[]).includes(site);
}
async function upsertAccount(site: string, platform: "x" | "telegram", set: Record<string, unknown>) {
  await db
    .insert(socialAccounts)
    .values({ site, platform, ...set })
    .onConflictDoUpdate({ target: [socialAccounts.site, socialAccounts.platform], set: { ...set, updatedAt: new Date() } });
}

// ── X (Twitter): OAuth 1.0a user-context credentials from the brand's dev app ──
export async function connectXAccount(site: string, creds: X.XCreds): Promise<Result> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can connect accounts." };
  if (!okSite(site)) return { ok: false, message: "Unknown brand." };
  const c = {
    apiKey: creds.apiKey?.trim(),
    apiSecret: creds.apiSecret?.trim(),
    accessToken: creds.accessToken?.trim(),
    accessSecret: creds.accessSecret?.trim(),
  };
  if (!c.apiKey || !c.apiSecret || !c.accessToken || !c.accessSecret)
    return { ok: false, message: "All four X keys are required." };

  let handle: string;
  try {
    handle = (await X.xVerify(c)).handle; // proves the keys work + captures @handle
  } catch (e) {
    return { ok: false, message: `Couldn't verify with X: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}` };
  }

  await upsertAccount(site, "x", {
    connected: true,
    handle: `@${handle}`,
    credentialsEnc: encryptSecret(JSON.stringify(c)),
    status: "ok",
  });
  await audit({ actorId: user.id, actorName: user.name, action: "social.account.connect", target: `${site}/x`, detail: { handle } });
  revalidatePath("/social");
  return { ok: true, message: `Connected X as @${handle}.` };
}

// ── Telegram: a per-brand channel id; the bot token is the global vault secret ──
export async function connectTelegramAccount(site: string, chatId: string): Promise<Result> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can connect accounts." };
  if (!okSite(site)) return { ok: false, message: "Unknown brand." };
  const id = chatId.trim();
  if (!id) return { ok: false, message: "Enter the channel @username or numeric chat id." };
  const token = await getSecretValue("telegram_bot_token");
  if (!token) return { ok: false, message: "Set the Telegram bot token in Settings → Secrets Vault first, then connect the channel." };

  let title: string;
  try {
    title = (await tgGetChat(token, id)).title;
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }

  await upsertAccount(site, "telegram", { connected: true, handle: id, meta: { chatId: id, title }, status: "ok" });
  await audit({ actorId: user.id, actorName: user.name, action: "social.account.connect", target: `${site}/telegram`, detail: { chatId: id } });
  revalidatePath("/social");
  return { ok: true, message: `Connected Telegram channel “${title}”.` };
}

// Re-validate a stored connection (button next to a connected account).
export async function testAccount(site: string, platform: "x" | "telegram"): Promise<Result> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can test accounts." };
  const [acct] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.site, site), eq(socialAccounts.platform, platform)));
  if (!acct?.connected) return { ok: false, message: "Not connected yet." };

  try {
    if (platform === "x") {
      if (!acct.credentialsEnc) throw new Error("no stored credentials");
      const creds = JSON.parse(decryptSecret(acct.credentialsEnc)) as X.XCreds;
      const { handle } = await X.xVerify(creds);
      await db.update(socialAccounts).set({ status: "ok", handle: `@${handle}`, updatedAt: new Date() }).where(and(eq(socialAccounts.site, site), eq(socialAccounts.platform, "x")));
      revalidatePath("/social");
      return { ok: true, message: `X OK — @${handle}.` };
    }
    const token = await getSecretValue("telegram_bot_token");
    if (!token) throw new Error("Telegram bot token not set in the vault");
    const chatId = (acct.meta as { chatId?: string } | null)?.chatId ?? acct.handle ?? "";
    const { title } = await tgGetChat(token, chatId);
    await db.update(socialAccounts).set({ status: "ok", updatedAt: new Date() }).where(and(eq(socialAccounts.site, site), eq(socialAccounts.platform, "telegram")));
    revalidatePath("/social");
    return { ok: true, message: `Telegram OK — “${title}”.` };
  } catch (e) {
    await db.update(socialAccounts).set({ status: "failed", updatedAt: new Date() }).where(and(eq(socialAccounts.site, site), eq(socialAccounts.platform, platform)));
    revalidatePath("/social");
    return { ok: false, message: `Test failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}` };
  }
}

export async function disconnectAccount(site: string, platform: "x" | "telegram"): Promise<Result> {
  const user = await admin();
  if (!user) return { ok: false, message: "Only an admin can disconnect accounts." };
  await db
    .update(socialAccounts)
    .set({ connected: false, credentialsEnc: null, meta: null, handle: null, status: "untested", updatedAt: new Date() })
    .where(and(eq(socialAccounts.site, site), eq(socialAccounts.platform, platform)));
  await audit({ actorId: user.id, actorName: user.name, action: "social.account.disconnect", target: `${site}/${platform}` });
  revalidatePath("/social");
  return { ok: true, message: "Disconnected." };
}
