"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  RefreshCw, Sparkles, Send, Trash2, Paperclip, CornerUpLeft, Mail, Search, ShieldCheck, Reply,
  Inbox as InboxIcon, FileText, SendHorizontal, Archive, ShieldAlert, Folder, PenSquare,
  MailOpen, MailWarning, Star, X, Save, File as FileIcon,
} from "lucide-react";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import type { MailboxLite, MessageLite, MessageFull, DraftLite, FolderLite } from "@/lib/inbox-types";
import { FOLDER_META } from "@/lib/inbox-types";
import type { MessageFilter } from "@/lib/inbox";
import type { DesignMode } from "@/lib/design-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailBody } from "@/components/inbox/email-body";
import { RichEditor } from "@/components/inbox/rich-editor";
import { cn } from "@/lib/utils";
import {
  listFolders, listMessages, openMessage, draftReply, saveDraft, discardDraft, approveAndSend, syncNow,
  setSeen, archiveMessage, markSpam, deleteMessageAction, composeSend,
  saveComposeDraft, listComposeDrafts, openComposeDraft, deleteComposeDraft,
  type ComposeDraftLite, type ComposeAttachmentInput,
} from "./inbox-actions";

const FOLDER_ICONS: Record<string, typeof InboxIcon> = {
  inbox: InboxIcon, drafts: FileText, sent: SendHorizontal, archive: Archive, junk: ShieldAlert, trash: Trash2, other: Folder,
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// HTML → plain text fallback for the multipart/alternative text part.
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1)); // strip "data:...;base64,"
    };
    r.readAsDataURL(file);
  });
}

type Detail = { message: MessageFull; thread: MessageLite[]; drafts: DraftLite[] } | null;
type ComposeAttachment = { id: string; name: string; type: string; size: number; data: string };
type ComposeInit = { draftId: string | null; boxId: string; to: string; cc: string; subject: string; html: string; attachments: ComposeAttachment[] };

const INBOX_PAGE = 200; // message-list page size; matches the server cap in getMessages

export function InboxClient({ mailboxes, design = "pulse" }: { mailboxes: MailboxLite[]; design?: DesignMode }) {
  const fil = design === "filament";
  const [boxId, setBoxId] = useState(mailboxes[0]?.id ?? "");
  const [folders, setFolders] = useState<FolderLite[]>([]);
  const [folder, setFolder] = useState<string>("INBOX");
  const [folderRole, setFolderRole] = useState<string>("inbox");
  const [filter, setFilter] = useState<MessageFilter>("needs_reply");
  const [q, setQ] = useState("");
  const [messages, setMessages] = useState<MessageLite[]>([]);
  const [atEnd, setAtEnd] = useState(true); // false once a full page returns → show "Load more"
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [composer, setComposer] = useState<{ draftId: string | null; subject: string; body: string } | null>(null);
  const [compose, setCompose] = useState<ComposeInit | null>(null); // right-pane "New message" composer
  const [composeSeq, setComposeSeq] = useState(0); // stable remount key per editing session
  const [composeDrafts, setComposeDrafts] = useState<ComposeDraftLite[]>([]);
  const [busy, startBusy] = useTransition();
  const [syncing, startSync] = useTransition();

  const box = mailboxes.find((b) => b.id === boxId);
  const addrFor = useCallback((id: string) => mailboxes.find((m) => m.id === id)?.address ?? "", [mailboxes]);

  const loadFolders = useCallback((id: string) => {
    listFolders(id).then((f) => {
      setFolders(f);
      const inbox = f.find((x) => x.role === "inbox") ?? f[0];
      if (inbox) { setFolder(inbox.path); setFolderRole(inbox.role); }
    });
  }, []);

  // Refresh just the folder badge counts for the open mailbox WITHOUT resetting
  // the selected folder — used by the live tick so counts stay current.
  const refreshFolders = useCallback(() => {
    if (boxId) listFolders(boxId).then(setFolders);
  }, [boxId]);

  const loadList = useCallback(() => {
    if (!boxId || !folder) return;
    setLoadingList(true);
    listMessages(boxId, folder, folderRole === "inbox" ? filter : "all", q, INBOX_PAGE, 0)
      .then((rows) => { setMessages(rows); setAtEnd(rows.length < INBOX_PAGE); })
      .finally(() => setLoadingList(false));
  }, [boxId, folder, folderRole, filter, q]);

  // Pagination: fetch the next page and append. Background auto-refresh resets to
  // page 1 (loadList), which is fine — paging is for browsing deep history.
  const loadMore = useCallback(() => {
    if (!boxId || !folder || loadingMore) return;
    setLoadingMore(true);
    listMessages(boxId, folder, folderRole === "inbox" ? filter : "all", q, INBOX_PAGE, messages.length)
      .then((rows) => { setMessages((cur) => [...cur, ...rows]); setAtEnd(rows.length < INBOX_PAGE); })
      .finally(() => setLoadingMore(false));
  }, [boxId, folder, folderRole, filter, q, messages.length, loadingMore]);

  const loadComposeDrafts = useCallback(() => {
    if (boxId) listComposeDrafts(boxId).then(setComposeDrafts);
  }, [boxId]);

  useEffect(() => { loadFolders(boxId); }, [boxId, loadFolders]);
  useEffect(() => { loadList(); setSelId(null); setDetail(null); setComposer(null); }, [loadList]);
  useEffect(() => { if (folderRole === "drafts") loadComposeDrafts(); }, [folderRole, loadComposeDrafts]);

  // Live inbox: while the tab is on-screen, quietly pull new mail for the open
  // mailbox (real IMAP fetch) and refresh the list, so new messages appear
  // within ~30s without a manual sync. Pauses when the tab is hidden; the 5-min
  // background cron still covers mailboxes nobody is viewing.
  const autoBusy = useRef(false);
  useEffect(() => {
    if (!boxId) return;
    const tick = async () => {
      if (document.visibilityState !== "visible" || autoBusy.current) return;
      autoBusy.current = true;
      try {
        await syncNow(boxId);
        loadList(); // refresh the message list…
        refreshFolders(); // …and the folder badge counts (without resetting the open folder)
      } catch {
        /* transient; next tick retries */
      } finally {
        autoBusy.current = false;
      }
    };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [boxId, loadList, refreshFolders]);

  function select(id: string) {
    setSelId(id);
    setComposer(null);
    setCompose(null);
    setLoadingDetail(true);
    openMessage(id)
      .then((d) => {
        setDetail(d);
        const pending = d?.drafts.find((x) => x.status === "pending");
        if (pending) setComposer({ draftId: pending.id, subject: pending.subject, body: pending.bodyText });
        setMessages((cur) => cur.map((m) => (m.id === id ? { ...m, seen: true } : m)));
      })
      .finally(() => setLoadingDetail(false));
  }
  function refreshDetail(id: string) { openMessage(id).then((d) => setDetail(d)); }
  function afterRemoved() { setSelId(null); setDetail(null); setComposer(null); loadList(); loadFolders(boxId); }

  // ── right-pane composer (New message / edit compose draft) ──
  // composeSeq is the remount key: it changes per editing SESSION (new message /
  // open a different draft) but NOT when a save assigns a draftId — so saving
  // never wipes the in-progress form.
  function openComposeSession(init: ComposeInit) {
    setSelId(null); setDetail(null); setComposer(null);
    setComposeSeq((n) => n + 1);
    setCompose(init);
  }
  function startCompose() {
    openComposeSession({ draftId: null, boxId, to: "", cc: "", subject: "", html: "", attachments: [] });
  }
  function openDraft(id: string) {
    setSelId(null); setDetail(null); setComposer(null);
    openComposeDraft(id).then((d) => {
      if (!d) { toast.error("Draft not found."); return; }
      openComposeSession({
        draftId: d.id, boxId,
        to: d.to.join(", "), cc: d.cc.join(", "), subject: d.subject === "(no subject)" ? "" : d.subject,
        html: d.bodyHtml ?? (d.bodyText ? d.bodyText.replace(/\n/g, "<br>") : ""),
        attachments: d.attachmentData.map((a, i) => ({ id: `${d.id}-${i}`, name: a.filename, type: a.contentType, size: a.size, data: a.data ?? "" })),
      });
    });
  }

  function onDraftWithTess() {
    if (!detail) return;
    startBusy(async () => {
      const r = await draftReply(detail.message.id);
      if (!r.ok) { toast.error(r.message ?? "Drafting failed"); return; }
      const d = await openMessage(detail.message.id);
      setDetail(d);
      const pending = d?.drafts.find((x) => x.status === "pending");
      if (pending) setComposer({ draftId: pending.id, subject: pending.subject, body: pending.bodyText });
      toast.success("Draft ready — review before sending");
    });
  }
  function onWriteReply() {
    if (!detail) return;
    setComposer({ draftId: null, subject: `Re: ${detail.message.subject ?? ""}`.trim(), body: "" });
  }
  function onSave() {
    if (!detail || !composer) return;
    startBusy(async () => {
      const r = await saveDraft({ draftId: composer.draftId ?? undefined, messageId: detail.message.id, subject: composer.subject, body: composer.body });
      if (!r.ok) { toast.error(r.message ?? "Couldn't save"); return; }
      setComposer((c) => (c ? { ...c, draftId: r.draftId ?? c.draftId } : c));
      refreshDetail(detail.message.id);
      toast.success("Draft saved");
    });
  }
  function onSend() {
    if (!detail || !composer) return;
    startBusy(async () => {
      const saved = await saveDraft({ draftId: composer.draftId ?? undefined, messageId: detail.message.id, subject: composer.subject, body: composer.body });
      if (!saved.ok || !saved.draftId) { toast.error(saved.message ?? "Couldn't save before sending"); return; }
      const r = await approveAndSend(saved.draftId);
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      setComposer(null);
      const d = await openMessage(detail.message.id);
      setDetail(d);
      setMessages((cur) => cur.map((m) => (m.id === detail.message.id ? { ...m, answered: true } : m)));
    });
  }
  function onDiscard(draftId: string) {
    if (!detail) return;
    startBusy(async () => { await discardDraft(draftId); setComposer(null); refreshDetail(detail.message.id); });
  }
  function onSync() {
    if (!boxId) return;
    startSync(async () => { const r = await syncNow(boxId); r.ok ? toast.success(r.message) : toast.error(r.message); loadList(); loadFolders(boxId); });
  }

  // Message actions (toolbar)
  function act(fn: () => Promise<{ ok: boolean; message?: string }>, removes = true) {
    if (!detail) return;
    startBusy(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.message ?? "Action failed"); return; }
      if (r.message) toast.success(r.message);
      if (removes) afterRemoved();
      else refreshDetail(detail.message.id);
    });
  }

  const FILTERS: { key: MessageFilter; label: string }[] = [
    { key: "needs_reply", label: "Needs reply" }, { key: "unread", label: "Unread" }, { key: "all", label: "All" },
  ];

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border">
      {/* ── Mailbox + folders rail ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b p-2">
          <Select value={boxId} onValueChange={(v) => v && setBoxId(v)}>
            <SelectTrigger size="sm" className="w-full"><SelectValue>{(v) => addrFor(v as string)}</SelectValue></SelectTrigger>
            <SelectContent>
              {mailboxes.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className={cn("inline-block size-2 rounded-full", SITE_META[m.site as SiteKey]?.dot)} /> {m.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="mt-2 w-full gap-1.5" onClick={startCompose}><PenSquare className="size-3.5" /> New message</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {folders.map((f) => {
            const Icon = FOLDER_ICONS[f.role] ?? Folder;
            const active = f.path === folder;
            return (
              <button
                key={f.path}
                onClick={() => { setFolder(f.path); setFolderRole(f.role); }}
                className={cn("mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors", active ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground hover:bg-background/60")}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{FOLDER_META[f.role]?.label ?? f.name}</span>
                {f.unread > 0 && <span className={cn("shrink-0 rounded-full px-1.5 text-[10px] font-medium", active ? "bg-primary/20 text-primary" : "bg-sky-500/15 text-sky-600 dark:text-sky-400")}>{f.unread}</span>}
                {f.unread === 0 && f.total > 0 && <span className={cn("shrink-0 text-[10px]", active ? "text-primary/70" : "text-muted-foreground/60")}>{f.total}</span>}
              </button>
            );
          })}
        </div>
        {box && (
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
            {box.status === "ok" ? <span className="text-emerald-600 dark:text-emerald-400">● connected</span>
              : box.status === "failed" ? <span className="text-rose-500" title={box.lastError ?? undefined}>● connection issue</span>
              : <span>● not tested</span>}
            {box.lastSyncAt && <span> · {fmtDate(box.lastSyncAt)}</span>}
          </div>
        )}
      </aside>

      {/* ── Message list ── */}
      <section className="flex w-96 shrink-0 flex-col border-r">
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          {folderRole === "inbox" ? (
            FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} className={cn("rounded-md px-2 py-1 text-xs transition-colors", filter === f.key ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{f.label}</button>
            ))
          ) : (
            <span className="px-1 text-xs font-medium">{FOLDER_META[folderRole]?.label ?? "Folder"}</span>
          )}
          <Button variant="ghost" size="icon" className="ml-auto size-7" onClick={onSync} disabled={syncing} title="Sync now">
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          </Button>
        </div>
        <div className="border-b px-2 py-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadList()} placeholder="Search subject, sender…" className="h-8 pl-7 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* Saved compose drafts (Drafts folder) */}
          {folderRole === "drafts" && composeDrafts.map((d) => (
            <button key={d.id} onClick={() => openDraft(d.id)} className={cn("flex w-full flex-col gap-0.5 border-b border-l-2 border-l-primary/60 px-3 py-2 text-left transition-colors", compose?.draftId === d.id ? "bg-primary/10" : "hover:bg-muted/30")}>
              <div className="flex items-center gap-2">
                <PenSquare className="size-3 shrink-0 text-primary" />
                <span className="redact min-w-0 flex-1 truncate text-xs font-medium">{d.to.length ? `To: ${d.to.join(", ")}` : "(no recipient)"}</span>
                {d.attachments.length > 0 && <Paperclip className="size-3 shrink-0 text-muted-foreground" />}
                <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(d.createdAt)}</span>
              </div>
              <span className="redact truncate text-xs">{d.subject || "(no subject)"}</span>
              <span className="redact truncate text-[11px] text-muted-foreground">{htmlToText(d.bodyHtml ?? d.bodyText).slice(0, 120) || "Draft"}</span>
            </button>
          ))}
          {loadingList ? <p className="p-4 text-center text-xs text-muted-foreground">Loading…</p>
            : messages.length === 0 && !(folderRole === "drafts" && composeDrafts.length > 0)
              ? <p className="p-6 text-center text-xs text-muted-foreground">{folderRole === "inbox" && filter === "needs_reply" ? "Nothing waiting on a reply. 🎉" : "No messages."}</p>
            : messages.map((m) => {
              const outbound = m.direction === "outbound";
              return (
                <button key={m.id} onClick={() => select(m.id)}
                  className={cn("flex w-full flex-col gap-0.5 border-b border-l-2 px-3 py-2 text-left transition-colors", selId === m.id ? "bg-muted/60" : "hover:bg-muted/30", m.actionable && !m.answered ? (fil ? "border-l-[#27f0d4]" : "border-l-amber-500") : "border-l-transparent")}
                  style={fil && m.actionable && !m.answered ? { boxShadow: "inset 3px 0 14px -6px rgba(39,240,212,0.55)" } : undefined}>
                  <div className="flex items-center gap-2">
                    {!m.seen && !outbound && <span className={cn("size-1.5 shrink-0 rounded-full", fil ? "bg-[#27f0d4]" : "bg-sky-500")} />}
                    {m.flagged && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                    <span className={cn("redact min-w-0 flex-1 truncate text-xs", m.seen ? "text-muted-foreground" : "font-semibold")}>{outbound ? `To: ${m.toAddrs[0] ?? ""}` : m.fromName || m.fromAddr || "(unknown)"}</span>
                    {m.hasAttachments && <Paperclip className="size-3 shrink-0 text-muted-foreground" />}
                    {m.answered && <CornerUpLeft className="size-3 shrink-0 text-emerald-500" />}
                    <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(m.internalDate)}</span>
                  </div>
                  <span className={cn("redact truncate text-xs", m.seen ? "text-muted-foreground" : "font-medium")}>{m.subject || "(no subject)"}</span>
                  <span className="redact truncate text-[11px] text-muted-foreground">{m.snippet}</span>
                </button>
              );
            })}
          {!loadingList && !atEnd && messages.length > 0 && (
            <button onClick={loadMore} disabled={loadingMore}
              className="w-full border-t px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </section>

      {/* ── Reading / composer pane ── */}
      <section className="flex min-w-0 flex-1 flex-col">
        {compose ? (
          <ComposePane
            key={composeSeq}
            mailboxes={mailboxes}
            init={compose}
            onClose={() => setCompose(null)}
            onChanged={() => { loadComposeDrafts(); loadFolders(boxId); loadList(); }}
            setDraftId={(id) => setCompose((c) => (c ? { ...c, draftId: id } : c))}
          />
        ) : !detail ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Mail className="size-8 opacity-40" /><p className="text-sm">{loadingDetail ? "Opening…" : "Select a message to read."}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Toolbar */}
            <div className="flex items-center gap-1 border-b px-3 py-1.5">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={onWriteReply}><Reply className="size-3.5" /> Reply</Button>
              <div className="mx-1 h-4 w-px bg-border" />
              <Button variant="ghost" size="icon-sm" title={detail.message.seen ? "Mark unread" : "Mark read"} onClick={() => act(() => setSeen(detail.message.id, !detail.message.seen), false)}>
                {detail.message.seen ? <MailWarning className="size-4" /> : <MailOpen className="size-4" />}
              </Button>
              {folderRole !== "archive" && <Button variant="ghost" size="icon-sm" title="Archive" onClick={() => act(() => archiveMessage(detail.message.id))}><Archive className="size-4" /></Button>}
              {folderRole !== "junk" && <Button variant="ghost" size="icon-sm" title="Mark as spam" onClick={() => act(() => markSpam(detail.message.id))}><ShieldAlert className="size-4" /></Button>}
              <Button variant="ghost" size="icon-sm" title="Delete" className="text-destructive" onClick={() => act(() => deleteMessageAction(detail.message.id))}><Trash2 className="size-4" /></Button>
            </div>

            <div className="border-b px-5 py-3">
              <h2 className="redact text-base font-semibold">{detail.message.subject || "(no subject)"}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="redact"><span className="font-medium text-foreground">{detail.message.fromName || detail.message.fromAddr}</span>{detail.message.fromName && detail.message.fromAddr ? ` <${detail.message.fromAddr}>` : ""}</span>
                <span className="redact">To {detail.message.toAddrs.join(", ")}</span>
                <span>{detail.message.internalDate ? new Date(detail.message.internalDate).toLocaleString() : ""}</span>
                {detail.message.answered && <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CornerUpLeft className="size-3" /> replied</span>}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <EmailBody html={detail.message.bodyHtml} text={detail.message.bodyText} />
              {detail.message.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.message.attachments.map((a, i) => (
                    <span key={i} className="redact inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-muted-foreground"><Paperclip className="size-3" /> {a.filename || "attachment"}</span>
                  ))}
                </div>
              )}
              {detail.thread.length > 1 && (
                <div className="mt-5 border-t pt-3">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Conversation ({detail.thread.length})</p>
                  <div className="flex flex-col gap-1">
                    {detail.thread.filter((t) => t.id !== detail.message.id).map((t) => (
                      <button key={t.id} onClick={() => select(t.id)} className="flex items-center gap-2 rounded border px-2 py-1 text-left text-[11px] hover:bg-muted/40">
                        {t.direction === "outbound" ? <Reply className="size-3 text-sky-500" /> : <Mail className="size-3 text-muted-foreground" />}
                        <span className="redact font-medium">{t.direction === "outbound" ? "You" : t.fromName || t.fromAddr}</span>
                        <span className="redact truncate text-muted-foreground">{t.snippet}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{fmtDate(t.internalDate)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reply composer — the approval gate; in Filament the current arrives here. */}
            <div className={cn("border-t px-5 py-3", !fil && "bg-muted/10")} style={fil ? { borderTopColor: "rgba(39,240,212,0.28)", background: "linear-gradient(180deg, rgba(39,240,212,0.05), transparent 55%)" } : undefined}>
              {composer ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="size-3.5 text-emerald-500" /> Reply to <span className="redact">{detail.message.fromAddr ?? ""}</span> — sends from {box?.address}</span>
                    <Button variant="ghost" size="icon" className="size-6" onClick={() => composer.draftId ? onDiscard(composer.draftId) : setComposer(null)} title="Discard draft"><Trash2 className="size-3.5" /></Button>
                  </div>
                  <Input value={composer.subject} onChange={(e) => setComposer({ ...composer, subject: e.target.value })} placeholder="Subject" className="h-8 text-sm" />
                  <Textarea value={composer.body} onChange={(e) => setComposer({ ...composer, body: e.target.value })} rows={6} placeholder="Write your reply, or click “Draft with Tess”." className="text-sm" />
                  <div className="flex items-center gap-2">
                    <Button onClick={onSend} disabled={busy} className="gap-1.5"><Send className="size-3.5" /> Approve &amp; send</Button>
                    <Button variant="outline" onClick={onSave} disabled={busy}>Save draft</Button>
                    <Button variant="ghost" onClick={onDraftWithTess} disabled={busy} className="ml-auto gap-1.5"><Sparkles className="size-3.5" /> Redraft with Tess</Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Every email is approval-gated — nothing leaves until you click “Approve &amp; send”.</p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button onClick={onDraftWithTess} disabled={busy} className="gap-1.5"><Sparkles className="size-3.5" /> Draft reply with Tess</Button>
                  <Button variant="outline" onClick={onWriteReply} disabled={busy} className="gap-1.5"><Reply className="size-3.5" /> Write reply</Button>
                  {detail.drafts.some((d) => d.status === "sent") && <span className="ml-auto text-[11px] text-emerald-600 dark:text-emerald-400">Replied ✓</span>}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// Full-pane "New message" / edit-compose-draft composer with attachments,
// rich-text formatting, and save-to-draft.
function ComposePane({
  mailboxes, init, onClose, onChanged, setDraftId,
}: {
  mailboxes: MailboxLite[];
  init: ComposeInit;
  onClose: () => void;
  onChanged: () => void;
  setDraftId: (id: string) => void;
}) {
  const [boxId, setBoxId] = useState(init.boxId);
  const [to, setTo] = useState(init.to);
  const [cc, setCc] = useState(init.cc);
  const [showCc, setShowCc] = useState(!!init.cc);
  const [subject, setSubject] = useState(init.subject);
  const [html, setHtml] = useState(init.html);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>(init.attachments);
  const [draftId, setLocalDraftId] = useState<string | null>(init.draftId);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const box = mailboxes.find((m) => m.id === boxId);

  const attachPayload = (): ComposeAttachmentInput[] => attachments.map((a) => ({ name: a.name, type: a.type, size: a.size, data: a.data }));

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: ComposeAttachment[] = [];
    for (const f of Array.from(files)) {
      try {
        const data = await readAsBase64(f);
        next.push({ id: crypto.randomUUID(), name: f.name, type: f.type || "application/octet-stream", size: f.size, data });
      } catch { toast.error(`Couldn't read ${f.name}`); }
    }
    setAttachments((cur) => [...cur, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  }
  function removeAttachment(id: string) { setAttachments((cur) => cur.filter((a) => a.id !== id)); }

  function doSave() {
    start(async () => {
      const r = await saveComposeDraft({ draftId: draftId ?? undefined, mailboxId: boxId, to, cc, subject, body: htmlToText(html), html, attachments: attachPayload() });
      if (!r.ok) { toast.error(r.message ?? "Couldn't save draft"); return; }
      if (r.draftId) { setLocalDraftId(r.draftId); setDraftId(r.draftId); }
      toast.success("Draft saved");
      onChanged();
    });
  }
  function doSend() {
    start(async () => {
      const r = await composeSend({ mailboxId: boxId, to, cc, subject, body: htmlToText(html), html, attachments: attachPayload(), draftId: draftId ?? undefined });
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      onChanged();
      onClose();
    });
  }
  function doDiscard() {
    if (draftId) start(async () => { await deleteComposeDraft(draftId); onChanged(); onClose(); });
    else onClose();
  }

  const totalBytes = attachments.reduce((n, a) => n + a.size, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold"><PenSquare className="size-4 text-primary" /> {draftId ? "Edit draft" : "New message"}</span>
        <Button variant="ghost" size="icon-sm" title="Close" onClick={onClose}><X className="size-4" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>From</Label>
            <Select value={boxId} onValueChange={(v) => v && setBoxId(v)}>
              <SelectTrigger size="sm" className="w-full"><SelectValue>{(v) => mailboxes.find((m) => m.id === (v as string))?.address ?? ""}</SelectValue></SelectTrigger>
              <SelectContent>{mailboxes.map((m) => <SelectItem key={m.id} value={m.id}>{m.displayName} · {m.address}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cmp-to">To</Label>
              {!showCc && <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowCc(true)}>Add Cc</button>}
            </div>
            <Input id="cmp-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
          </div>
          {showCc && (
            <div className="grid gap-1.5"><Label htmlFor="cmp-cc">Cc</Label><Input id="cmp-cc" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com" /></div>
          )}
          <div className="grid gap-1.5"><Label htmlFor="cmp-subj">Subject</Label><Input id="cmp-subj" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="grid gap-1.5">
            <Label>Message</Label>
            <RichEditor initialHtml={init.html} onChange={(h) => setHtml(h)} placeholder="Write your message…" />
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1.5 rounded border bg-muted/40 px-2 py-1 text-[11px]">
                  <FileIcon className="size-3 text-muted-foreground" />
                  <span className="max-w-48 truncate">{a.name}</span>
                  <span className="text-muted-foreground">{fmtBytes(a.size)}</span>
                  <button type="button" onClick={() => removeAttachment(a.id)} className="text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
                </span>
              ))}
              <span className="self-center text-[10px] text-muted-foreground">{fmtBytes(totalBytes)} total</span>
            </div>
          )}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => onPickFiles(e.target.files)} />
          <p className="text-[11px] text-muted-foreground">Your mailbox signature ({box?.displayName}) is appended automatically. Clicking Send is your approval.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t bg-muted/10 px-5 py-3">
        <Button onClick={doSend} disabled={busy} className="gap-1.5"><Send className="size-3.5" /> Send</Button>
        <Button variant="outline" onClick={doSave} disabled={busy} className="gap-1.5"><Save className="size-3.5" /> Save draft</Button>
        <Button variant="ghost" size="icon" title="Attach files" onClick={() => fileRef.current?.click()} disabled={busy}><Paperclip className="size-4" /></Button>
        <Button variant="ghost" className="ml-auto gap-1.5 text-destructive" onClick={doDiscard} disabled={busy}><Trash2 className="size-3.5" /> {draftId ? "Delete draft" : "Discard"}</Button>
      </div>
    </div>
  );
}
