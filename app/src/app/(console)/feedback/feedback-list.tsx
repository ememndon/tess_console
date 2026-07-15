"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ThumbsUp, ThumbsDown, Search, Eye, CheckCheck, RotateCcw, Trash2, X } from "lucide-react";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import type { FeedbackStatus } from "@/lib/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setFeedbackStatus, bulkSetFeedbackStatus, deleteFeedback } from "./actions";

export type FeedbackItem = {
  id: string;
  site: string;
  rating: string | null;
  message: string | null;
  path: string | null;
  country: string | null;
  status: FeedbackStatus;
  at: string;
};

function flag(cc: string | null): string {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
const stamp = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";

// 1–5 emoji scale (new widget) + legacy thumbs. Tone: 1–2 negative, 3 neutral, 4–5 positive.
const SCALE: Record<string, { emoji: string; label: string; tone: string }> = {
  "1": { emoji: "😣", label: "Very poor", tone: "text-rose-600 dark:text-rose-400" },
  "2": { emoji: "🙁", label: "Poor", tone: "text-rose-600 dark:text-rose-400" },
  "3": { emoji: "😐", label: "Okay", tone: "text-amber-600 dark:text-amber-400" },
  "4": { emoji: "🙂", label: "Good", tone: "text-emerald-600 dark:text-emerald-400" },
  "5": { emoji: "😍", label: "Great", tone: "text-emerald-600 dark:text-emerald-400" },
};

function RatingBadge({ rating }: { rating: string | null }) {
  if (rating && SCALE[rating]) {
    const s = SCALE[rating];
    return <Badge variant="secondary" className={cn("gap-1", s.tone)}>{s.emoji} {s.label}</Badge>;
  }
  if (rating === "helpful") return <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400"><ThumbsUp className="size-3" /> Helpful</Badge>;
  if (rating === "not_helpful") return <Badge variant="secondary" className="gap-1 text-rose-600 dark:text-rose-400"><ThumbsDown className="size-3" /> Not helpful</Badge>;
  return <Badge variant="outline">Report</Badge>;
}

export function FeedbackList({ items, scope }: { items: FeedbackItem[]; scope: string }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [, start] = useTransition();

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const t = q.trim().toLowerCase();
    return items.filter((f) => `${f.message ?? ""} ${f.path ?? ""} ${f.site}`.toLowerCase().includes(t));
  }, [items, q]);

  const allSelected = filtered.length > 0 && filtered.every((f) => sel.has(f.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(filtered.map((f) => f.id)));
  const clear = () => setSel(new Set());

  function bulk(fn: () => Promise<void>, msg: string) {
    start(async () => { await fn(); toast.success(msg); clear(); });
  }
  const ids = [...sel];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 accent-foreground" /> Select all
        </label>
        <div className="relative ml-auto w-60">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search message, page…" className="h-8 pl-7 text-xs" />
        </div>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} selected</span>
          <Button size="xs" variant="outline" className="gap-1" onClick={() => bulk(() => bulkSetFeedbackStatus(ids, "seen"), "Marked seen")}><Eye className="size-3" /> Seen</Button>
          <Button size="xs" variant="outline" className="gap-1" onClick={() => bulk(() => bulkSetFeedbackStatus(ids, "actioned"), "Marked actioned")}><CheckCheck className="size-3" /> Actioned</Button>
          <Button size="xs" variant="outline" className="gap-1" onClick={() => bulk(() => bulkSetFeedbackStatus(ids, "new"), "Reopened")}><RotateCcw className="size-3" /> Reopen</Button>
          <Button size="xs" variant="ghost" className="gap-1 text-destructive" onClick={() => { if (confirm(`Delete ${sel.size} item(s)?`)) bulk(() => deleteFeedback(ids), "Deleted"); }}><Trash2 className="size-3" /> Delete</Button>
          <Button size="xs" variant="ghost" className="ml-auto gap-1" onClick={clear}><X className="size-3" /> Clear</Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((f) => (
            <div key={f.id} className={cn("flex items-start gap-3 rounded-xl border p-4", sel.has(f.id) && "ring-1 ring-foreground/20")}>
              <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="mt-1 size-3.5 shrink-0 accent-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RatingBadge rating={f.rating} />
                  {scope === "all" && <span className={cn("text-xs font-medium", SITE_META[f.site as SiteKey]?.text)}>{SITE_META[f.site as SiteKey]?.name ?? f.site}</span>}
                  {f.status !== "new" && <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">{f.status}</Badge>}
                </div>
                {f.message && <p className="mt-1.5 text-sm leading-relaxed">{f.message}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  {f.path && <a href={`https://${SITE_META[f.site as SiteKey]?.domain ?? ""}${f.path}`} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-foreground hover:underline">{f.path}</a>}
                  {f.country && <span>· {flag(f.country)} {f.country}</span>}
                  <span>· {stamp(f.at)}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {f.status === "new" && <Button variant="outline" size="sm" onClick={() => start(() => { setFeedbackStatus(f.id, "seen"); })}><Eye className="size-3.5" /> Seen</Button>}
                {f.status !== "actioned" && <Button variant="outline" size="sm" onClick={() => start(() => { setFeedbackStatus(f.id, "actioned"); })}><CheckCheck className="size-3.5" /> Actioned</Button>}
                {f.status === "actioned" && <Button variant="ghost" size="sm" onClick={() => start(() => { setFeedbackStatus(f.id, "new"); })}><RotateCcw className="size-3.5" /> Reopen</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
