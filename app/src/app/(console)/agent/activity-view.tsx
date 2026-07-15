import { Activity, Coins, Hash, Bot } from "lucide-react";
import { getTessActivity, getUsage } from "@/lib/activity";
import { relativeTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/stat-tile";

// Tess's autonomous-action feed + AI cost/usage. Rendered inside the Tess (Agent)
// page's "Activity" tab (no standalone route — it lives under the admin-gated /agent).
// Friendly labels for the audited action codes.
const ACTION_LABEL: Record<string, string> = {
  "social.daily_gen": "Generated a daily post",
  "social.manual_create": "Built a post",
  "social.compose": "Composed a post",
  "social.prepare_now": "Prepared a post to publish",
  "social.batch": "Batch-generated posts",
  "social.post_update": "Updated a post",
  "inbox.move": "Filed an email",
  "inbox.flag": "Flagged an email",
  "vps.enqueue": "Queued a server action",
  "agent.recommend": "Made a recommendation",
  "approval.approve": "Approved an action",
  "approval.reject": "Rejected an action",
  "demo.enqueue": "Queued a demo video",
  "demo.complete": "Finished a demo video",
  "jobs.run": "Ran a job",
  "job.run": "Ran a job",
};
const pretty = (action: string) => ACTION_LABEL[action] ?? action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

export async function ActivityView() {
  const [activity, usage] = await Promise.all([getTessActivity(60), getUsage(14)]);
  const maxDay = Math.max(1, ...usage.byDay.map((d) => d.tokens));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">What Tess has been doing on her own, and what her thinking costs — last 14 days.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile icon={Coins} label="AI cost (14d)" value={`$${usage.totalCost.toFixed(2)}`} color="emerald" />
        <StatTile icon={Hash} label="Tokens (14d)" value={fmtTokens(usage.totalTokens)} color="violet" />
        <StatTile icon={Bot} label="Actions logged" value={activity.length} color="cyan" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Usage */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Coins className="size-4" />
            <CardTitle className="text-sm">AI usage &amp; cost</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-end gap-1.5" style={{ height: 96 }}>
              {usage.byDay.length === 0 ? (
                <p className="text-xs text-muted-foreground">No usage yet.</p>
              ) : (
                usage.byDay.map((d) => (
                  <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${fmtTokens(d.tokens)} tokens · $${d.costUsd.toFixed(3)}`}>
                    <div className="w-full rounded-t bg-gradient-to-t from-violet-600 to-violet-400" style={{ height: `${Math.max(2, Math.round((d.tokens / maxDay) * 84))}px` }} />
                    <span className="text-[8px] text-muted-foreground">{d.day.slice(5)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="divide-y rounded-md border text-xs">
              {usage.byProvider.length === 0 ? (
                <p className="px-3 py-2 text-muted-foreground">No model calls in the period.</p>
              ) : (
                usage.byProvider.map((p) => (
                  <div key={p.provider} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="font-medium">{p.provider}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground">{fmtTokens(p.tokens)} tok</span>
                    <span className="w-16 text-right tabular-nums">{p.costUsd > 0 ? `$${p.costUsd.toFixed(3)}` : "free"}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Activity feed */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Activity className="size-4" />
            <CardTitle className="text-sm">Recent autonomous actions</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            {activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ul className="divide-y">
                {activity.map((a, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-sm">
                    <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
                    <span className="font-medium">{pretty(a.action)}</span>
                    {a.target && <code className="truncate text-[11px] text-muted-foreground">{a.target.length > 28 ? `${a.target.slice(0, 28)}…` : a.target}</code>}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(new Date(a.at))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
