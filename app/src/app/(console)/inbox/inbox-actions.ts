"use server";

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailboxes, mailboxFolders, emailMessages, emailDrafts } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getMessages, getMessage, getFolders, folderPathForRole, type MessageFilter } from "@/lib/inbox";
import { mailboxPassword } from "@/lib/mail/mailboxes";
import { syncMailbox } from "@/lib/mail/sync";
import { withImap, setFlag, moveMessage, appendMessage, deleteMessage } from "@/lib/mail/imap";
import { generateSupportReply } from "@/lib/email-gen";
import { sendMail } from "@/lib/mail/smtp";
import { SITE_META, type SiteKey } from "@/lib/site-scope";

type MsgRow = typeof emailMessages.$inferSelect;
type BoxRow = typeof mailboxes.$inferSelect;

async function loadBox(mailboxId: string): Promise<BoxRow | undefined> {
  const [b] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
  return b;
}
async function loadMsg(messageId: string): Promise<MsgRow | undefined> {
  const [m] = await db.select().from(emailMessages).where(eq(emailMessages.id, messageId)).limit(1);
  return m;
}

// ── reads ─────────────────────────────────────────────────────────────────────

export async function listFolders(mailboxId: string) {
  const user = await requireOperator();
  if (!user) return [];
  return getFolders(mailboxId);
}

export async function listMessages(mailboxId: string, folder: string, filter: MessageFilter, q?: string, limit?: number, offset?: number) {
  const user = await requireOperator();
  if (!user) return [];
  return getMessages(mailboxId, folder, filter, q, limit, offset);
}

export async function openMessage(messageId: string) {
  const user = await requireOperator();
  if (!user) return null;
  const m = await loadMsg(messageId);
  if (m && !m.seen) {
    await db.update(emailMessages).set({ seen: true }).where(eq(emailMessages.id, messageId));
    const box = await loadBox(m.mailboxId);
    if (box) {
      try {
        await withImap(box, mailboxPassword(box), (c) => setFlag(c, m.folder, m.uid, "\\Seen", true));
      } catch {
        /* flag sync best-effort */
      }
    }
  }
  return getMessage(messageId);
}

// ── flags / moves ──────────────────────────────────────────────────────────────

export async function setSeen(messageId: string, seen: boolean): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  const m = await loadMsg(messageId);
  if (!m) return { ok: false };
  await db.update(emailMessages).set({ seen }).where(eq(emailMessages.id, messageId));
  const box = await loadBox(m.mailboxId);
  if (box) {
    try {
      await withImap(box, mailboxPassword(box), (c) => setFlag(c, m.folder, m.uid, "\\Seen", seen));
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/inbox");
  return { ok: true };
}

export async function setFlagged(messageId: string, flagged: boolean): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  const m = await loadMsg(messageId);
  if (!m) return { ok: false };
  await db.update(emailMessages).set({ flagged }).where(eq(emailMessages.id, messageId));
  const box = await loadBox(m.mailboxId);
  if (box) {
    try {
      await withImap(box, mailboxPassword(box), (c) => setFlag(c, m.folder, m.uid, "\\Flagged", flagged));
    } catch {
      /* best-effort */
    }
  }
  revalidatePath("/inbox");
  return { ok: true };
}

// Move a message to a folder role (trash/junk/archive/inbox). Permanently deletes
// if it's already in Trash. Mirrors the move on the server and in the cache.
export async function moveToRole(messageId: string, role: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const m = await loadMsg(messageId);
  if (!m) return { ok: false, message: "Message not found." };
  const box = await loadBox(m.mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };

  const toPath = await folderPathForRole(m.mailboxId, role);
  if (!toPath) return { ok: false, message: `No ${role} folder on this mailbox.` };
  if (toPath === m.folder) return { ok: true, message: "Already there." };

  try {
    const pass = mailboxPassword(box);
    const newUid = await withImap(box, pass, (c) => moveMessage(c, m.folder, m.uid, toPath));
    if (typeof newUid === "number") {
      // Keep `actionable` consistent with where the message now lives — only the
      // Inbox drives Tess's drafting / the needs-reply count. Marking as spam or
      // trashing clears it (so autopilot never drafts spam), and moving a message
      // back to the Inbox restores it — exactly how the admin rescues something the
      // spam filter got wrong.
      await db.update(emailMessages).set({ folder: toPath, uid: newUid, actionable: role === "inbox" }).where(eq(emailMessages.id, messageId));
      await db
        .update(mailboxFolders)
        .set({ lastUid: sql`GREATEST(${mailboxFolders.lastUid}, ${newUid})` })
        .where(and(eq(mailboxFolders.mailboxId, m.mailboxId), eq(mailboxFolders.path, toPath)));
    } else {
      // Server didn't report the new UID — drop the cache row; the next sync of
      // the destination folder repopulates it.
      await db.delete(emailMessages).where(eq(emailMessages.id, messageId));
    }
    await audit({ actorId: user.id, actorName: user.name, action: "inbox.move", target: messageId, detail: { role } });
    revalidatePath("/inbox");
    return { ok: true, message: role === "trash" ? "Moved to Trash." : role === "junk" ? "Marked as spam." : `Moved to ${role}.` };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}

// Delete: move to Trash, or purge permanently if already in Trash.
export async function deleteMessageAction(messageId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const m = await loadMsg(messageId);
  if (!m) return { ok: false, message: "Message not found." };
  const box = await loadBox(m.mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };
  const trashPath = await folderPathForRole(m.mailboxId, "trash");

  // Already in trash (or no trash folder) → permanent delete.
  if (!trashPath || m.folder === trashPath) {
    try {
      await withImap(box, mailboxPassword(box), (c) => deleteMessage(c, m.folder, m.uid));
    } catch {
      /* fall through to cache cleanup */
    }
    await db.delete(emailMessages).where(eq(emailMessages.id, messageId));
    await audit({ actorId: user.id, actorName: user.name, action: "inbox.delete", target: messageId });
    revalidatePath("/inbox");
    return { ok: true, message: "Deleted." };
  }
  return moveToRole(messageId, "trash");
}

export async function markSpam(messageId: string) {
  return moveToRole(messageId, "junk");
}
export async function archiveMessage(messageId: string) {
  return moveToRole(messageId, "archive");
}

// ── drafting + reply (approval-gated) ───────────────────────────────────────────

export async function draftReply(messageId: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const msg = await loadMsg(messageId);
  if (!msg) return { ok: false, message: "Message not found." };
  const box = await loadBox(msg.mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };
  try {
    const gen = await generateSupportReply({
      brandName: SITE_META[box.site as SiteKey]?.name ?? box.displayName,
      fromName: msg.fromName,
      subject: msg.subject,
      body: msg.bodyText || msg.snippet || "(no body)",
      signature: box.signature,
    });
    await db.insert(emailDrafts).values({
      mailboxId: box.id,
      inReplyTo: msg.id,
      threadKey: msg.threadKey,
      toAddrs: msg.fromAddr ? [msg.fromAddr] : [],
      subject: gen.subject,
      bodyText: gen.bodyText,
      status: "pending",
      generatedBy: "tess",
      provider: gen.provider,
    });
    await audit({ actorId: user.id, actorName: user.name, action: "inbox.draft", target: msg.id, detail: { provider: gen.provider } });
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Drafting failed." };
  }
}

export async function saveDraft(input: { draftId?: string; messageId: string; subject: string; body: string }): Promise<{ ok: boolean; message?: string; draftId?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  if (!input.subject.trim() || !input.body.trim()) return { ok: false, message: "Subject and body are required." };
  if (input.draftId) {
    await db.update(emailDrafts).set({ subject: input.subject.trim(), bodyText: input.body, generatedBy: "human", status: "pending" }).where(eq(emailDrafts.id, input.draftId));
    revalidatePath("/inbox");
    return { ok: true, draftId: input.draftId };
  }
  const msg = await loadMsg(input.messageId);
  if (!msg) return { ok: false, message: "Message not found." };
  const [created] = await db
    .insert(emailDrafts)
    .values({ mailboxId: msg.mailboxId, inReplyTo: msg.id, threadKey: msg.threadKey, toAddrs: msg.fromAddr ? [msg.fromAddr] : [], subject: input.subject.trim(), bodyText: input.body, status: "pending", generatedBy: "human" })
    .returning({ id: emailDrafts.id });
  revalidatePath("/inbox");
  return { ok: true, draftId: created.id };
}

export async function discardDraft(draftId: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.update(emailDrafts).set({ status: "discarded" }).where(eq(emailDrafts.id, draftId));
  await audit({ actorId: user.id, actorName: user.name, action: "inbox.discard_draft", target: draftId });
  revalidatePath("/inbox");
  return { ok: true };
}

// File a sent message into the mailbox's Sent folder (IMAP) + cache a copy.
async function recordSent(box: BoxRow, pass: string, opts: { to: string[]; cc?: string[]; subject: string; body: string; html?: string | null; messageId: string; raw: string; threadKey: string }) {
  const sentPath = (await folderPathForRole(box.id, "sent")) ?? "Sent";
  if (opts.raw) await withImap(box, pass, (c) => appendMessage(c, sentPath, opts.raw));
  await db
    .insert(emailMessages)
    .values({
      mailboxId: box.id,
      uid: Math.floor(Date.now() / 1000),
      folder: sentPath,
      direction: "outbound",
      messageId: opts.messageId,
      threadKey: opts.threadKey,
      fromAddr: box.address,
      fromName: box.displayName,
      toAddrs: opts.to,
      ccAddrs: opts.cc ?? [],
      subject: opts.subject,
      snippet: opts.body.replace(/\s+/g, " ").slice(0, 200),
      bodyText: opts.body,
      bodyHtml: opts.html ?? null,
      internalDate: new Date(),
      seen: true,
    })
    .onConflictDoNothing({ target: [emailMessages.mailboxId, emailMessages.folder, emailMessages.uid] });
}

// THE APPROVAL GATE: a human clicking this is the only way a reply leaves.
export async function approveAndSend(draftId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId)).limit(1);
  if (!draft) return { ok: false, message: "Draft not found." };
  if (draft.status !== "pending") return { ok: false, message: `Draft already ${draft.status}.` };
  const to = (draft.toAddrs as string[]) ?? [];
  if (to.length === 0) return { ok: false, message: "No recipient on this draft." };
  const box = await loadBox(draft.mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };

  let inReplyTo: string | null = null;
  const references: string[] = [];
  let orig: MsgRow | undefined;
  if (draft.inReplyTo) {
    orig = await loadMsg(draft.inReplyTo);
    if (orig?.messageId) {
      inReplyTo = orig.messageId;
      references.push(orig.messageId);
    }
  }

  try {
    const pass = mailboxPassword(box);
    const sent = await sendMail(box, pass, { to, subject: draft.subject, text: draft.bodyText, inReplyTo, references });
    await db.update(emailDrafts).set({ status: "sent", approvedBy: user.name, sentAt: new Date(), smtpMessageId: sent.messageId }).where(eq(emailDrafts.id, draftId));
    await recordSent(box, pass, { to, subject: draft.subject, body: draft.bodyText, messageId: sent.messageId, raw: sent.raw, threadKey: draft.threadKey ?? "" });

    if (orig) {
      await db.update(emailMessages).set({ answered: true }).where(eq(emailMessages.id, orig.id));
      try {
        await withImap(box, pass, (c) => setFlag(c, orig!.folder, orig!.uid, "\\Answered", true));
      } catch {
        /* best-effort */
      }
    }
    await audit({ actorId: user.id, actorName: user.name, action: "inbox.send", target: draftId, detail: { to, from: box.address } });
    revalidatePath("/inbox");
    return { ok: true, message: `Sent from ${box.address}.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(emailDrafts).set({ status: "failed", error: msg.slice(0, 200) }).where(eq(emailDrafts.id, draftId));
    revalidatePath("/inbox");
    return { ok: false, message: `Send failed: ${msg.slice(0, 160)}` };
  }
}

// Client → server attachment shape (base64, no data: prefix).
export type ComposeAttachmentInput = { name: string; type?: string; size: number; data: string };
// Persisted shape: bytes live on disk (`path`, relative to MEDIA_ROOT) so big
// attachments don't bloat Postgres. `data` is kept optional for back-compat and
// as a fallback when the disk write fails.
type StoredAttachment = { filename: string; contentType: string; size: number; path?: string; data?: string };
const MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20 MB total across attachments

// ── Compose-draft attachment storage (on the shared MEDIA_ROOT volume) ──────────
const MEDIA_ROOT = process.env.MEDIA_ROOT || "/app/media";
const isDraftId = (id: string) => /^[0-9a-f-]{16,40}$/i.test(id);
const draftAttachDir = (draftId: string) => path.join(MEDIA_ROOT, "mail-drafts", draftId);
const safeName = (name: string) => path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";

// Write a draft's attachment bytes to disk and return metadata-only rows (with a
// relative `path`). Rewrites the whole set each save (the client re-sends all
// current attachments). Falls back to inline `data` if the disk isn't writable —
// the draft must always save.
async function persistDraftAttachments(draftId: string, atts: StoredAttachment[]): Promise<StoredAttachment[]> {
  if (!isDraftId(draftId)) return atts; // never touch the filesystem with an untrusted id
  const dir = draftAttachDir(draftId);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    if (atts.length === 0) return [];
    await fs.mkdir(dir, { recursive: true });
    const out: StoredAttachment[] = [];
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i];
      const rel = path.join("mail-drafts", draftId, `${i}__${safeName(a.filename)}`);
      await fs.writeFile(path.join(MEDIA_ROOT, rel), Buffer.from(a.data ?? "", "base64"));
      out.push({ filename: a.filename, contentType: a.contentType, size: a.size, path: rel });
    }
    return out;
  } catch {
    return atts; // disk unavailable → keep bytes inline so the save still succeeds
  }
}

// Rehydrate base64 bytes for editing/sending: from disk if stored as `path`,
// else from the inline `data` fallback.
async function readDraftAttachments(atts: StoredAttachment[]): Promise<StoredAttachment[]> {
  return Promise.all(
    atts.map(async (a) => {
      if (a.data) return a;
      if (!a.path) return a;
      try {
        const buf = await fs.readFile(path.join(MEDIA_ROOT, a.path));
        return { ...a, data: buf.toString("base64") };
      } catch {
        return a;
      }
    }),
  );
}

async function removeDraftAttachments(draftId: string): Promise<void> {
  if (!isDraftId(draftId)) return;
  try { await fs.rm(draftAttachDir(draftId), { recursive: true, force: true }); } catch { /* best-effort */ }
}

function parseAddrs(s: string): string[] {
  return s.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toStored(atts?: ComposeAttachmentInput[]): StoredAttachment[] {
  return (atts ?? []).map((a) => ({ filename: a.name, contentType: a.type || "application/octet-stream", size: a.size, data: a.data }));
}
function toSendAttachments(atts: StoredAttachment[]) {
  return atts.map((a) => ({ filename: a.filename, content: Buffer.from(a.data ?? "", "base64"), contentType: a.contentType }));
}

// Compose + send a brand-new message. The human composing and clicking Send IS
// the approval for this outgoing email. Supports an optional rich-text body
// (html), file attachments, and clearing a previously-saved draft on success.
export async function composeSend(input: {
  mailboxId: string;
  to: string;
  cc?: string;
  subject: string;
  body: string; // plain-text version (always present)
  html?: string | null; // rich-text version (optional)
  attachments?: ComposeAttachmentInput[];
  draftId?: string; // a saved compose draft to delete once sent
}): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const box = await loadBox(input.mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };
  const to = parseAddrs(input.to);
  const cc = parseAddrs(input.cc ?? "");
  if (to.length === 0) return { ok: false, message: "Add at least one valid recipient." };
  if (!input.subject.trim()) return { ok: false, message: "Add a subject." };
  if (!input.body.trim() && !(input.html ?? "").trim()) return { ok: false, message: "Write a message." };

  const atts = toStored(input.attachments);
  if (atts.reduce((n, a) => n + a.size, 0) > MAX_ATTACH_BYTES) return { ok: false, message: "Attachments exceed 20 MB." };

  try {
    const pass = mailboxPassword(box);
    const sig = box.signature?.trim();
    const text = sig ? `${input.body.trim()}\n\n${sig}` : input.body.trim();
    const html = (input.html ?? "").trim()
      ? `${input.html}${sig ? `<br><br><div style="white-space:pre-wrap;color:#555">${escapeHtml(sig)}</div>` : ""}`
      : null;
    const sent = await sendMail(box, pass, { to, cc, subject: input.subject.trim(), text, html, attachments: toSendAttachments(atts) });
    await recordSent(box, pass, { to, cc, subject: input.subject.trim(), body: text, html, messageId: sent.messageId, raw: sent.raw, threadKey: sent.messageId.replace(/[<>]/g, "") });
    if (input.draftId) {
      await db.delete(emailDrafts).where(eq(emailDrafts.id, input.draftId));
      await removeDraftAttachments(input.draftId);
    }
    await audit({ actorId: user.id, actorName: user.name, action: "inbox.compose_send", target: box.id, detail: { to, from: box.address } });
    revalidatePath("/inbox");
    return { ok: true, message: `Sent from ${box.address}.` };
  } catch (e) {
    return { ok: false, message: `Send failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}` };
  }
}

// ── Compose drafts (standalone "New message" drafts saved to finish later) ──────

export type ComposeDraftLite = {
  id: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  attachments: { filename: string; contentType: string; size: number }[];
  createdAt: string;
};

// List the admin's saved compose drafts for a mailbox (newest first), for the
// Drafts folder view. Attachment bytes are omitted here (metadata only).
export async function listComposeDrafts(mailboxId: string): Promise<ComposeDraftLite[]> {
  const user = await requireOperator();
  if (!user) return [];
  const rows = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.mailboxId, mailboxId), eq(emailDrafts.kind, "compose"), isNull(emailDrafts.inReplyTo), eq(emailDrafts.status, "pending")))
    .orderBy(desc(emailDrafts.createdAt));
  return rows.map((d) => ({
    id: d.id,
    to: (d.toAddrs as string[]) ?? [],
    cc: (d.ccAddrs as string[]) ?? [],
    subject: d.subject,
    bodyText: d.bodyText,
    bodyHtml: d.bodyHtml,
    attachments: ((d.attachments as StoredAttachment[]) ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
    createdAt: d.createdAt.toISOString(),
  }));
}

// Open a compose draft for editing — includes attachment bytes so they survive
// a save/edit round-trip.
export async function openComposeDraft(draftId: string): Promise<(ComposeDraftLite & { attachmentData: StoredAttachment[] }) | null> {
  const user = await requireOperator();
  if (!user) return null;
  const [d] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId)).limit(1);
  if (!d) return null;
  const stored = (d.attachments as StoredAttachment[]) ?? [];
  const withBytes = await readDraftAttachments(stored);
  return {
    id: d.id,
    to: (d.toAddrs as string[]) ?? [],
    cc: (d.ccAddrs as string[]) ?? [],
    subject: d.subject,
    bodyText: d.bodyText,
    bodyHtml: d.bodyHtml,
    attachments: stored.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
    attachmentData: withBytes,
    createdAt: d.createdAt.toISOString(),
  };
}

// Save (create or update) a standalone compose draft.
export async function saveComposeDraft(input: {
  draftId?: string;
  mailboxId: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  html?: string | null;
  attachments?: ComposeAttachmentInput[];
}): Promise<{ ok: boolean; message?: string; draftId?: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const box = await loadBox(input.mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };
  if (!input.subject.trim() && !input.body.trim() && !(input.html ?? "").trim() && !input.to.trim())
    return { ok: false, message: "Nothing to save yet." };

  const rawAtts = toStored(input.attachments);
  if (rawAtts.reduce((n, a) => n + a.size, 0) > MAX_ATTACH_BYTES) return { ok: false, message: "Attachments exceed 20 MB." };

  // Use a known id up front so attachment bytes can be written to disk (keyed by
  // draft id) before the row is written, keeping the DB row metadata-only.
  const draftId = input.draftId ?? crypto.randomUUID();
  const atts = await persistDraftAttachments(draftId, rawAtts);
  const values = {
    id: draftId,
    mailboxId: box.id,
    kind: "compose" as const,
    toAddrs: parseAddrs(input.to),
    ccAddrs: parseAddrs(input.cc ?? ""),
    subject: input.subject.trim() || "(no subject)",
    bodyText: input.body,
    bodyHtml: (input.html ?? "").trim() || null,
    attachments: atts,
    status: "pending" as const,
    generatedBy: "human",
  };

  if (input.draftId) {
    await db.update(emailDrafts).set(values).where(eq(emailDrafts.id, input.draftId));
    revalidatePath("/inbox");
    return { ok: true, draftId: input.draftId };
  }
  const [created] = await db.insert(emailDrafts).values(values).returning({ id: emailDrafts.id });
  revalidatePath("/inbox");
  return { ok: true, draftId: created.id };
}

export async function deleteComposeDraft(draftId: string): Promise<{ ok: boolean }> {
  const user = await requireOperator();
  if (!user) return { ok: false };
  await db.delete(emailDrafts).where(eq(emailDrafts.id, draftId));
  await removeDraftAttachments(draftId);
  revalidatePath("/inbox");
  return { ok: true };
}

export async function syncNow(mailboxId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireOperator();
  if (!user) return { ok: false, message: "Not signed in." };
  const box = await loadBox(mailboxId);
  if (!box) return { ok: false, message: "Mailbox not found." };
  const r = await syncMailbox(box);
  revalidatePath("/inbox");
  if (r.error) return { ok: false, message: `Sync failed: ${r.error}` };
  return { ok: true, message: r.fetched > 0 ? `${r.fetched} new message(s).` : "Up to date." };
}
