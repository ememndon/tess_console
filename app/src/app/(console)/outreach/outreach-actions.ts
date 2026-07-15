"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { outreachContacts, outreachMessages, subscribers, mailboxes, emailMessages, settings } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getContact } from "@/lib/outreach";
import { runDnsChecks } from "@/lib/dns-check";
import { mailboxPassword } from "@/lib/mail/mailboxes";
import { sendMail } from "@/lib/mail/smtp";
import { withImap, appendMessage } from "@/lib/mail/imap";
import { folderPathForRole } from "@/lib/inbox";
import { generateOutreachDraft } from "@/lib/email-gen";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";

const isSite = (s: string) => (SITE_KEYS as string[]).includes(s);
const emailish = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// ── Contacts ────────────────────────────────────────────────────────────────

export async function addContact(input: {
  site: string;
  name?: string;
  email: string;
  org?: string;
  role?: string;
  category: string;
  source?: string;
  notes?: string;
}): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!isSite(input.site)) return { ok: false, message: "Pick a site." };
  const email = input.email.trim().toLowerCase();
  if (!emailish(email)) return { ok: false, message: "Enter a valid email." };
  // Compliance: contacts are deliberately added, with provenance.
  try {
    await db.insert(outreachContacts).values({
      site: input.site,
      name: input.name?.trim() || null,
      email,
      org: input.org?.trim() || null,
      role: input.role?.trim() || null,
      category: input.category,
      source: input.source?.trim() || null,
      notes: input.notes?.trim() || null,
      createdBy: user.name,
    });
  } catch {
    return { ok: false, message: "That contact already exists for this site." };
  }
  await audit({ actorId: user.id, actorName: user.name, action: "outreach.add_contact", detail: { site: input.site, email } });
  revalidatePath("/outreach");
  return { ok: true, message: "Contact added." };
}

export async function updateStage(contactId: string, stage: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.update(outreachContacts).set({ stage: stage as typeof outreachContacts.$inferInsert.stage }).where(eq(outreachContacts.id, contactId));
  revalidatePath("/outreach");
  return { ok: true };
}

export async function setOptOut(contactId: string, optedOut: boolean): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db
    .update(outreachContacts)
    .set({ optedOut, stage: optedOut ? "opted_out" : "prospect" })
    .where(eq(outreachContacts.id, contactId));
  await audit({ actorId: user.id, actorName: user.name, action: "outreach.optout", target: contactId, detail: { optedOut } });
  revalidatePath("/outreach");
  return { ok: true };
}

export async function deleteContact(contactId: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.delete(outreachContacts).where(eq(outreachContacts.id, contactId));
  revalidatePath("/outreach");
  return { ok: true };
}

export async function loadContact(contactId: string) {
  const user = await requireOperator();
  if (!user) return null;
  return getContact(contactId);
}

// Tess drafts a personalized outreach email → saved as a DRAFT (approval-gated).
export async function draftOutreach(contactId: string, angle?: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [c] = await db.select().from(outreachContacts).where(eq(outreachContacts.id, contactId)).limit(1);
  if (!c) return { ok: false, message: "Contact not found." };
  if (c.optedOut) return { ok: false, message: "This contact opted out — drafting disabled." };
  const meta = SITE_META[c.site as SiteKey];
  try {
    const gen = await generateOutreachDraft({
      brandName: meta?.name ?? c.site,
      brandDomain: meta?.domain ?? c.site,
      contactName: c.name,
      org: c.org,
      category: c.category,
      angle,
    });
    await db.insert(outreachMessages).values({
      contactId,
      subject: gen.subject,
      bodyText: gen.bodyText,
      status: "draft",
      generatedBy: "tess",
      createdBy: user.name,
    });
    await audit({ actorId: user.id, actorName: user.name, action: "outreach.draft", target: contactId });
    revalidatePath("/outreach");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Drafting failed." };
  }
}

export async function saveOutreachMessage(input: {
  messageId?: string;
  contactId: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; message?: string; messageId?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!input.subject.trim() || !input.body.trim()) return { ok: false, message: "Subject and body required." };
  if (input.messageId) {
    await db.update(outreachMessages).set({ subject: input.subject.trim(), bodyText: input.body, generatedBy: "human", status: "draft" }).where(eq(outreachMessages.id, input.messageId));
    revalidatePath("/outreach");
    return { ok: true, messageId: input.messageId };
  }
  const [m] = await db
    .insert(outreachMessages)
    .values({ contactId: input.contactId, subject: input.subject.trim(), bodyText: input.body, status: "draft", generatedBy: "human", createdBy: user.name })
    .returning({ id: outreachMessages.id });
  revalidatePath("/outreach");
  return { ok: true, messageId: m.id };
}

export async function discardOutreachMessage(messageId: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.update(outreachMessages).set({ status: "skipped" }).where(eq(outreachMessages.id, messageId));
  revalidatePath("/outreach");
  return { ok: true };
}

// THE APPROVAL GATE for outreach: low daily cap, opt-out honored,
// per-contact cooldown. Sends from the site's outreach/support mailbox.
export async function approveAndSendOutreach(messageId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [msg] = await db.select().from(outreachMessages).where(eq(outreachMessages.id, messageId)).limit(1);
  if (!msg) return { ok: false, message: "Draft not found." };
  if (msg.status === "sent") return { ok: false, message: "Already sent." };
  const [c] = await db.select().from(outreachContacts).where(eq(outreachContacts.id, msg.contactId)).limit(1);
  if (!c) return { ok: false, message: "Contact not found." };
  if (c.optedOut) return { ok: false, message: "Contact opted out — cannot send." };

  // Daily cap.
  const [capRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "outreach_caps"));
  const caps = (capRow?.value as { dailyCap?: number; perContactCooldownDays?: number }) ?? {};
  const dailyCap = caps.dailyCap ?? 10;
  const [sentToday] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(outreachMessages)
    .where(and(eq(outreachMessages.status, "sent"), sql`${outreachMessages.sentAt} >= now() - interval '1 day'`));
  if ((sentToday?.n ?? 0) >= dailyCap) return { ok: false, message: `Daily outreach cap reached (${dailyCap}). Try again tomorrow.` };

  // Per-contact cooldown.
  const cooldown = caps.perContactCooldownDays ?? 7;
  const [recent] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(outreachMessages)
    .where(and(eq(outreachMessages.contactId, c.id), eq(outreachMessages.status, "sent"), sql`${outreachMessages.sentAt} >= now() - (${cooldown} * interval '1 day')`));
  if ((recent?.n ?? 0) > 0) return { ok: false, message: `Already contacted within the ${cooldown}-day cooldown.` };

  // Pick a mailbox for this site (prefer an outreach mailbox).
  const boxes = await db.select().from(mailboxes).where(and(eq(mailboxes.site, c.site), eq(mailboxes.enabled, true)));
  const box = boxes.find((b) => b.purpose === "outreach") ?? boxes[0];
  if (!box) return { ok: false, message: `No mailbox connected for ${c.site}. Connect one in Settings.` };

  try {
    const pass = mailboxPassword(box);
    const sent = await sendMail(box, pass, { to: [c.email], subject: msg.subject, text: msg.bodyText });
    await db.update(outreachMessages).set({ status: "sent", approvedBy: user.name, sentAt: new Date(), smtpMessageId: sent.messageId, mailboxId: box.id }).where(eq(outreachMessages.id, messageId));
    await db.update(outreachContacts).set({ lastContactedAt: new Date(), stage: c.stage === "prospect" ? "contacted" : c.stage }).where(eq(outreachContacts.id, c.id));
    // File in Sent (IMAP) + keep an in-console Sent copy.
    const sentPath = (await folderPathForRole(box.id, "sent")) ?? "Sent";
    if (sent.raw) await withImap(box, pass, (cl) => appendMessage(cl, sentPath, sent.raw));
    await db
      .insert(emailMessages)
      .values({
        mailboxId: box.id,
        uid: Math.floor(Date.now() / 1000),
        folder: sentPath,
        direction: "outbound",
        messageId: sent.messageId,
        threadKey: `outreach:${c.id}`,
        fromAddr: box.address,
        fromName: box.displayName,
        toAddrs: [c.email],
        subject: msg.subject,
        snippet: msg.bodyText.replace(/\s+/g, " ").slice(0, 200),
        bodyText: msg.bodyText,
        internalDate: new Date(),
        seen: true,
      })
      .onConflictDoNothing({ target: [emailMessages.mailboxId, emailMessages.folder, emailMessages.uid] });
    await audit({ actorId: user.id, actorName: user.name, action: "outreach.send", target: c.id, detail: { to: c.email, from: box.address } });
    revalidatePath("/outreach");
    return { ok: true, message: `Sent to ${c.email} from ${box.address}.` };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await db.update(outreachMessages).set({ status: "failed", error: m.slice(0, 200) }).where(eq(outreachMessages.id, messageId));
    revalidatePath("/outreach");
    return { ok: false, message: `Send failed: ${m.slice(0, 160)}` };
  }
}

// ── Subscribers (CheckInvest rate-alert list mainly) ─────────────

export async function addSubscriber(input: { site: string; email: string; name?: string; source?: string }): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!isSite(input.site)) return { ok: false, message: "Pick a site." };
  const email = input.email.trim().toLowerCase();
  if (!emailish(email)) return { ok: false, message: "Enter a valid email." };
  try {
    await db.insert(subscribers).values({ site: input.site, email, name: input.name?.trim() || null, source: input.source?.trim() || "manual", confirmedAt: new Date() });
  } catch {
    return { ok: false, message: "Already subscribed." };
  }
  revalidatePath("/outreach");
  return { ok: true, message: "Subscriber added." };
}

export async function importSubscribers(site: string, blob: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!isSite(site)) return { ok: false, message: "Pick a site." };
  const emails = [...new Set(blob.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(emailish))].slice(0, 5000);
  if (emails.length === 0) return { ok: false, message: "No valid emails found." };
  let added = 0;
  for (const email of emails) {
    const r = await db.insert(subscribers).values({ site, email, source: "import", confirmedAt: new Date() }).onConflictDoNothing({ target: [subscribers.site, subscribers.email] }).returning({ id: subscribers.id });
    if (r.length) added++;
  }
  await audit({ actorId: user.id, actorName: user.name, action: "outreach.import_subscribers", detail: { site, added } });
  revalidatePath("/outreach");
  return { ok: true, message: `Imported ${added} new subscriber(s) (${emails.length - added} already present).` };
}

export async function setSubscriberStatus(id: string, status: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db
    .update(subscribers)
    .set({ status: status as typeof subscribers.$inferInsert.status, unsubscribedAt: status === "unsubscribed" ? new Date() : null })
    .where(eq(subscribers.id, id));
  revalidatePath("/outreach");
  return { ok: true };
}

export async function deleteSubscriber(id: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.delete(subscribers).where(eq(subscribers.id, id));
  revalidatePath("/outreach");
  return { ok: true };
}

// ── Deliverability ────────────────────────────────────────────────────────────

export async function runDnsCheckNow(): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const r = await runDnsChecks();
  revalidatePath("/outreach");
  return { ok: r.ok, message: r.ok ? `Checked ${r.checked} records.` : "Check failed." };
}
