import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { mailboxes, mailboxFolders, emailMessages, emailDrafts } from "./db/schema";
import type { MailboxLite, MessageLite, MessageFull, DraftLite, FolderLite } from "./inbox-types";
import { FOLDER_ORDER } from "./inbox-types";
import { needsReplyWhere } from "./email-needs-reply";
import type { SiteScope } from "./site-scope";

type MsgRow = typeof emailMessages.$inferSelect;

function toLite(m: MsgRow): MessageLite {
  return {
    id: m.id,
    direction: m.direction,
    fromAddr: m.fromAddr,
    fromName: m.fromName,
    toAddrs: (m.toAddrs as string[]) ?? [],
    subject: m.subject,
    snippet: m.snippet,
    internalDate: m.internalDate ? m.internalDate.toISOString() : null,
    seen: m.seen,
    answered: m.answered,
    flagged: m.flagged,
    actionable: m.actionable,
    hasAttachments: m.hasAttachments,
    threadKey: m.threadKey,
  };
}

export async function getInboxMailboxes(): Promise<MailboxLite[]> {
  const boxes = await db.select().from(mailboxes).orderBy(asc(mailboxes.site), asc(mailboxes.address));
  const counts = await db
    .select({
      mailboxId: emailMessages.mailboxId,
      unread: sql<number>`count(*) FILTER (WHERE ${emailMessages.direction} = 'inbound' AND ${emailMessages.seen} = false)`.mapWith(Number),
      actionable: sql<number>`count(*) FILTER (WHERE ${needsReplyWhere})`.mapWith(Number),
    })
    .from(emailMessages)
    .groupBy(emailMessages.mailboxId);
  const byId = new Map(counts.map((c) => [c.mailboxId, c]));
  return boxes.map((b) => ({
    id: b.id,
    site: b.site,
    address: b.address,
    displayName: b.displayName,
    purpose: b.purpose,
    enabled: b.enabled,
    status: b.status,
    unread: byId.get(b.id)?.unread ?? 0,
    actionable: byId.get(b.id)?.actionable ?? 0,
    lastSyncAt: b.lastSyncAt ? b.lastSyncAt.toISOString() : null,
    lastSyncStatus: b.lastSyncStatus,
    lastError: b.lastError,
  }));
}

// Folder list for a mailbox with per-folder counts, ordered for the rail.
export async function getFolders(mailboxId: string): Promise<FolderLite[]> {
  const folderRows = await db
    .select({ path: mailboxFolders.path, name: mailboxFolders.name, role: mailboxFolders.role })
    .from(mailboxFolders)
    .where(eq(mailboxFolders.mailboxId, mailboxId));
  // Counts for THIS mailbox in one grouped pass, keyed by folder path and joined
  // back in code. Explicitly scoped to mailboxId — all three mailboxes share the
  // same folder PATHS (INBOX, INBOX.Sent, …), so a count that isn't filtered by
  // mailbox would sum across mailboxes and show identical badges everywhere.
  const countRows = await db
    .select({
      folder: emailMessages.folder,
      total: sql<number>`count(*)`.mapWith(Number),
      unread: sql<number>`count(*) FILTER (WHERE ${emailMessages.seen} = false AND ${emailMessages.direction} = 'inbound')`.mapWith(Number),
    })
    .from(emailMessages)
    .where(eq(emailMessages.mailboxId, mailboxId))
    .groupBy(emailMessages.folder);
  const counts = new Map(countRows.map((c) => [c.folder, c]));
  const folders: FolderLite[] = folderRows.map((f) => ({
    path: f.path,
    name: f.name,
    role: f.role,
    total: counts.get(f.path)?.total ?? 0,
    unread: counts.get(f.path)?.unread ?? 0,
  }));
  // Keep standard roles always; drop empty "other" folders to avoid clutter.
  const visible = folders.filter((f) => f.role !== "other" || f.total > 0);
  return visible.sort((a, b) => {
    const ra = FOLDER_ORDER.indexOf(a.role);
    const rb = FOLDER_ORDER.indexOf(b.role);
    if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    return a.name.localeCompare(b.name);
  });
}

/** Resolve a mailbox's folder path for a role (e.g. trash/junk/sent) — used by actions. */
export async function folderPathForRole(mailboxId: string, role: string): Promise<string | null> {
  const [row] = await db
    .select({ path: mailboxFolders.path })
    .from(mailboxFolders)
    .where(and(eq(mailboxFolders.mailboxId, mailboxId), eq(mailboxFolders.role, role)))
    .limit(1);
  return row?.path ?? null;
}

export type MessageFilter = "all" | "needs_reply" | "unread";

export const MESSAGES_PAGE = 200;

export async function getMessages(mailboxId: string, folder: string, filter: MessageFilter = "all", q?: string, limit = MESSAGES_PAGE, offset = 0): Promise<MessageLite[]> {
  const conds = [eq(emailMessages.mailboxId, mailboxId), eq(emailMessages.folder, folder)];
  if (filter === "needs_reply") {
    conds.push(eq(emailMessages.direction, "inbound"), eq(emailMessages.actionable, true), eq(emailMessages.answered, false));
  } else if (filter === "unread") {
    conds.push(eq(emailMessages.direction, "inbound"), eq(emailMessages.seen, false));
  }
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    // Searches subject, sender and snippet plus the full body text so a phrase
    // deep in a message is findable, not just what's in the preview.
    conds.push(sql`(${emailMessages.subject} ILIKE ${like} OR ${emailMessages.fromAddr} ILIKE ${like} OR ${emailMessages.fromName} ILIKE ${like} OR ${emailMessages.snippet} ILIKE ${like} OR ${emailMessages.bodyText} ILIKE ${like})`);
  }
  const rows = await db
    .select()
    .from(emailMessages)
    .where(and(...conds))
    .orderBy(desc(emailMessages.internalDate))
    .limit(Math.min(500, Math.max(1, limit)))
    .offset(Math.max(0, offset));
  return rows.map(toLite);
}

export async function getMessage(
  id: string,
): Promise<{ message: MessageFull; thread: MessageLite[]; drafts: DraftLite[] } | null> {
  const [m] = await db.select().from(emailMessages).where(eq(emailMessages.id, id)).limit(1);
  if (!m) return null;
  const thread = await db
    .select()
    .from(emailMessages)
    .where(and(eq(emailMessages.mailboxId, m.mailboxId), eq(emailMessages.threadKey, m.threadKey)))
    .orderBy(asc(emailMessages.internalDate));
  const drafts = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.mailboxId, m.mailboxId), eq(emailDrafts.threadKey, m.threadKey)))
    .orderBy(desc(emailDrafts.createdAt));

  const full: MessageFull = {
    ...toLite(m),
    mailboxId: m.mailboxId,
    bodyText: m.bodyText,
    bodyHtml: m.bodyHtml,
    ccAddrs: (m.ccAddrs as string[]) ?? [],
    attachments: (m.attachments as MessageFull["attachments"]) ?? [],
  };
  return {
    message: full,
    thread: thread.map(toLite),
    drafts: drafts.map((d) => ({
      id: d.id,
      status: d.status,
      subject: d.subject,
      bodyText: d.bodyText,
      toAddrs: (d.toAddrs as string[]) ?? [],
      generatedBy: d.generatedBy,
      provider: d.provider,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

export async function getPendingDraftCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(emailDrafts)
    .where(eq(emailDrafts.status, "pending"));
  return row?.n ?? 0;
}

// ── Diagnosis ────────────────────────────────────────────────────────────────
// The mailbox list shows counts. This answers "are we on top of support?" —
// how long mail has waited, the oldest unanswered item, aging buckets, per-mailbox
// backlog, approx median time-to-reply, sync staleness, bounces, and recurring
// topics. So Tess flags an SLA slip and names the mailbox, not just a number.

type DiagRow = Record<string, unknown>;
const diagRows = async (q: SQL): Promise<DiagRow[]> => (await db.execute(q)) as unknown as DiagRow[];
const dnum = (v: unknown): number => (v == null ? 0 : Number(v));

// Inline "needs a reply" predicate (table alias `m`) — mirrors needsReplyWhere
// but usable in raw aggregate FILTERs alongside joins.
const WAITING: SQL = sql`m.direction = 'inbound' AND m.actionable = true AND m.answered = false
  AND NOT EXISTS (SELECT 1 FROM mailbox_folders f WHERE f.mailbox_id = m.mailbox_id AND f.path = m.folder AND f.role IN ('junk','trash'))`;

export type InboxMailboxDiag = {
  mailboxId: string; address: string; site: string; status: string;
  lastSyncAt: string | null; syncStatus: string | null; syncStale: boolean; lastError: string | null;
  unread: number; messagesWaiting: number; conversationsWaiting: number;
  oldestWaitingAt: string | null; oldestWaitingAgeHours: number | null;
  waitingOver24h: number; waitingOver48h: number;
};

export type InboxDiagnosis = {
  scope: SiteScope; days: number;
  totals: { messagesWaiting: number; conversationsWaiting: number; oldestWaitingAgeHours: number | null; waitingOver24h: number; waitingOver48h: number; approxMedianReplyHours: number | null };
  perMailbox: InboxMailboxDiag[];
  bounces: { count: number; recent: { from: string | null; subject: string | null; at: string }[] };
  recurringTopics: { topic: string; count: number }[];
  syncIssues: { address: string; status: string | null; lastError: string | null; lastSyncAt: string | null }[];
  notes: string[];
};

export async function getInboxDiagnosis(scope: SiteScope = "all", days = 30): Promise<InboxDiagnosis> {
  const bScope: SQL = scope === "all" ? sql`true` : sql`b.site = ${scope}`;

  const perBoxRows = await diagRows(sql`
    SELECT b.id, b.address, b.site, b.status, b.last_sync_at, b.last_sync_status, b.last_error,
      count(*) FILTER (WHERE m.direction = 'inbound' AND m.seen = false)::int AS unread,
      count(*) FILTER (WHERE ${WAITING})::int AS waiting_msgs,
      count(DISTINCT m.thread_key) FILTER (WHERE ${WAITING})::int AS waiting_convos,
      min(m.internal_date) FILTER (WHERE ${WAITING}) AS oldest_waiting,
      count(*) FILTER (WHERE ${WAITING} AND m.internal_date < now() - interval '24 hours')::int AS over24,
      count(*) FILTER (WHERE ${WAITING} AND m.internal_date < now() - interval '48 hours')::int AS over48
    FROM mailboxes b
    LEFT JOIN email_messages m ON m.mailbox_id = b.id
    WHERE ${bScope}
    GROUP BY b.id, b.address, b.site, b.status, b.last_sync_at, b.last_sync_status, b.last_error
    ORDER BY waiting_msgs DESC, b.address
  `);

  const now = Date.now();
  const ageH = (d: unknown): number | null => (d == null ? null : Math.round(((now - new Date(d as string).getTime()) / 3_600_000) * 10) / 10);
  const STALE_MS = 30 * 60_000; // a sync older than 30m is stale (cron runs every 5m)
  const perMailbox: InboxMailboxDiag[] = perBoxRows.map((r) => ({
    mailboxId: String(r.id), address: String(r.address), site: String(r.site), status: String(r.status ?? "unknown"),
    lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at as string).toISOString() : null,
    syncStatus: r.last_sync_status == null ? null : String(r.last_sync_status),
    syncStale: r.last_sync_at == null || now - new Date(r.last_sync_at as string).getTime() > STALE_MS,
    lastError: r.last_error == null ? null : String(r.last_error),
    unread: dnum(r.unread), messagesWaiting: dnum(r.waiting_msgs), conversationsWaiting: dnum(r.waiting_convos),
    oldestWaitingAt: r.oldest_waiting ? new Date(r.oldest_waiting as string).toISOString() : null,
    oldestWaitingAgeHours: ageH(r.oldest_waiting),
    waitingOver24h: dnum(r.over24), waitingOver48h: dnum(r.over48),
  }));

  // Approx median time-to-first-reply across threads with both an inbound and a
  // later outbound message (response speed signal).
  const [med] = await diagRows(sql`
    WITH firsts AS (
      SELECT m.thread_key,
        min(m.internal_date) FILTER (WHERE m.direction = 'inbound') AS first_in,
        min(m.internal_date) FILTER (WHERE m.direction = 'outbound') AS first_out
      FROM email_messages m JOIN mailboxes b ON b.id = m.mailbox_id
      WHERE ${bScope} AND m.internal_date >= now() - make_interval(days => ${days})
      GROUP BY m.thread_key
    )
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (first_out - first_in)) / 3600.0) AS median_h
    FROM firsts WHERE first_in IS NOT NULL AND first_out IS NOT NULL AND first_out > first_in
  `);

  // Bounces / delivery failures sitting in the inbox (suppressed from needs-reply,
  // so otherwise invisible). Surfaced as a deliverability signal.
  const bounceRows = await diagRows(sql`
    SELECT m.from_addr, m.subject, m.internal_date AS at
    FROM email_messages m JOIN mailboxes b ON b.id = m.mailbox_id
    WHERE ${bScope} AND m.direction = 'inbound' AND m.internal_date >= now() - make_interval(days => ${days})
      AND (m.from_addr ~* '(mailer-daemon|postmaster|bounce)'
        OR m.subject ~* '(delivery (status notification|has failed)|undeliverable|returned mail|failure notice|mail delivery failed)')
    ORDER BY m.internal_date DESC LIMIT 8
  `);

  const topicRows = await diagRows(sql`
    SELECT lower(trim(regexp_replace(coalesce(m.subject, '(no subject)'), '^(re|fwd|fw)\\s*:\\s*', '', 'i'))) AS topic, count(*)::int AS n
    FROM email_messages m JOIN mailboxes b ON b.id = m.mailbox_id
    WHERE ${bScope} AND m.direction = 'inbound' AND m.internal_date >= now() - make_interval(days => ${days})
    GROUP BY topic HAVING count(*) >= 2 ORDER BY n DESC LIMIT 6
  `);

  const totals = {
    messagesWaiting: perMailbox.reduce((a, b) => a + b.messagesWaiting, 0),
    conversationsWaiting: perMailbox.reduce((a, b) => a + b.conversationsWaiting, 0),
    oldestWaitingAgeHours: perMailbox.reduce<number | null>((a, b) => (b.oldestWaitingAgeHours == null ? a : a == null ? b.oldestWaitingAgeHours : Math.max(a, b.oldestWaitingAgeHours)), null),
    waitingOver24h: perMailbox.reduce((a, b) => a + b.waitingOver24h, 0),
    waitingOver48h: perMailbox.reduce((a, b) => a + b.waitingOver48h, 0),
    approxMedianReplyHours: med?.median_h == null ? null : Math.round(Number(med.median_h) * 10) / 10,
  };
  const bounces = {
    count: bounceRows.length,
    recent: bounceRows.map((r) => ({ from: r.from_addr == null ? null : String(r.from_addr), subject: r.subject == null ? null : String(r.subject), at: new Date(r.at as string).toISOString() })),
  };
  const recurringTopics = topicRows.map((r) => ({ topic: String(r.topic), count: dnum(r.n) }));
  const syncIssues = perMailbox
    .filter((m) => m.syncStatus === "failed" || m.syncStale)
    .map((m) => ({ address: m.address, status: m.syncStatus, lastError: m.lastError, lastSyncAt: m.lastSyncAt }));

  const notes: string[] = [];
  if (totals.messagesWaiting === 0) notes.push("Nothing is waiting on a reply — the inbox is clear.");
  else {
    notes.push(`${totals.messagesWaiting} message(s) across ${totals.conversationsWaiting} conversation(s) awaiting a reply.`);
    if (totals.oldestWaitingAgeHours != null && totals.oldestWaitingAgeHours >= 24) {
      const top = [...perMailbox].sort((a, b) => (b.oldestWaitingAgeHours ?? 0) - (a.oldestWaitingAgeHours ?? 0))[0];
      notes.push(`Oldest unanswered mail has waited ${Math.round((totals.oldestWaitingAgeHours / 24) * 10) / 10}d${top ? ` (${top.address})` : ""} — reply or triage it.`);
    }
    if (totals.waitingOver48h > 0) notes.push(`${totals.waitingOver48h} item(s) have waited over 48h — these risk an unhappy customer; prioritize them.`);
  }
  if (totals.approxMedianReplyHours != null) notes.push(`Typical time-to-first-reply is about ${totals.approxMedianReplyHours}h.`);
  for (const s of syncIssues) notes.push(`Mailbox ${s.address} ${s.status === "failed" ? `sync is FAILING (${s.lastError ?? "unknown error"})` : "hasn't synced recently"} — its counts may be stale; check Settings → Mailboxes.`);
  if (bounces.count > 0) notes.push(`${bounces.count} delivery-failure/bounce message(s) in the last ${days}d — some mail you (or Tess drafts) sent isn't getting through; cross-check deliverability with diagnose_outreach.`);
  if (recurringTopics[0]) notes.push(`Recurring topic: "${recurringTopics[0].topic}" came up ${recurringTopics[0].count}× — consider a canned reply, FAQ, or product fix.`);

  return { scope, days, totals, perMailbox, bounces, recurringTopics, syncIssues, notes };
}
