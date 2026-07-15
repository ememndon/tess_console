"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, X, ShieldQuestion, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { decideApproval } from "@/lib/agent/chat-actions";

// Mirrors ApprovalLite (server-only module — kept as a local shape so this client
// component doesn't import it).
type Approval = { id: string; kind: string; title: string; summary: string | null; module: string; requestedVia: string; at: string };

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function PendingApprovals({ items }: { items: Approval[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  // Row clicked open in the detail dialog (full, untruncated context).
  const [active, setActive] = useState<Approval | null>(null);

  function decide(id: string, approve: boolean) {
    start(async () => {
      const r = await decideApproval(id, approve);
      if (r.ok) toast.success(approve ? "Approved." : "Rejected.");
      else toast.error("Couldn't apply that decision.");
      setActive(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldQuestion className="size-4 text-amber-500" /> Pending approvals
          {items.length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">{items.length}</span>
          )}
        </h2>
        <Link href="/agent" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
          Tess agent <ArrowUpRight className="size-3" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nothing awaiting your approval. 🎉</p>
      ) : (
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <button
                type="button"
                onClick={() => setActive(a)}
                title="View full details"
                aria-label={`View details for ${a.title}`}
                className="-my-1 min-w-0 flex-1 rounded-md py-1 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.title}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">{a.module}</span>
                </div>
                {a.summary && <p className="truncate text-xs text-muted-foreground">{a.summary}</p>}
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(a.at)}</span>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  className="h-7 gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={busy}
                  onClick={() => decide(a.id, true)}
                >
                  <CheckCircle2 className="size-3.5" /> Approve
                </Button>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-destructive" disabled={busy} onClick={() => decide(a.id, false)}>
                  <X className="size-3.5" /> Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent>
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-start gap-2 pr-6">
                  <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <span>{active.title}</span>
                </DialogTitle>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{active.module}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5">{active.kind}</span>
                  <span>via {active.requestedVia}</span>
                  <span>· {timeAgo(active.at)}</span>
                </div>
              </DialogHeader>
              {active.summary ? (
                <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{active.summary}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">No further details were provided.</p>
              )}
              <DialogFooter>
                <Button variant="ghost" className="gap-1 text-destructive" disabled={busy} onClick={() => decide(active.id, false)}>
                  <X className="size-4" /> Reject
                </Button>
                <Button className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy} onClick={() => decide(active.id, true)}>
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
