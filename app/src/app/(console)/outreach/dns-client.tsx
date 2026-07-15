"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runDnsCheckNow } from "./outreach-actions";

export function RunDnsCheck() {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      disabled={pending}
      onClick={() => start(async () => {
        const r = await runDnsCheckNow();
        r.ok ? toast.success(r.message) : toast.error(r.message);
      })}
    >
      <RefreshCw className={pending ? "size-3.5 animate-spin" : "size-3.5"} /> Run check
    </Button>
  );
}
