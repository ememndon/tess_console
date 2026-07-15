"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import { verifyInstall, type VerifyResult } from "./actions";

// Per-site "Verify installation" control for the Install tab. Pings the live site
// to confirm the tracker is installed and reports whether data is flowing in.
export function InstallVerify({ siteKey }: { siteKey: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<VerifyResult | null>(null);

  function run() {
    start(async () => setRes(await verifyInstall(siteKey)));
  }

  // Tone: green = installed + reachable; amber = reachable but snippet problem; red = unreachable.
  const tone = res ? (res.ok ? "ok" : res.httpStatus != null && res.httpStatus < 400 ? "warn" : "bad") : null;
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;
  const toneClass =
    tone === "ok"
      ? "border-success/40 bg-success/5 text-success"
      : tone === "warn"
        ? "border-warning/40 bg-warning/5 text-warning"
        : "border-destructive/40 bg-destructive/5 text-destructive";

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" onClick={run} disabled={pending} className="self-start">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
        {pending ? "Checking…" : "Verify installation"}
      </Button>

      {res && (
        <div className={`flex items-start gap-2 rounded-lg border p-2.5 text-[13px] leading-relaxed ${toneClass}`}>
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 text-foreground">
            <p>{res.message}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {res.lastEventAt ? (
                <>Last data received {relativeTime(new Date(res.lastEventAt))}.</>
              ) : (
                <>No analytics data received from this site yet.</>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
