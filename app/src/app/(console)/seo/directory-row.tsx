"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { setDirectoryStatus } from "./actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Directory } from "@/lib/seo";

const STATUSES = [
  { value: "todo", label: "To do" },
  { value: "submitted", label: "Submitted" },
  { value: "listed", label: "Listed" },
  { value: "rejected", label: "Rejected" },
  { value: "na", label: "N/A" },
] as const;

const tone: Record<Directory["status"], string> = {
  todo: "text-muted-foreground",
  submitted: "text-amber-600 dark:text-amber-400",
  listed: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-rose-600 dark:text-rose-400",
  na: "text-muted-foreground",
};

export function DirectoryRow({ dir }: { dir: Directory }) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<Directory["status"]>(dir.status);

  function change(next: Directory["status"]) {
    setStatus(next);
    start(async () => {
      await setDirectoryStatus(dir.id, next, dir.link ?? undefined);
      toast.message(`${dir.name}: ${next}`);
    });
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <a
          href={dir.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
        >
          {dir.name}
          <ExternalLink className="size-3 text-muted-foreground" />
        </a>
        <p className="text-[11px] text-muted-foreground">{dir.category}</p>
      </div>
      <Select value={status} onValueChange={(v) => change(v as Directory["status"])} disabled={pending}>
        <SelectTrigger size="sm" className={`w-28 ${tone[status]}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
