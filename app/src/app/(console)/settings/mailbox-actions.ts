"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { mailboxes, settings } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createMailbox, updateMailbox, deleteMailbox, getMailbox, testMailbox, setMailboxAutoReply, type MailboxInput } from "@/lib/mail/mailboxes";
import { SITE_KEYS } from "@/lib/site-scope";
import type { EmailSettings } from "@/lib/inbox-types";

function isAdmin(role: string) {
  return role === "admin";
}

export async function saveMailbox(input: MailboxInput & { id?: string }): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!isAdmin(user.role)) return { ok: false, message: "Only an admin can manage mailboxes." };
  if (!(SITE_KEYS as string[]).includes(input.site)) return { ok: false, message: "Pick a site." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.address)) return { ok: false, message: "Enter a valid address." };

  try {
    if (input.id) {
      await updateMailbox(input.id, input);
      await audit({ actorId: user.id, actorName: user.name, action: "settings.mailbox.update", target: input.id, detail: { address: input.address } });
    } else {
      const row = await createMailbox(input, user.name);
      await audit({ actorId: user.id, actorName: user.name, action: "settings.mailbox.create", target: row.id, detail: { address: input.address } });
    }
    revalidatePath("/settings");
    revalidatePath("/inbox");
    return { ok: true, message: input.id ? "Mailbox updated." : "Mailbox added — test the connection next." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save mailbox." };
  }
}

export async function setMailboxAutoReplyAction(id: string, enabled: boolean): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!isAdmin(user.role)) return { ok: false, message: "Only an admin can manage mailboxes." };
  try {
    const cleared = await setMailboxAutoReply(id, enabled);
    await audit({ actorId: user.id, actorName: user.name, action: "settings.mailbox.autoreply", target: id, detail: { enabled, cleared } });
    revalidatePath("/settings");
    revalidatePath("/inbox");
    return {
      ok: true,
      message: enabled
        ? "Auto-reply on — Tess will draft replies for this mailbox."
        : `Auto-reply off — Tess won't draft for this mailbox${cleared ? `; cleared ${cleared} pending draft(s)` : ""}.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not update auto-reply." };
  }
}

export async function testMailboxAction(id: string): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const box = await getMailbox(id);
  if (!box) return { ok: false, message: "Mailbox not found." };
  const r = await testMailbox(box);
  await audit({ actorId: user.id, actorName: user.name, action: "settings.mailbox.test", target: id, detail: { ok: r.ok } });
  revalidatePath("/settings");
  return r;
}

export async function deleteMailboxAction(id: string): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return { ok: false };
  await deleteMailbox(id);
  await audit({ actorId: user.id, actorName: user.name, action: "settings.mailbox.delete", target: id });
  revalidatePath("/settings");
  revalidatePath("/inbox");
  return { ok: true };
}

export async function saveEmailSettings(input: EmailSettings): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) return { ok: false, message: "Only an admin can change these." };
  const retention = { supportDays: Math.max(7, input.supportDays), outreachDays: Math.max(7, input.outreachDays), autoPurge: input.autoPurge };
  const caps = { dailyCap: Math.max(1, input.dailyCap), perContactCooldownDays: Math.max(0, input.perContactCooldownDays) };
  const providers = { supportDraft: input.supportDraft, allowDeepSeekSupport: input.allowDeepSeekSupport };

  for (const [key, value] of [
    ["email_retention", retention],
    ["outreach_caps", caps],
    ["email_providers", providers],
  ] as const) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }
  await audit({ actorId: user.id, actorName: user.name, action: "settings.email.update" });
  revalidatePath("/settings");
  return { ok: true, message: "Email settings saved." };
}
