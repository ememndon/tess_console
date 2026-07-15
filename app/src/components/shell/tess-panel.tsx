"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { PanelRightClose, PanelRightOpen, Send, Wrench, X, BrainCircuit, Paperclip, History, Plus, Trash2, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TessAvatar } from "@/components/tess-avatar";
import { cn } from "@/lib/utils";
import { useResizable } from "@/lib/use-resizable";
import { usePersistedState } from "@/lib/use-persisted-state";
import { sendToTess, loadThread, newConversation, removeConversation } from "@/lib/agent/chat-actions";
import type { ThreadMsg, Attachment } from "@/lib/agent/thread";
import type { ConversationLite } from "@/lib/agent/conversations";

export type ChatModel = { id: string; label: string; tier: string };

// Stable encode/decode for the persisted panel prefs (see usePersistedState).
const openDecode = (raw: string | null) => raw !== "closed";
const openEncode = (v: boolean) => (v ? "open" : "closed");
const strDecode = (raw: string | null) => raw ?? ""; // "" = Auto (Settings → Models)
const strEncode = (v: string) => v;

const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const relTime = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

export function TessPanel({ models }: { models: ChatModel[] }) {
  const [open, setOpen] = usePersistedState("tess_panel", true, openDecode, openEncode);
  const [messages, setMessages] = useState<ThreadMsg[]>([]);
  const [conversations, setConversations] = useState<ConversationLite[]>([]);
  const [convId, setConvId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = usePersistedState("tess_chat_model", "", strDecode, strEncode); // "" = Auto (Settings → Models)
  const [files, setFiles] = useState<Attachment[]>([]); // uploaded, pending send
  const [uploading, setUploading] = useState(false);
  const [sending, startSend] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true); // is the user parked at the bottom? (controls auto-scroll)
  const fileRef = useRef<HTMLInputElement>(null);

  // Remember whether the user is at (or near) the bottom of the thread. Updated
  // on every scroll so the auto-scroll effect knows not to yank them down when
  // they've scrolled up to read history.
  function onMessagesScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const refresh = useCallback(() => {
    loadThread(convId || undefined).then((d) => {
      setMessages(d.messages);
      setConversations(d.conversations);
      setConvId((cur) => cur || d.conversationId);
      setLoaded(true);
    });
  }, [convId]);

  // Load + poll the active conversation while open.
  useEffect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(() => { if (!sending) refresh(); }, 8000);
    return () => clearInterval(t);
  }, [open, refresh, sending]);

  // Stick to the newest message ONLY when the user is already at the bottom. If
  // they've scrolled up to read, leave them be — the 8s poll must not drag them
  // back down.
  useEffect(() => {
    if (atBottomRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  function toggle() {
    const next = !open;
    if (next) atBottomRef.current = true; // reopening should land on the latest
    setOpen(next); // persists via usePersistedState
  }

  function switchConversation(id: string) {
    setShowHistory(false);
    if (id === convId) return;
    atBottomRef.current = true; // a freshly opened conversation should start at the bottom
    setConvId(id);
    setMessages([]);
    setLoaded(false);
    setFiles([]);
  }

  function startNewChat() {
    startSend(async () => {
      const { id } = await newConversation();
      if (id) switchConversation(id);
    });
  }

  function deleteChat(id: string) {
    startSend(async () => {
      await removeConversation(id);
      if (id === convId) {
        setConvId("");
        setMessages([]);
        setLoaded(false);
      }
      refresh();
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!chosen.length) return;
    setUploading(true);
    for (const file of chosen) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/tess-files", { method: "POST", body: fd });
        const j = await res.json();
        if (res.ok) setFiles((f) => [...f, { id: j.id, name: j.name, mime: j.mime, size: j.size }]);
        else toast.error(j.error || `Couldn't upload ${file.name}`);
      } catch {
        toast.error(`Couldn't upload ${file.name}`);
      }
    }
    setUploading(false);
  }

  function send() {
    const text = input.trim();
    if ((!text && files.length === 0) || sending) return;
    atBottomRef.current = true; // sending should always scroll to show your message + the reply
    setInput("");
    const attachmentIds = files.map((f) => f.id);
    const sentFiles = files;
    setFiles([]);
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", author: "You", content: text, tool: null, channel: "console", at: new Date().toISOString(), attachments: sentFiles }]);
    startSend(async () => {
      const r = await sendToTess(text, { modelId: model || undefined, conversationId: convId || undefined, attachmentIds });
      if (r.conversationId) setConvId(r.conversationId);
      refresh();
    });
  }

  const { width, dragging, onMouseDown } = useResizable({ storageKey: "tess_panel_w", defaultWidth: 320, min: 280, max: 560, side: "right" });

  return (
    <aside
      style={open ? { width } : undefined}
      className={cn("relative hidden shrink-0 flex-col border-l bg-sidebar md:flex dark:bg-transparent", !open && "w-12", !dragging && "transition-[width] duration-200")}
    >
      {open && (
        <div
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-primary/30"
        />
      )}
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle Tess panel">
          {open ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </Button>
        {open && (
          <>
            <TessAvatar className="size-6 shrink-0" />
            <span className="text-sm font-semibold">Tess</span>
            <div className="ml-auto flex items-center gap-0.5">
              <Button variant="ghost" size="icon-sm" title="New chat" onClick={startNewChat}><Plus className="size-4" /></Button>
              <Button variant={showHistory ? "secondary" : "ghost"} size="icon-sm" title="Chat history" onClick={() => setShowHistory((s) => !s)}><History className="size-4" /></Button>
            </div>
          </>
        )}
      </div>

      {open && (
        <>
          {showHistory ? (
            <div className="flex-1 overflow-y-auto p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Your chats</span>
                <button onClick={() => setShowHistory(false)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3" /> Back</button>
              </div>
              {conversations.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">No chats yet.</p>
              ) : (
                conversations.map((c) => (
                  <div key={c.id} className={cn("group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-muted/60", c.id === convId && "bg-muted")}>
                    <button onClick={() => switchConversation(c.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-xs font-medium">{c.title}</div>
                      <div className="text-[10px] text-muted-foreground/70">{relTime(c.updatedAt)} ago</div>
                    </button>
                    <button onClick={() => deleteChat(c.id)} title="Delete chat" className="shrink-0 text-muted-foreground/50 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 space-y-2 overflow-y-auto p-3">
                {!loaded ? (
                  <p className="pt-6 text-center text-xs text-muted-foreground">Loading…</p>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 pt-8 text-center">
                    <TessAvatar className="size-12 opacity-90" />
                    <p className="text-xs text-muted-foreground">Hi, I&rsquo;m Tess. Ask me anything about your sites, traffic, health, whatever needs your attention, or have me draft a post. Attach files and I&rsquo;ll take a look.</p>
                  </div>
                ) : (
                  messages.map((m) => <Bubble key={m.id} m={m} />)
                )}
                {sending && <p className="px-1 text-[11px] text-muted-foreground">Tess is thinking…</p>}
              </div>

              <div className="space-y-1.5 border-t p-2">
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {files.map((f) => (
                      <span key={f.id} className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-[10px]">
                        <FileText className="size-3 shrink-0" />
                        <span className="max-w-28 truncate">{f.name}</span>
                        <button onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} className="text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-muted-foreground">
                  <BrainCircuit className="size-3.5 shrink-0" />
                  <span className="shrink-0">Brain</span>
                  {/* Custom (Base UI) dropdown, not a native <select> — the headless
                      screencast recorder can't paint native option popups, so the
                      model list is now visible on camera (and looks better live). */}
                  <Select
                    value={model === "" ? "__auto__" : model}
                    onValueChange={(v) => setModel(v === "__auto__" || v == null ? "" : v)}
                  >
                    <SelectTrigger
                      size="sm"
                      title="Choose how smart Tess is for this chat"
                      className="h-7 min-w-0 flex-1 text-[11px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Auto (Settings → Models)</SelectItem>
                      {models.length === 0 && (
                        <SelectItem value="__none__" disabled>No model keys yet</SelectItem>
                      )}
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label} · {m.tier}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
                <div className="rounded-xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    rows={4}
                    placeholder={uploading ? "Uploading…" : "Message Tess…"}
                    disabled={sending}
                    className="block max-h-60 min-h-24 w-full resize-none bg-transparent px-3 py-2.5 text-xs leading-relaxed outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div className="flex items-center gap-1.5 px-2 pb-2">
                    <Button size="icon" variant="ghost" className="size-8 shrink-0" title="Attach files" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <Paperclip className="size-4" />
                    </Button>
                    <span className="text-[10px] text-muted-foreground/70">Shift + Enter for a new line</span>
                    <Button size="icon" className="ml-auto size-8 shrink-0" title="Send" onClick={send} disabled={sending || uploading || (!input.trim() && files.length === 0)}><Send className="size-3.5" /></Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}

function Attachments({ atts }: { atts: Attachment[] }) {
  if (!atts.length) return null;
  return (
    <div className="mt-1 flex max-w-[90%] flex-wrap gap-1.5">
      {atts.map((a) =>
        a.mime.startsWith("image/") ? (
          <a key={a.id} href={`/api/tess-files/${a.id}`} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/tess-files/${a.id}`} alt={a.name} className="size-16 rounded-md border object-cover" />
          </a>
        ) : (
          <a key={a.id} href={`/api/tess-files/${a.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] hover:bg-muted/50">
            <FileText className="size-3.5 shrink-0" />
            <span className="max-w-32 truncate">{a.name}</span>
            <span className="text-muted-foreground/70">{fmtSize(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

function Bubble({ m }: { m: ThreadMsg }) {
  if (m.role === "tool") {
    return <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground/60"><Wrench className="size-2.5" /> {m.tool}</div>;
  }
  const mine = m.role === "user";
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {m.content && (
        <div className={cn("max-w-[90%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-relaxed", mine ? "bg-[#00e61b] text-black" : "bg-[#fa9302] text-black")}>
          {m.content}
        </div>
      )}
      <Attachments atts={m.attachments} />
      <span className="mt-0.5 px-1 text-[9px] text-muted-foreground/60">
        {mine ? m.author : "Tess"}{m.channel === "telegram" ? " · telegram" : ""}
      </span>
    </div>
  );
}
