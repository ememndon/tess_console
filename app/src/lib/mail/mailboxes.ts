import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailboxes, emailDrafts } from "@/lib/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/vault";
import { imapVerify } from "./imap";
import { smtpVerify } from "./smtp";

export type MailboxRow = typeof mailboxes.$inferSelect;

// Hostinger defaults — overridable per mailbox on the Settings form.
export const HOSTINGER_DEFAULTS = {
  imapHost: "imap.hostinger.com",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "smtp.hostinger.com",
  smtpPort: 465,
  smtpSecure: true,
};

export async function listMailboxes(): Promise<MailboxRow[]> {
  return db.select().from(mailboxes).orderBy(asc(mailboxes.site), asc(mailboxes.address));
}

export async function getMailbox(id: string): Promise<MailboxRow | undefined> {
  const [row] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
  return row;
}

/** Decrypt the stored IMAP/SMTP password — server-only, never sent to the client. */
// Mute / unmute Tess's auto-drafting for a whole mailbox. Disabling also clears any
// pending drafts already queued for it. Returns how many drafts were cleared.
export async function setMailboxAutoReply(id: string, enabled: boolean): Promise<number> {
  await db.update(mailboxes).set({ autoReply: enabled }).where(eq(mailboxes.id, id));
  if (enabled) return 0;
  const del = await db
    .delete(emailDrafts)
    .where(and(eq(emailDrafts.mailboxId, id), eq(emailDrafts.status, "pending")))
    .returning({ id: emailDrafts.id });
  return del.length;
}

export function mailboxPassword(box: MailboxRow): string {
  return decryptSecret(box.passwordEnc);
}

export type MailboxInput = {
  site: string;
  address: string;
  displayName: string;
  purpose: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password?: string; // omit on edit to keep the existing one
  signature?: string | null;
  enabled?: boolean;
};

export async function createMailbox(input: MailboxInput, actor: string): Promise<MailboxRow> {
  if (!input.password) throw new Error("A password is required for a new mailbox.");
  // Round-trip the ciphertext before storing — a blank VAULT_MASTER_KEY would
  // otherwise silently store an undecryptable value (lesson from the GSC secret).
  const passwordEnc = encryptSecret(input.password);
  if (decryptSecret(passwordEnc) !== input.password) throw new Error("Vault round-trip failed — check VAULT_MASTER_KEY.");
  const [row] = await db
    .insert(mailboxes)
    .values({
      site: input.site,
      address: input.address.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      purpose: input.purpose,
      imapHost: input.imapHost.trim(),
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      smtpHost: input.smtpHost.trim(),
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      username: input.username.trim(),
      passwordEnc,
      signature: input.signature ?? null,
      enabled: input.enabled ?? true,
      createdBy: actor,
    })
    .returning();
  return row;
}

export async function updateMailbox(id: string, input: MailboxInput): Promise<void> {
  const patch: Partial<typeof mailboxes.$inferInsert> = {
    site: input.site,
    address: input.address.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    purpose: input.purpose,
    imapHost: input.imapHost.trim(),
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    smtpHost: input.smtpHost.trim(),
    smtpPort: input.smtpPort,
    smtpSecure: input.smtpSecure,
    username: input.username.trim(),
    signature: input.signature ?? null,
    enabled: input.enabled ?? true,
  };
  if (input.password) {
    const passwordEnc = encryptSecret(input.password);
    if (decryptSecret(passwordEnc) !== input.password) throw new Error("Vault round-trip failed — check VAULT_MASTER_KEY.");
    patch.passwordEnc = passwordEnc;
    patch.status = "untested";
  }
  await db.update(mailboxes).set(patch).where(eq(mailboxes.id, id));
}

export async function deleteMailbox(id: string): Promise<void> {
  await db.delete(mailboxes).where(eq(mailboxes.id, id));
}

export type TestResult = { ok: boolean; message: string };

/** Verify IMAP login + SMTP login; record the combined status on the row. */
export async function testMailbox(box: MailboxRow): Promise<TestResult> {
  const pass = mailboxPassword(box);
  const imap = await imapVerify(box, pass);
  if (!imap.ok) {
    await db.update(mailboxes).set({ status: "failed", lastError: `IMAP: ${imap.message}` }).where(eq(mailboxes.id, box.id));
    return { ok: false, message: `IMAP: ${imap.message}` };
  }
  const smtp = await smtpVerify(box, pass);
  if (!smtp.ok) {
    await db.update(mailboxes).set({ status: "failed", lastError: `SMTP: ${smtp.message}` }).where(eq(mailboxes.id, box.id));
    return { ok: false, message: `SMTP: ${smtp.message}` };
  }
  await db.update(mailboxes).set({ status: "ok", lastError: null }).where(eq(mailboxes.id, box.id));
  return { ok: true, message: `IMAP + SMTP login OK (${box.address}).` };
}
