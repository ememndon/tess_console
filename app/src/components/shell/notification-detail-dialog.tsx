"use client";

import { Info, AlertTriangle, OctagonAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Full-detail modal opened from a (deliberately brief) notification list row.
export type NotifDetail = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  module: string;
  read: boolean;
  when: string;
};

const ICON = { info: Info, warning: AlertTriangle, critical: OctagonAlert } as const;
const TONE = { info: "text-sky-500", warning: "text-amber-500", critical: "text-destructive" } as const;

export function NotificationDetailDialog({
  item,
  onOpenChange,
}: {
  item: NotifDetail | null;
  onOpenChange: (open: boolean) => void;
}) {
  const Icon = item ? ICON[item.severity] : Info;
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Icon className={cn("size-5 shrink-0", item && TONE[item.severity])} />
            <span className="redact">{item?.title}</span>
          </DialogTitle>
          <DialogDescription className="capitalize">
            {item ? `${item.severity} · ${item.module} · ${item.when}` : ""}
          </DialogDescription>
        </DialogHeader>
        {item?.body ? (
          <p className="redact max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {item.body}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No further details for this notification.</p>
        )}
        <DialogFooter>
          {/* Close marks the notification read (handled by the parent's onOpenChange). */}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
