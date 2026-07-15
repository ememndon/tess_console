import type { ComponentProps } from "react";
import Link from "next/link";
import { KeyRound, ArrowRight, Wrench } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { TessAvatar } from "@/components/tess-avatar";
import { FIL, FilHead, FilStat, FilPanel, FilBar, FilStream, FilStreamRow } from "@/components/filament/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KillSwitch, TelegramConnect, AutonomyMatrix, ApprovalsList } from "./agent-client";
import { ActivityView } from "./activity-view";

type LogItem = { id: string; role: string; content: string | null; tool?: string | null; at: string | Date; channel?: string | null; author?: string | null };

export function AgentFilament({
  configured, control, budget, usage, tg, activity, instructions, approvals,
}: {
  configured: boolean;
  control: ComponentProps<typeof KillSwitch>;
  budget: { spentUsd: number; capUsd: number; pct: number; degraded: boolean; degradeAtPct: number };
  usage: { provider: string; tokensIn: number; tokensOut: number; costUsd: number }[];
  tg: ComponentProps<typeof TelegramConnect>["state"];
  activity: LogItem[];
  instructions: LogItem[];
  approvals: ComponentProps<typeof ApprovalsList>["approvals"];
}) {
  const budgetTone = budget.pct >= 100 ? FIL.mag : budget.pct >= budget.degradeAtPct ? FIL.amber : FIL.green;
  return (
    <div data-section="agent" className="flex flex-1 flex-col gap-6 p-6 text-[#eef1f4]">
      <FilHead title="Tess · Core" sub="Her command center — kill switch, budget, command channel, autonomy, and live activity. One brain across console and Telegram." register="CORE" />

      <Tabs defaultValue="command" className="gap-6">
        <TabsList>
          <TabsTrigger value="command">Command Center</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="command" className="flex flex-col gap-6">
      {/* Core hero */}
      <div className="flex flex-wrap items-center gap-6 border-t pt-5" style={{ borderColor: FIL.hair }}>
        <span className="relative inline-flex size-16 shrink-0 items-center justify-center">
          <span className="fil-nuc absolute inset-0 rounded-full" style={{ background: configured ? FIL.cur : "#555", opacity: 0.16 }} />
          <span className="absolute inset-[10px] rounded-full" style={{ background: configured ? FIL.cur : "#555", opacity: 0.7 }} />
          <TessAvatar className="relative size-7" />
        </span>
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-white">Tess</span>
            <span className="text-[10px] font-medium tracking-[0.14em]" style={{ color: control.paused ? FIL.amber : configured ? FIL.cur : FIL.dim }}>
              {control.paused ? "PAUSED" : configured ? "OPERATING" : "OFFLINE"}
            </span>
          </div>
          <p className="mt-1 text-[12px]" style={{ color: FIL.mut }}>{configured ? "Connected to a model. Acting within your limits." : "No model key yet — her brain is offline."}</p>
        </div>
        <div className="flex items-end gap-8">
          <FilStat value={approvals.length} label="Approvals" color={approvals.length ? FIL.curhi : FIL.mut} live={approvals.length > 0} />
          <FilStat value={`$${budget.spentUsd.toFixed(2)}`} label={`of $${budget.capUsd.toFixed(0)}`} color={budgetTone} />
        </div>
      </div>

      {!configured && (
        <div className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: "rgba(39,240,212,0.3)", background: "rgba(39,240,212,0.05)" }}>
          <KeyRound className="size-5" style={{ color: FIL.cur }} />
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Connect Tess to a model</p>
            <p className="text-xs" style={{ color: FIL.mut }}>Add a provider key in the Secrets Vault, then choose models per task in Settings → Models.</p>
          </div>
          <Link href="/settings?tab=vault" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium" style={{ color: "#06231f", background: FIL.curhi }}>Add key <ArrowRight className="size-3.5" /></Link>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: FIL.mut }}>Control</h2>
        <KillSwitch {...control} />
      </section>

      <FilPanel label={`Budget · ${budget.degraded ? "degrade mode" : "nominal"}`}>
        <div className="flex flex-col gap-3 p-4">
          <FilBar label={`Paid APIs · cap $${budget.capUsd.toFixed(0)}/mo`} pct={Math.min(100, budget.pct)} value={`$${budget.spentUsd.toFixed(2)} · ${budget.pct}%`} tone={budgetTone} />
          {usage.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: FIL.dim }}>
              {usage.map((u) => (
                <span key={u.provider} className="font-mono">{u.provider}: {(u.tokensIn + u.tokensOut).toLocaleString()} tok{u.costUsd > 0 ? ` · $${u.costUsd.toFixed(2)}` : ""}</span>
              ))}
            </div>
          )}
        </div>
      </FilPanel>

      <section className="flex flex-col gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: FIL.cur }}>In focus · pending approvals</h2>
        <div style={{ borderLeft: `2px solid ${FIL.cur}`, background: "linear-gradient(90deg, rgba(39,240,212,0.06), transparent 85%)" }} className="rounded-r-lg">
          <ApprovalsList approvals={approvals} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: FIL.mut }}>Command channel</h2>
        <TelegramConnect state={tg} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: FIL.mut }}>Autonomy matrix</h2>
        <AutonomyMatrix />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <FilPanel label="Activity feed">
          <div className="px-4 py-2">
            {activity.length === 0 ? (
              <p className="py-3 text-xs" style={{ color: FIL.mut }}>Nothing yet. Ask Tess something from the chat panel.</p>
            ) : (
              <FilStream>
                {activity.map((m) => (
                  <FilStreamRow
                    key={m.id}
                    color={m.role === "tool" ? "rgba(255,255,255,0.35)" : FIL.cur}
                    title={
                      m.role === "tool"
                        ? <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: FIL.mut }}><Wrench className="size-3.5" /> used <span className="font-medium text-white">{m.tool}</span></span>
                        : <span className="line-clamp-2 whitespace-pre-wrap break-words text-[12px] text-white">{m.content}</span>
                    }
                    right={<span className="font-mono text-[10px]" style={{ color: FIL.dim }}>{relativeTime(new Date(m.at))}</span>}
                  />
                ))}
              </FilStream>
            )}
          </div>
        </FilPanel>

        <FilPanel label="Instruction history">
          <div className="px-4 py-2">
            {instructions.length === 0 ? (
              <p className="py-3 text-xs" style={{ color: FIL.mut }}>No instructions yet.</p>
            ) : (
              <FilStream>
                {instructions.map((m) => (
                  <FilStreamRow
                    key={m.id}
                    color={FIL.blue}
                    title={<span className="line-clamp-2 whitespace-pre-wrap break-words text-[12px] text-white">{m.content}</span>}
                    meta={`${m.author ?? "You"}${m.channel === "telegram" ? " · telegram" : ""}`}
                    right={<span className="font-mono text-[10px]" style={{ color: FIL.dim }}>{relativeTime(new Date(m.at))}</span>}
                  />
                ))}
              </FilStream>
            )}
          </div>
        </FilPanel>
      </div>
        </TabsContent>

        <TabsContent value="activity">
          <ActivityView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
