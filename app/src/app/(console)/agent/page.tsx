import Link from "next/link";
import { KeyRound, DollarSign, ArrowRight, Activity, MessageSquare, ShieldCheck, Wrench, Inbox } from "lucide-react";
import { TessAvatar } from "@/components/tess-avatar";
import { tessConfigured } from "@/lib/agent/claude";
import { getControl } from "@/lib/agent/control";
import { budgetStatus, usageThisMonth } from "@/lib/agent/cost";
import { getAgentLog, getPendingApprovals } from "@/lib/agent/thread";
import { getTelegramState } from "@/lib/agent/telegram-bot";
import { requireSectionView } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KillSwitch, TelegramConnect, AutonomyMatrix, ApprovalsList } from "./agent-client";
import { getDesignMode } from "@/lib/design-mode";
import { AgentFilament } from "./agent-filament";
import { ActivityView } from "./activity-view";

export const metadata = { title: "Tess (Agent)" };
export const dynamic = "force-dynamic";

export default async function AgentPage() {
  await requireSectionView("/agent");
  const [configured, control, budget, usage, tg, log, approvals] = await Promise.all([
    tessConfigured(),
    getControl(),
    budgetStatus(),
    usageThisMonth(),
    getTelegramState(),
    getAgentLog(120),
    getPendingApprovals(),
  ]);

  // Activity feed = what Tess DID: her tool calls and autonomous work. Exclude the
  // interactive chat conversation (console/Telegram replies) — that belongs in the
  // chat panel, not the activity log.
  const activity = log.filter((m) => m.role === "tool" || (m.role === "assistant" && m.channel === "autonomous")).slice(0, 30);
  const instructions = log.filter((m) => m.role === "user").slice(0, 20);

  if ((await getDesignMode()) === "filament") {
    return <AgentFilament configured={configured} control={control} budget={budget} usage={usage} tg={tg} activity={activity} instructions={instructions} approvals={approvals} />;
  }

  return (
    <div data-section="agent" className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-2.5">
        <TessAvatar className="size-9 shrink-0" />
        <h1 className="text-xl font-semibold tracking-tight">Tess (Agent)</h1>
      </div>
      <Tabs defaultValue="command" className="gap-6">
        <TabsList>
          <TabsTrigger value="command">Command Center</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="command" className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Her command center — kill switch, budget, the Telegram command channel, the autonomy matrix, and her live activity.
        The console chat panel and the Telegram bot share one brain.
      </p>

      {!configured && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
          <KeyRound className="size-5 text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Connect Tess to a model</p>
            <p className="text-xs text-muted-foreground">
              Add an <code>anthropic_api_key</code> (sk-ant-api…) in the Secrets Vault — or any other provider key — then choose models per task in Settings → Models. Until then her brain is offline; the kill switch and meters below still work.
            </p>
          </div>
          <Button size="sm" render={<Link href="/settings?tab=vault" />} className="gap-1.5">Add key <ArrowRight className="size-3.5" /></Button>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Control</h2>
        <KillSwitch paused={control.paused} modules={control.modules} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Budget</h2>
        <div className="rounded-xl border border-primary/30 p-4">
          <div className="flex items-end justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className={cn("size-5", budget.degraded ? "text-rose-500" : "text-muted-foreground")} />
              <div>
                <div className="text-xl font-semibold tabular-nums">${budget.spentUsd.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">/ ${budget.capUsd.toFixed(0)} this month</span></div>
                <div className="text-[11px] text-muted-foreground">Paid APIs only. At {budget.degradeAtPct}% Tess trims to essentials; at 100% she falls back to free-tier models or pauses paid work.</div>
              </div>
            </div>
            {budget.degraded && <span className="rounded-full bg-rose-500/15 px-2 py-1 text-xs font-medium text-rose-500">degrade mode</span>}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", budget.pct >= 100 ? "bg-rose-500" : budget.pct >= budget.degradeAtPct ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, budget.pct)}%` }} />
          </div>
          {usage.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              {usage.map((u) => (
                <span key={u.provider}>{u.provider}: {(u.tokensIn + u.tokensOut).toLocaleString()} tok{u.costUsd > 0 ? ` · $${u.costUsd.toFixed(2)}` : ""}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Inbox className="size-4" /> Pending approvals{approvals.length > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{approvals.length}</span>}</h2>
        <ApprovalsList approvals={approvals} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Command channel</h2>
        <TelegramConnect state={tg} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><ShieldCheck className="size-4" /> Autonomy matrix</h2>
        <p className="-mt-1 text-xs text-muted-foreground">What Tess may do on her own, what needs your one-tap approval, and what she will never do.</p>
        <AutonomyMatrix />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Activity className="size-4" /> Activity feed</h2>
          <div className="rounded-xl border border-primary/30">
            {activity.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">Nothing yet. Ask Tess something from the chat panel.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                    {m.role === "tool" ? <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : <TessAvatar className="mt-0.5 size-4 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      {m.role === "tool" ? (
                        <span className="text-muted-foreground">used <span className="font-medium text-foreground">{m.tool}</span></span>
                      ) : (
                        <span className="line-clamp-3 whitespace-pre-wrap break-words">{m.content}</span>
                      )}
                      <div className="mt-0.5 text-[10px] text-muted-foreground/70">{relativeTime(new Date(m.at))}{m.channel === "telegram" ? " · telegram" : ""}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="size-4" /> Instruction history</h2>
          <div className="rounded-xl border border-primary/30">
            {instructions.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No instructions yet.</p>
            ) : (
              <ul className="divide-y">
                {instructions.map((m) => (
                  <li key={m.id} className="px-3 py-2 text-xs">
                    <span className="line-clamp-3 whitespace-pre-wrap break-words">{m.content}</span>
                    <div className="mt-0.5 text-[10px] text-muted-foreground/70">{m.author ?? "You"} · {relativeTime(new Date(m.at))}{m.channel === "telegram" ? " · telegram" : ""}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
        </TabsContent>

        <TabsContent value="activity">
          <ActivityView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
