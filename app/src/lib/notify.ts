import "server-only";
import { eq, and, isNull, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, settings, mailboxes, users } from "@/lib/db/schema";
import { getNotificationRouting, getNotificationPrefs } from "@/lib/notifications";
import { shouldRecordInApp } from "@/lib/notification-prefs";
import { getSecretValue } from "@/lib/secrets";
import { tgSendMessage, tgSendButtons } from "@/lib/telegram";
import { mailboxPassword } from "@/lib/mail/mailboxes";
import { sendMail } from "@/lib/mail/smtp";

// THE single notification chokepoint. Every alert lands in the
// console bell, then fans out to Telegram + email per settings.notification_routing
// (per-severity channels + quiet hours). notify() delivers inline and stamps
// delivered_at; deterministic shell-script alerts insert straight into the bell
// (delivered_at NULL) and the notify-dispatch cron fans them out within a minute.
// Delivery is best-effort and never throws back to the caller.

export type Severity = "info" | "warning" | "critical";
const ICON: Record<Severity, string> = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

type AlertDestinations = { telegramChatId?: string; email?: string; fromMailboxId?: string };

export function inQuietHours(q: { enabled: boolean; start: string; end: string }): boolean {
  if (!q?.enabled) return false;
  const now = new Date();
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end; // wraps midnight
}

// Fan out a single alert to Telegram + email per routing. `telegramButtons`, when
// set, turns the Telegram message into a one-tap approve/reject card.
export async function deliverNotification(opts: { severity: Severity; title: string; body?: string | null; telegramButtons?: { approveId: string } }): Promise<void> {
  try {
    const routing = await getNotificationRouting();
    const chan = routing[opts.severity];
    const quiet = opts.severity !== "critical" && inQuietHours(routing.quietHours); // criticals bypass quiet hours
    if (quiet || (!chan.telegram && !chan.email)) return;

    const [destRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "alert_destinations"));
    const dest = (destRow?.value as AlertDestinations) ?? {};
    const text = `${ICON[opts.severity]} ${opts.title}${opts.body ? `\n${opts.body}` : ""}`;

    if (chan.telegram && dest.telegramChatId) {
      const token = await getSecretValue("telegram_bot_token");
      if (token) {
        if (opts.telegramButtons) {
          await tgSendButtons(token, dest.telegramChatId, text, [
            { text: "✅ Approve", callback_data: `approve:${opts.telegramButtons.approveId}` },
            { text: "🚫 Reject", callback_data: `reject:${opts.telegramButtons.approveId}` },
          ]).catch(() => {});
        } else {
          await tgSendMessage(token, dest.telegramChatId, text).catch(() => {});
        }
      }
    }

    if (chan.email) {
      const to = dest.email || (await firstAdminEmail());
      const box = await pickFromMailbox(dest.fromMailboxId);
      if (to && box) {
        const pass = mailboxPassword(box);
        await sendMail(box, pass, { to: [to], subject: `[${opts.severity.toUpperCase()}] ${opts.title}`, text: `${opts.title}\n\n${opts.body ?? ""}` }).catch(() => {});
      }
    }
  } catch {
    /* delivery is best-effort */
  }
}

export async function notify(opts: { severity: Severity; title: string; body?: string; module?: string; telegramButtons?: { approveId: string } }): Promise<void> {
  const module = opts.module ?? "system";
  // 1) Console bell — but only if this source/severity is enabled for the in-app
  // list (Settings → Notifications), so the list isn't a feed of every activity.
  // Approval cards always list (the admin must act on them). Stamp delivered now
  // so the dispatcher won't re-send.
  try {
    const prefs = await getNotificationPrefs();
    if (opts.telegramButtons || shouldRecordInApp(opts.severity, module, prefs)) {
      await db
        .insert(notifications)
        .values({ severity: opts.severity, title: opts.title, body: opts.body ?? null, module, deliveredAt: new Date() });
    }
  } catch {
    /* bell insert must not break the caller */
  }
  // 2) Fan out inline (external delivery follows notification_routing, independent
  // of the in-app list prefs above).
  await deliverNotification(opts);
}

// Used by the notify-dispatch cron: deliver any recent bell rows that haven't
// been fanned out yet (i.e. inserted directly by deterministic shell scripts).
export async function dispatchUndelivered(maxAgeMinutes = 120): Promise<{ delivered: number }> {
  const since = new Date(Date.now() - maxAgeMinutes * 60_000);
  const rows = await db
    .select()
    .from(notifications)
    .where(and(isNull(notifications.deliveredAt), gte(notifications.createdAt, since), lte(notifications.createdAt, new Date())));
  let delivered = 0;
  for (const r of rows) {
    await deliverNotification({ severity: r.severity as Severity, title: r.title, body: r.body });
    await db.update(notifications).set({ deliveredAt: new Date() }).where(eq(notifications.id, r.id));
    delivered++;
  }
  return { delivered };
}

async function firstAdminEmail(): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.role, "admin")).limit(1);
  return u?.email ?? null;
}

async function pickFromMailbox(id?: string) {
  if (id) {
    const [b] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
    if (b) return b;
  }
  const [b] = await db.select().from(mailboxes).where(eq(mailboxes.enabled, true)).limit(1);
  return b ?? null;
}
