import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { db } from "@/lib/db";
import { mailboxes, mailboxFolders, emailMessages, notifications } from "@/lib/db/schema";
import { mailboxPassword, type MailboxRow } from "./mailboxes";
import { withImap, listFolders, fetchNewInFolder, fetchFlagsRange, type FolderRole } from "./imap";

// How many recently-cached messages per folder to re-check for flag changes /
// expunges each sync. Bounds the reconcile cost (flags-only fetch, no bodies).
const RECONCILE_WINDOW = 500;

// Folders we mirror into the console (a standard webmail set). "other" custom
// folders are listed but not auto-synced to keep the cron light.
const SYNC_ROLES: FolderRole[] = ["inbox", "sent", "drafts", "junk", "trash", "archive"];

// ── parsing helpers ──────────────────────────────────────────────────────────

function addrList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  const objs = Array.isArray(a) ? a : [a];
  const out: string[] = [];
  for (const o of objs) for (const v of o.value ?? []) if (v.address) out.push(v.address.toLowerCase());
  return out;
}
function fromParts(a: AddressObject | undefined): { addr: string | null; name: string | null } {
  const v = a?.value?.[0];
  return { addr: v?.address?.toLowerCase() ?? null, name: v?.name || null };
}
function normalizeSubject(s: string | undefined): string {
  return (s ?? "").replace(/^(re|fwd|fw|aw|sv|antw)\s*:\s*/gi, "").replace(/^(re|fwd|fw|aw|sv|antw)\s*:\s*/gi, "").trim().toLowerCase().slice(0, 200);
}
function threadKeyOf(p: ParsedMail): string {
  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  const root = refs[0] || p.inReplyTo || p.messageId;
  if (root) return root.replace(/[<>]/g, "").trim().slice(0, 240);
  return `subj:${normalizeSubject(p.subject)}`;
}
function isActionable(p: ParsedMail, fromAddr: string | null): boolean {
  if (!fromAddr) return false;
  if (/(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounce|notifications?@|@.*\.?mailgun|listserv|automated)/i.test(fromAddr)) return false;
  const auto = p.headers?.get("auto-submitted");
  if (auto && String(auto).toLowerCase() !== "no") return false;
  const precedence = p.headers?.get("precedence");
  if (precedence && /bulk|list|junk/i.test(String(precedence))) return false;
  if (p.headers?.get("list-unsubscribe")) return false;
  return true;
}
function snippetOf(p: ParsedMail): string {
  return (p.text || p.subject || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

// ── per-mailbox sync ─────────────────────────────────────────────────────────

export type MailboxSyncResult = { address: string; fetched: number; actionable: number; folders: number; error?: string };

export async function syncMailbox(box: MailboxRow): Promise<MailboxSyncResult> {
  let pass: string;
  try {
    pass = mailboxPassword(box);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(mailboxes).set({ lastSyncStatus: "failed", lastError: `vault: ${msg}`, syncFails: box.syncFails + 1 }).where(eq(mailboxes.id, box.id));
    return { address: box.address, fetched: 0, actionable: 0, folders: 0, error: msg };
  }

  let fetched = 0;
  let newActionable = 0;
  let newSpam = 0;
  let folderCount = 0;

  try {
    await withImap(box, pass, async (c) => {
      const folders = await listFolders(c);
      folderCount = folders.length;

      // Upsert the folder map. Seed INBOX's watermark from the legacy column so
      // we don't re-pull the inbox on the first multi-folder sync.
      for (const f of folders) {
        await db
          .insert(mailboxFolders)
          .values({ mailboxId: box.id, path: f.path, name: f.name, role: f.role, subscribed: f.subscribed, lastUid: f.role === "inbox" ? box.lastUid : 0 })
          .onConflictDoUpdate({ target: [mailboxFolders.mailboxId, mailboxFolders.path], set: { name: f.name, role: f.role, subscribed: f.subscribed, updatedAt: new Date() } });
      }

      const rows = await db.select().from(mailboxFolders).where(eq(mailboxFolders.mailboxId, box.id));
      const toSync = rows.filter((r) => r.syncEnabled && (SYNC_ROLES as string[]).includes(r.role));

      for (const folder of toSync) {
        const raw = await fetchNewInFolder(c, folder.path, folder.lastUid);
        let maxUid = folder.lastUid;
        const outbound = folder.role === "sent" || folder.role === "drafts";
        for (const m of raw) {
          maxUid = Math.max(maxUid, m.uid);
          let parsed: ParsedMail;
          try {
            parsed = await simpleParser(m.source);
          } catch {
            continue;
          }
          const from = fromParts(parsed.from);
          const actionable = folder.role === "inbox" && isActionable(parsed, from.addr);
          const inserted = await db
            .insert(emailMessages)
            .values({
              mailboxId: box.id,
              uid: m.uid,
              folder: folder.path,
              direction: outbound ? "outbound" : "inbound",
              messageId: parsed.messageId ?? null,
              threadKey: threadKeyOf(parsed),
              fromAddr: from.addr,
              fromName: from.name,
              toAddrs: addrList(parsed.to),
              ccAddrs: addrList(parsed.cc),
              subject: parsed.subject ?? null,
              snippet: snippetOf(parsed),
              bodyText: parsed.text ?? (parsed.html ? "" : null),
              bodyHtml: parsed.html || null,
              hasAttachments: (parsed.attachments?.length ?? 0) > 0,
              attachments: (parsed.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
              internalDate: m.internalDate ?? parsed.date ?? null,
              seen: m.flags.has("\\Seen") || outbound,
              answered: m.flags.has("\\Answered"),
              flagged: m.flags.has("\\Flagged"),
              actionable,
            })
            .onConflictDoNothing({ target: [emailMessages.mailboxId, emailMessages.folder, emailMessages.uid] })
            .returning({ id: emailMessages.id });
          if (inserted.length) {
            fetched++;
            if (actionable) newActionable++;
            // New mail the server filed straight into Spam. Never actionable (Tess
            // won't draft for it), but flag it so the admin can eyeball the Junk
            // folder and rescue anything real by moving it to the Inbox.
            if (folder.role === "junk" && !outbound) newSpam++;
          }
        }
        await db.update(mailboxFolders).set({ lastUid: maxUid, updatedAt: new Date() }).where(eq(mailboxFolders.id, folder.id));
        if (folder.role === "inbox") {
          await db.update(mailboxes).set({ lastUid: maxUid }).where(eq(mailboxes.id, box.id));
        }

        // Reconcile: re-check the most recent cached messages against the server
        // so reads/replies/deletes done in webmail (or on a phone) mirror back —
        // otherwise `seen`/`answered` drift and the needs-reply count inflates.
        const cached = await db
          .select({ id: emailMessages.id, uid: emailMessages.uid, seen: emailMessages.seen, answered: emailMessages.answered, flagged: emailMessages.flagged })
          .from(emailMessages)
          .where(and(eq(emailMessages.mailboxId, box.id), eq(emailMessages.folder, folder.path)))
          .orderBy(desc(emailMessages.uid))
          .limit(RECONCILE_WINDOW);
        if (cached.length) {
          const fromUid = cached.reduce((min, r) => Math.min(min, r.uid), Number.MAX_SAFE_INTEGER);
          const live = await fetchFlagsRange(c, folder.path, fromUid);
          const maxLiveUid = live.size ? Math.max(...live.keys()) : 0;
          const expunged: string[] = [];
          for (const row of cached) {
            const f = live.get(row.uid);
            if (!f) {
              // Treat as expunged only within the range we actually scanned — never
              // delete synthetic-UID Sent copies (their UID sits above the server max).
              if (row.uid <= maxLiveUid) expunged.push(row.id);
              continue;
            }
            const seen = f.has("\\Seen"), answered = f.has("\\Answered"), flagged = f.has("\\Flagged");
            if (seen !== row.seen || answered !== row.answered || flagged !== row.flagged) {
              await db.update(emailMessages).set({ seen, answered, flagged }).where(eq(emailMessages.id, row.id));
            }
          }
          if (expunged.length) await db.delete(emailMessages).where(inArray(emailMessages.id, expunged));
        }
      }
    });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    const fails = box.syncFails + 1;
    await db.update(mailboxes).set({ lastSyncAt: new Date(), lastSyncStatus: "failed", lastError: msg, syncFails: fails, status: "failed" }).where(eq(mailboxes.id, box.id));
    if (fails === 2) {
      await db.insert(notifications).values({
        severity: "warning",
        title: `📭 Mailbox sync failing: ${box.address}`,
        body: `IMAP sync failed twice for ${box.address}: ${msg}. Check the connection in Settings → Mailboxes.`,
        module: "inbox",
      });
    }
    return { address: box.address, fetched: 0, actionable: 0, folders: folderCount, error: msg };
  }

  await db
    .update(mailboxes)
    .set({ lastSyncAt: new Date(), lastSyncStatus: "ok", lastError: null, syncFails: 0, status: "ok" })
    .where(eq(mailboxes.id, box.id));

  if (newActionable > 0) {
    await db.insert(notifications).values({
      severity: "info",
      title: `✉️ ${newActionable} new message${newActionable > 1 ? "s" : ""} — ${box.address}`,
      body: `New mail needing attention in ${box.displayName}. Open the Inbox to read and draft a reply.`,
      module: "inbox",
    });
  }

  if (newSpam > 0) {
    await db.insert(notifications).values({
      severity: "info",
      title: `🚫 ${newSpam} new message${newSpam > 1 ? "s" : ""} in Spam — ${box.address}`,
      body: `The mail server filed ${newSpam} new message${newSpam > 1 ? "s" : ""} into Junk for ${box.displayName}. Tess won't reply to spam — skim the Junk folder and move anything genuine to the Inbox to have her draft a reply.`,
      module: "inbox",
    });
  }

  return { address: box.address, fetched, actionable: newActionable, folders: folderCount };
}

export type SyncAllResult = { ok: boolean; perBox: MailboxSyncResult[] };

export async function syncAllMailboxes(): Promise<SyncAllResult> {
  const started = Date.now();
  const boxes = await db.select().from(mailboxes).where(eq(mailboxes.enabled, true));
  const perBox: MailboxSyncResult[] = [];
  for (const box of boxes) perBox.push(await syncMailbox(box));

  const durMs = Date.now() - started;
  const totalFetched = perBox.reduce((n, r) => n + r.fetched, 0);
  const errors = perBox.filter((r) => r.error).length;
  const summary = boxes.length === 0 ? "no mailboxes configured" : `${perBox.length} box(es), +${totalFetched} new${errors ? `, ${errors} error(s)` : ""}`;
  const status = errors && errors === boxes.length ? "failed" : "ok";

  await db.execute(sql`
    INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
    VALUES ('inbox-sync', now() - (${durMs} * interval '1 millisecond'), now(), ${status}, ${summary})
  `);
  await db.execute(sql`
    UPDATE jobs SET last_run_at = now(), last_status = ${status}, last_duration_ms = ${durMs}, last_output = ${summary}
    WHERE name = 'inbox-sync'
  `);

  return { ok: status === "ok", perBox };
}
