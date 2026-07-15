"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pause, Play, Send, KeyRound, RefreshCw, Trash2, Link2, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENT_MODULES, type AgentModule } from "@/lib/agent/control-types";
import { decideApproval } from "@/lib/agent/chat-actions";
import type { ApprovalLite } from "@/lib/agent/thread";
import { setTessPaused, setModulePaused, startTelegramPairing, reRegisterTelegramWebhook, removeTelegramAdmin } from "./control-actions";

export function ApprovalsList({ approvals }: { approvals: ApprovalLite[] }) {
  const [pending, start] = useTransition();
  const [items, setItems] = useState(approvals);
  if (items.length === 0) return <div className="rounded-xl border border-primary/30 p-4 text-xs text-muted-foreground">No pending approvals.</div>;
  function decide(id: string, approve: boolean) {
    start(async () => {
      const r = await decideApproval(id, approve);
      if (r.ok) {
        setItems((xs) => xs.filter((a) => a.id !== id));
        toast.success(approve ? "Approved" : "Rejected");
      } else toast.error("Could not record that decision.");
    });
  }
  return (
    <div className="divide-y rounded-xl border border-primary/30">
      {items.map((a) => (
        <div key={a.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{a.title}</p>
            {a.summary && <p className="mt-0.5 text-xs text-muted-foreground">{a.summary}</p>}
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">{a.kind} · via {a.requestedVia}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" className="gap-1.5" disabled={pending} onClick={() => decide(a.id, true)}><Check className="size-3.5" /> Approve</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={() => decide(a.id, false)}><X className="size-3.5" /> Reject</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export type TelegramStateLite = {
  tokenSet: boolean;
  botUsername: string | null;
  webhookUrl: string | null;
  webhookHealthy: boolean;
  webhookError: string | null;
  admins: { chatId: string; name: string; pairedAt: string }[];
  alertChatId: string | null;
};

const MODULE_LABEL: Record<string, string> = {
  social: "Social posting", email: "Email sending", seo: "SEO actions", outreach: "Outreach", vps: "VPS ops", content: "Content gen",
};

export function KillSwitch({ paused, modules }: { paused: boolean; modules: Partial<Record<AgentModule, boolean>> }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      <div className={cn("flex items-center justify-between gap-4 rounded-xl border bg-gradient-to-r p-4", paused ? "border-primary/40 from-primary/10 via-primary/[0.04] to-transparent" : "border-primary/30 from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent")}>
        <div className="flex items-center gap-3">
          {paused ? <Pause className="size-5 text-primary" /> : <Play className="size-5 text-emerald-500" />}
          <div>
            <p className="text-sm font-medium">{paused ? "Tess is paused" : "Tess is active"}</p>
            <p className="text-xs text-muted-foreground">
              {paused ? "Her brain is stopped. Monitoring, watchdogs, scheduled publishing & backups keep running." : "Reasoning and autonomous actions are running, within the autonomy matrix."}
            </p>
          </div>
        </div>
        <Button variant={paused ? "default" : "outline"} size="sm" className="gap-1.5" disabled={pending} onClick={() => start(async () => { const r = await setTessPaused(!paused); if (r.ok) toast.success(paused ? "Tess resumed" : "Tess paused"); })}>
          {paused ? <><Play className="size-3.5" /> Resume Tess</> : <><Pause className="size-3.5" /> Pause Tess</>}
        </Button>
      </div>

      <div className="rounded-xl border border-primary/30">
        <div className="border-b border-primary/20 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Per-module pause</div>
        <div className="grid gap-px sm:grid-cols-2">
          {AGENT_MODULES.map((m) => (
            <label key={m} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span>{MODULE_LABEL[m] ?? m}</span>
              <Switch checked={!!modules[m]} disabled={pending || paused} onCheckedChange={(v) => start(async () => { await setModulePaused(m, v); toast.success(`${MODULE_LABEL[m]} ${v ? "paused" : "resumed"}`); })} />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TelegramConnect({ state }: { state: TelegramStateLite }) {
  const [pending, start] = useTransition();
  const [code, setCode] = useState<{ code: string; deepLink?: string; botUsername?: string } | null>(null);

  function connect() {
    start(async () => {
      const r = await startTelegramPairing();
      if (!r.ok || !r.code) {
        toast.error(r.message);
        return;
      }
      setCode({ code: r.code, deepLink: r.deepLink, botUsername: r.botUsername });
      toast.success("Pairing code ready — valid 15 minutes.");
    });
  }
  function reRegister() {
    start(async () => {
      const r = await reRegisterTelegramWebhook();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  }
  function unpair(chatId: string) {
    start(async () => { await removeTelegramAdmin(chatId); toast.success("Removed."); });
  }

  return (
    <div className="rounded-xl border border-primary/30">
      <div className="flex items-center gap-2 border-b border-primary/20 px-4 py-2.5">
        <Send className="size-4" />
        <span className="text-sm font-medium">Telegram command channel</span>
        {state.tokenSet && (
          <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium", state.webhookHealthy ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>
            {state.webhookHealthy ? "webhook live" : state.webhookUrl ? "webhook set" : "not connected"}
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        {!state.tokenSet ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <KeyRound className="size-4 text-amber-500" />
            Add the <code className="rounded bg-muted px-1">telegram_bot_token</code> in Settings → Secrets Vault, then come back to connect.
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              One brain, two mouths: pair your Telegram so you can instruct Tess and tap approve/reject from your phone — the same conversation as this console panel.
              {state.botUsername && <> Bot: <span className="font-medium">@{state.botUsername}</span>.</>}
            </p>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" disabled={pending} onClick={connect}><Link2 className="size-3.5" /> Connect a Telegram account</Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={pending} onClick={reRegister}><RefreshCw className="size-3.5" /> Re-register webhook</Button>
            </div>

            {code && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                <p className="font-medium">Pairing code: <span className="redact font-mono text-base tracking-widest">{code.code}</span></p>
                <p className="mt-1 text-muted-foreground">
                  DM <span className="font-medium">@{code.botUsername}</span> the message <code className="redact rounded bg-muted px-1">/start {code.code}</code> within 15 minutes.
                  {code.deepLink && <> Or <a className="text-foreground underline" href={code.deepLink} target="_blank" rel="noreferrer">open the bot</a> and tap Start.</>}
                </p>
              </div>
            )}

            {state.webhookError && <p className="text-[11px] text-amber-600 dark:text-amber-400">Last webhook error: <span className="redact">{state.webhookError}</span></p>}

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Connected accounts</p>
              {state.admins.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet.</p>
              ) : (
                <ul className="space-y-1">
                  {state.admins.map((a) => (
                    <li key={a.chatId} className="flex items-center justify-between gap-2 rounded-md border border-primary/20 px-2.5 py-1.5 text-xs">
                      <span className="redact">{a.name} <span className="text-muted-foreground">· chat {a.chatId}{state.alertChatId === a.chatId ? " · alerts" : ""}</span></span>
                      <Button size="xs" variant="ghost" className="h-6 gap-1 text-muted-foreground" disabled={pending} onClick={() => unpair(a.chatId)}><Trash2 className="size-3" /> Remove</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const MATRIX: { action: string; level: "auto" | "approval" | "forbidden" }[] = [
  { action: "Social posting (X, Telegram)", level: "auto" },
  { action: "Monitoring, GSC/SEO analysis, recommendations, reports", level: "auto" },
  { action: "Routine VPS ops (updates, restarts, backup checks)", level: "auto" },
  { action: "Drafting content & email replies", level: "auto" },
  { action: "LinkedIn posting (until API approval)", level: "approval" },
  { action: "ANY outgoing email (support, outreach)", level: "approval" },
  { action: "Risky VPS ops (deletions, firewall, major upgrades)", level: "approval" },
  { action: "Writing/posting to the three websites", level: "forbidden" },
  { action: "Bulk/cold email, address harvesting", level: "forbidden" },
  { action: "Spending beyond budget caps", level: "forbidden" },
];

const LEVEL_META: Record<string, { label: string; cls: string }> = {
  auto: { label: "Autonomous", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  approval: { label: "Needs approval", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  forbidden: { label: "Forbidden", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
};

export function AutonomyMatrix() {
  return (
    <div className="overflow-hidden rounded-xl border border-primary/30">
      {MATRIX.map((r, i) => (
        <div key={r.action} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm", i > 0 && "border-t")}>
          <span>{r.action}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", LEVEL_META[r.level].cls)}>{LEVEL_META[r.level].label}</span>
        </div>
      ))}
    </div>
  );
}
