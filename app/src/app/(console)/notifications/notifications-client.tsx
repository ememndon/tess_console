"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Info, AlertTriangle, OctagonAlert, CheckCheck, Trash2, Settings2, Bell } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead, clearReadNotifications } from "@/lib/notification-actions";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/stat-tile";
import { NotificationDetailDialog, type NotifDetail } from "@/components/shell/notification-detail-dialog";
import { cn } from "@/lib/utils";

export type NotifItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  module: string;
  read: boolean;
  at: string;
};

const ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert };
const TONE = { info: "text-sky-500", warning: "text-amber-500", critical: "text-destructive" };

const rel = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export function NotificationCenter({
  items,
  facets,
  filters,
}: {
  items: NotifItem[];
  facets: { modules: string[]; bySeverity: Record<string, number>; unread: number; total: number };
  filters: { severity?: string; module?: string; unreadOnly?: boolean };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const [selected, setSelected] = useState<NotifDetail | null>(null);

  function openDetail(n: NotifItem) {
    setSelected({ id: n.id, severity: n.severity, title: n.title, body: n.body, module: n.module, read: n.read, when: rel(n.at) });
  }

  // Closing the detail marks it read (Close button or the backdrop/Esc).
  function closeDetail() {
    if (selected && !selected.read) start(() => void markNotificationRead(selected.id));
    setSelected(null);
  }

  function setParam(patch: Record<string, string | undefined>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    router.push(`/notifications?${p.toString()}`);
  }

  const SEV: { key: string; label: string }[] = [
    { key: "critical", label: "Critical" }, { key: "warning", label: "Warning" }, { key: "info", label: "Info" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={Bell} label="Unread" value={facets.unread} color="blue" />
        <StatTile icon={OctagonAlert} label="Critical" value={facets.bySeverity.critical ?? 0} color="rose" />
        <StatTile icon={AlertTriangle} label="Warning" value={facets.bySeverity.warning ?? 0} color="amber" />
        <StatTile icon={Info} label="Info" value={facets.bySeverity.info ?? 0} color="cyan" />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <Chip active={!filters.severity} onClick={() => setParam({ severity: undefined })} label={`All (${facets.total})`} />
        {SEV.map((s) => (
          <Chip key={s.key} active={filters.severity === s.key} onClick={() => setParam({ severity: filters.severity === s.key ? undefined : s.key })} label={`${s.label} (${facets.bySeverity[s.key] ?? 0})`} />
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <Chip active={!!filters.unreadOnly} onClick={() => setParam({ unread: filters.unreadOnly ? undefined : "1" })} label="Unread only" />
        {facets.modules.length > 1 && (
          <select
            value={filters.module ?? ""}
            onChange={(e) => setParam({ module: e.target.value || undefined })}
            className="h-7 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">All modules</option>
            {facets.modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/settings?tab=notifications" />} className="gap-1.5"><Settings2 className="size-3.5" /> Routing</Button>
          {facets.unread > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => start(() => { void markAllNotificationsRead(); toast.success("All marked read"); })}><CheckCheck className="size-3.5" /> Mark all read</Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => { if (confirm("Delete all read notifications?")) start(() => { void clearReadNotifications(); toast.success("Cleared read"); }); }}><Trash2 className="size-3.5" /> Clear read</Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-sm text-muted-foreground">Nothing matches these filters.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          {items.map((n) => {
            const Icon = ICON[n.severity];
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openDetail(n)}
                className={cn("flex w-full items-center gap-3 border-b p-3.5 text-left transition-colors last:border-0 hover:bg-muted/50", !n.read && "bg-muted/30")}
              >
                <Icon className={cn("size-4 shrink-0", TONE[n.severity])} />
                <span className="redact min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-sky-500" />}
                <span className="shrink-0 text-[11px] text-muted-foreground/70">{n.module} · {rel(n.at)}</span>
              </button>
            );
          })}
        </div>
      )}

      <NotificationDetailDialog item={selected} onOpenChange={(o) => !o && closeDetail()} />
    </div>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );
}
