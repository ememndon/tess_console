"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Check, CheckCheck } from "lucide-react";
import { markTargetPosted } from "./composer-actions";
import { Button } from "@/components/ui/button";

export function HandoffActions({ targetId, caption }: { targetId: string; caption: string }) {
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      toast.success("Caption copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button variant="outline" size="sm" onClick={copy}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        Copy caption
      </Button>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await markTargetPosted(targetId);
            toast.message("Marked as posted");
          })
        }
      >
        <CheckCheck className="size-3.5" /> Mark posted
      </Button>
    </div>
  );
}
