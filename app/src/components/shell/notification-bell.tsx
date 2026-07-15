"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Info, AlertTriangle, OctagonAlert, ArrowRight, Trash2 } from "lucide-react";
import {
  markAllNotificationsRead,
  markNotificationRead,
  clearAllNotifications,
} from "@/lib/notification-actions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NotificationDetailDialog, type NotifDetail } from "./notification-detail-dialog";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  module: string;
  read: boolean;
  time: string;
};

const ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert } as const;
const TONE = {
  info: "text-sky-500",
  warning: "text-amber-500",
  critical: "text-destructive",
} as const;

export function NotificationBell({
  items,
  unread,
}: {
  items: NotificationItem[];
  unread: number;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<NotifDetail | null>(null);
  const [, start] = useTransition();

  function openDetail(n: NotificationItem) {
    setSelected({ id: n.id, severity: n.severity, title: n.title, body: n.body, module: n.module, read: n.read, when: n.time });
  }

  // Closing the detail marks it read (Close button or the backdrop/Esc).
  function closeDetail() {
    if (selected && !selected.read) start(() => void markNotificationRead(selected.id));
    setSelected(null);
  }

  function clearAll() {
    if (!window.confirm("Clear all notifications?\n\nThis permanently removes every item in the list, read and unread. Active alerts (like a pending security update) will reappear on the next check.")) return;
    start(() => void clearAllNotifications());
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
            <Bell className="size-4" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>
        }
      />
      <SheetContent className="w-full gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b">
          <div className="flex flex-col gap-0.5">
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>{unread > 0 ? `${unread} unread` : "All caught up"}</SheetDescription>
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-8 gap-1.5"
              onClick={() => start(() => void markAllNotificationsRead())}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          )}
        </SheetHeader>

        <div className="flex flex-col overflow-y-auto">
          {items.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            items.map((n) => {
              const Icon = ICON[n.severity];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openDetail(n)}
                  className={cn(
                    "flex items-center gap-2.5 border-b px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                    !n.read && "bg-muted/30",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", TONE[n.severity])} />
                  <span className="redact min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                  {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-sky-500" />}
                  <span className="shrink-0 text-[11px] text-muted-foreground/70">{n.time}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t">
          {items.length > 0 ? (
            <button
              type="button"
              onClick={clearAll}
              className="flex items-center gap-1.5 p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Clear list
            </button>
          ) : (
            <span />
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center gap-1.5 p-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            See all notifications <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </SheetContent>

      <NotificationDetailDialog item={selected} onOpenChange={(o) => !o && closeDetail()} />
    </Sheet>
  );
}
