"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, ChevronDown, Clock, ServerCog } from "lucide-react";
import type { JobView } from "@/lib/jobs-monitor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { tileGradientClass, tileGlow, type TileColor } from "@/components/stat-tile";
import { cn } from "@/lib/utils";
import { runJobNow, setJobEnabled } from "./job-actions";

const fmtTime = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—");
const fmtDur = (ms: number | null) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function relFuture(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due";
  const m = Math.round(diff / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `in ${h}h ${m % 60}m` : `in ${Math.floor(h / 24)}d`;
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "ok") return <Badge variant="secondary" className="gap-1.5"><span className="size-1.5 rounded-full bg-emerald-500" />ok</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  if (status === "running") return <Badge variant="outline" className="gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-amber-500" />running</Badge>;
  return <Badge variant="outline">never ran</Badge>;
}

export function JobsClient({ jobs }: { jobs: JobView[] }) {
  const [filter, setFilter] = useState<"all" | "attention" | "ondemand">("all");
  const router = useRouter();

  const failing = jobs.filter((j) => j.lastStatus === "failed").length;
  const nextDue = jobs.filter((j) => j.nextRun).sort((a, b) => (a.nextRun! < b.nextRun! ? -1 : 1))[0];

  const shown = jobs.filter((j) =>
    filter === "attention" ? j.lastStatus === "failed" : filter === "ondemand" ? j.runnable : true,
  );

  return (
    <div data-section="jobs" className="flex flex-1 flex-col gap-5 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Jobs Monitor</h1>
        <p className="text-sm text-muted-foreground">
          Every scheduled task on the box, with history, next run, and on-demand triggers. Cron jobs report here on
          their own — no agent in the loop.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Jobs" value={jobs.length} color="violet" />
        <Tile label="Failing" value={failing} tone={failing > 0 ? "bad" : "ok"} />
        <Tile label="Next due" value={nextDue ? relFuture(nextDue.nextRun) : "—"} sub={nextDue?.name} color="cyan" />
      </div>

      <div className="flex gap-1">
        {([["all", "All"], ["attention", `Needs attention${failing ? ` (${failing})` : ""}`], ["ondemand", "On-demand"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", filter === k ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((job) => <JobCard key={job.name} job={job} onRan={() => router.refresh()} />)}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone, color = "violet" }: { label: string; value: React.ReactNode; sub?: string; tone?: "ok" | "bad"; color?: TileColor }) {
  const grad = tone === "bad" ? "from-rose-500 to-red-700" : tone === "ok" ? "from-emerald-400 to-green-600" : tileGradientClass(color);
  const glow = tone === "bad" ? "#f43f5e" : tone === "ok" ? "#10c98a" : tileGlow(color);
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${grad} p-3.5 text-white`} style={{ boxShadow: `0 10px 30px -10px ${glow}` }}>
      <div aria-hidden className="pointer-events-none absolute -right-5 -top-7 size-20 rounded-full bg-white/15" />
      <div className="relative text-xl font-bold tabular-nums">{value}</div>
      <div className="relative text-[11px] font-medium text-white/85">{label}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}

function JobCard({ job, onRan }: { job: JobView; onRan: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [toggling, startToggle] = useTransition();

  function run() {
    start(async () => {
      const r = await runJobNow(job.name);
      r.ok ? toast.success(r.message) : toast.error(r.message);
      if (r.ok) onRan();
    });
  }

  function toggle(next: boolean) {
    if (!next && job.guarded && !window.confirm(
      `Pause “${job.name}”?\n\nThis is a safety/infrastructure job. It will NOT run on schedule until you switch it back on.`,
    )) return;
    startToggle(async () => {
      const r = await setJobEnabled(job.name, next);
      if (r.ok) { toast.success(next ? `${job.name} enabled.` : `${job.name} paused.`); onRan(); }
      else toast.error("Couldn’t change that — admins only.");
    });
  }

  return (
    <div className={cn("flex flex-col rounded-xl border", !job.enabled && "opacity-70")}>
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{job.name}</span>
          <code className="text-xs text-muted-foreground">{job.schedule}</code>
          {!job.enabled && <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">paused</Badge>}
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Switch checked={job.enabled} disabled={toggling} onCheckedChange={(c) => toggle(c)} aria-label={`${job.enabled ? "Pause" : "Enable"} ${job.name}`} />
            <StatusBadge status={job.lastStatus} />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{job.description}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span>last {fmtTime(job.lastRunAt)}</span>
          <span>{fmtDur(job.lastDurationMs)}</span>
          {job.successRate != null && <span>{job.successRate}% ok</span>}
          <span className="inline-flex items-center gap-1"><Clock className="size-3" /> next {relFuture(job.nextRun)}</span>
        </div>
        {job.lastOutput && <code className="truncate rounded bg-muted px-2 py-1 text-xs">{job.lastOutput}</code>}
        <div className="flex items-center gap-2 pt-0.5">
          {job.runnable ? (
            <Button size="xs" variant="outline" className="gap-1.5" onClick={run} disabled={pending}>
              <Play className="size-3" /> {pending ? "Running…" : "Run now"}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><ServerCog className="size-3" /> host cron</span>
          )}
          {job.runs.length > 0 && (
            <button onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              History <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t">
          {job.runs.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-b px-4 py-1.5 text-[11px] last:border-0">
              <span className={cn("size-1.5 shrink-0 rounded-full", r.status === "ok" ? "bg-emerald-500" : r.status === "failed" ? "bg-rose-500" : "bg-amber-500")} />
              <span className="font-mono text-muted-foreground">{fmtTime(r.startedAt)}</span>
              <span className="truncate text-muted-foreground">{r.output ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
