"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Inbox, Trash2, CheckSquare, X } from "lucide-react";
import type { QueuePost } from "@/lib/social-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PostDetailRow } from "./post-detail-client";
import { deletePosts } from "./composer-actions";

type Group = { key: string; label: string; posts: QueuePost[] };

// Statuses that are "finished" — these are the ones that pile up (Tess generates
// ~16/day and done/published posts linger). "Select done" is a one-click way to
// sweep them out without hand-picking each row.
const DONE_STATUSES = new Set(["done", "published", "posted"]);

export function QueueList({ groups }: { groups: Group[] }) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();

  const allIds = useMemo(() => groups.flatMap((g) => g.posts.map((p) => p.id)), [groups]);
  const doneIds = useMemo(
    () => groups.flatMap((g) => g.posts.filter((p) => DONE_STATUSES.has(p.status)).map((p) => p.id)),
    [groups],
  );
  const allSelected = selected.size > 0 && selected.size === allIds.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  }
  function selectDone() {
    setSelected(new Set(doneIds));
  }
  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} post${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    start(async () => {
      const r = await deletePosts(ids);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      exitSelect();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Inbox className="size-4" />
        <CardTitle className="text-sm">Upcoming &amp; recent</CardTitle>
        <div className="ml-auto flex items-center gap-2">
          {selectMode ? (
            <>
              <button onClick={toggleAll} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                {allSelected ? "Clear" : "Select all"}
              </button>
              {doneIds.length > 0 && (
                <button onClick={selectDone} className="text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                  Select done ({doneIds.length})
                </button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || selected.size === 0}
                onClick={removeSelected}
                className="h-7 gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete{selected.size > 0 ? ` (${selected.size})` : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={exitSelect} className="h-7 gap-1">
                <X className="size-3.5" /> Done
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setSelectMode(true)} className="h-7 gap-1.5">
              <CheckSquare className="size-3.5" /> Select
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="py-0 text-sm">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="border-b bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </div>
            <div className="divide-y px-3">
              {g.posts.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      aria-label="Select post"
                      className="size-4 shrink-0 accent-violet-500"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <PostDetailRow post={p} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
