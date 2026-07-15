import "server-only";
import { ImapFlow } from "imapflow";
import type { MailboxRow } from "./mailboxes";

// First-time backfill cap per folder — keeps the initial sync bounded. Later
// syncs only pull mail newer than that folder's highest seen UID.
const INITIAL_LIMIT = 150;

function buildClient(box: MailboxRow, password: string): ImapFlow {
  return new ImapFlow({
    host: box.imapHost,
    port: box.imapPort,
    secure: box.imapSecure,
    auth: { user: box.username, pass: password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
}

export type VerifyResult = { ok: boolean; message: string };

/** Cheap login probe used by the Settings "test connection" button. */
export async function imapVerify(box: MailboxRow, password: string): Promise<VerifyResult> {
  const client = buildClient(box, password);
  try {
    await client.connect();
    await client.logout();
    return { ok: true, message: "IMAP login OK." };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 180) };
  } finally {
    try {
      if (client.usable) await client.close();
    } catch {
      /* already closed */
    }
  }
}

/** Open one connection, run fn, always log out. Action helpers run inside this. */
export async function withImap<T>(box: MailboxRow, password: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const client = buildClient(box, password);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    try {
      if (client.usable) await client.close();
    } catch {
      /* ignore */
    }
  }
}

export type FolderRole = "inbox" | "sent" | "drafts" | "junk" | "trash" | "archive" | "other";
export type FolderInfo = { path: string; name: string; role: FolderRole; subscribed: boolean };

const SPECIAL_USE: Record<string, FolderRole> = {
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Junk": "junk",
  "\\Trash": "trash",
  "\\Archive": "archive",
};

export function classifyFolder(path: string, name: string, specialUse?: string): FolderRole {
  if (path.toUpperCase() === "INBOX") return "inbox";
  if (specialUse && SPECIAL_USE[specialUse]) return SPECIAL_USE[specialUse];
  const n = name.toLowerCase();
  if (/^sent\b|sent items|sent messages/.test(n)) return "sent";
  if (/junk|spam|bulk/.test(n)) return "junk";
  if (/trash|deleted/.test(n)) return "trash";
  if (/draft/.test(n)) return "drafts";
  if (/archive|all mail/.test(n)) return "archive";
  return "other";
}

export async function listFolders(c: ImapFlow): Promise<FolderInfo[]> {
  const list = await c.list();
  return list
    .filter((f) => !f.flags.has("\\Noselect"))
    .map((f) => ({ path: f.path, name: f.name, role: classifyFolder(f.path, f.name, f.specialUse), subscribed: f.subscribed }));
}

export type RawMessage = {
  uid: number;
  source: Buffer;
  flags: Set<string>;
  internalDate: Date | undefined;
};

const FETCH_QUERY = { uid: true, flags: true, internalDate: true, source: true } as const;

/** Pull new messages from a folder above lastUid (or the most recent INITIAL_LIMIT on first run). */
export async function fetchNewInFolder(c: ImapFlow, path: string, lastUid: number): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  const lock = await c.getMailboxLock(path);
  try {
    const exists = c.mailbox ? c.mailbox.exists : 0;
    if (exists === 0) return out;
    if (lastUid > 0) {
      for await (const msg of c.fetch(`${lastUid + 1}:*`, FETCH_QUERY, { uid: true })) {
        if (msg.uid <= lastUid || !msg.source) continue;
        out.push({ uid: msg.uid, source: msg.source, flags: msg.flags ?? new Set(), internalDate: toDate(msg.internalDate) });
      }
    } else {
      const start = Math.max(1, exists - INITIAL_LIMIT + 1);
      for await (const msg of c.fetch(`${start}:${exists}`, FETCH_QUERY)) {
        if (!msg.source) continue;
        out.push({ uid: msg.uid, source: msg.source, flags: msg.flags ?? new Set(), internalDate: toDate(msg.internalDate) });
      }
    }
  } finally {
    lock.release();
  }
  return out.sort((a, b) => a.uid - b.uid);
}

/**
 * Fetch ONLY the flags (no bodies) for every message in a folder with UID >=
 * fromUid. Cheap. Used by the sync's reconcile pass to mirror back changes made
 * elsewhere (read/answered/flagged in webmail) and to detect expunged messages —
 * fetchNewInFolder only ever sees UIDs above the watermark, so without this the
 * local cache silently drifts from the server.
 */
export async function fetchFlagsRange(c: ImapFlow, path: string, fromUid: number): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const lock = await c.getMailboxLock(path);
  try {
    const exists = c.mailbox ? c.mailbox.exists : 0;
    if (exists === 0) return out;
    for await (const msg of c.fetch(`${Math.max(1, fromUid)}:*`, { uid: true, flags: true }, { uid: true })) {
      if (msg.uid >= fromUid) out.set(msg.uid, msg.flags ?? new Set());
    }
  } finally {
    lock.release();
  }
  return out;
}

/** Add/remove a single flag (\Seen, \Flagged, \Answered) on a message by UID. */
export async function setFlag(c: ImapFlow, path: string, uid: number, flag: string, add: boolean): Promise<void> {
  const lock = await c.getMailboxLock(path);
  try {
    if (add) await c.messageFlagsAdd(`${uid}`, [flag], { uid: true });
    else await c.messageFlagsRemove(`${uid}`, [flag], { uid: true });
  } finally {
    lock.release();
  }
}

/** Move a message to another folder; returns the new UID in the destination if the server reports it. */
export async function moveMessage(c: ImapFlow, fromPath: string, uid: number, toPath: string): Promise<number | undefined> {
  const lock = await c.getMailboxLock(fromPath);
  try {
    const res = await c.messageMove(`${uid}`, toPath, { uid: true });
    const map = res && typeof res === "object" ? (res as { uidMap?: Map<number, number> }).uidMap : undefined;
    return map?.get(uid);
  } finally {
    lock.release();
  }
}

/** Permanently delete a message (used for emptying Trash). */
export async function deleteMessage(c: ImapFlow, path: string, uid: number): Promise<void> {
  const lock = await c.getMailboxLock(path);
  try {
    await c.messageDelete(`${uid}`, { uid: true });
  } finally {
    lock.release();
  }
}

/** Append a raw RFC822 message into a folder (e.g. filing a sent reply into Sent). */
export async function appendMessage(c: ImapFlow, path: string, raw: string | Buffer, flags: string[] = ["\\Seen"]): Promise<void> {
  try {
    await c.append(path, raw, flags);
  } catch {
    /* non-fatal */
  }
}

function toDate(v: Date | string | undefined): Date | undefined {
  if (!v) return undefined;
  return v instanceof Date ? v : new Date(v);
}
