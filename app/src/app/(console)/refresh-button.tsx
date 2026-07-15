"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Small manual refresh. The overview is force-dynamic, so the server always has
// fresh numbers — but Next's client router cache can keep showing a stale RSC
// payload after navigating back to the page. router.refresh() re-pulls from the
// server and busts that cache, updating every widget on the route.
export function RefreshButton({ className, label = "Refresh data" }: { className?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
        className,
      )}
    >
      <RotateCw className={cn("size-3.5", pending && "animate-spin")} />
    </button>
  );
}
