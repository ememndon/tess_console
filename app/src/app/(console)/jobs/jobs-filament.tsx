"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Loader2 } from "lucide-react";
import type { JobView } from "@/lib/jobs-monitor";
import { Switch } from "@/components/ui/switch";
import { runJobNow, setJobEnabled } from "./job-actions";
import { FIL, FilHead, FilStat, FilStream, FilStreamRow, FilDots } from "@/components/filament/ui";

function fmtPast(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtFuture(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 0) return "due";
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}
function dur(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
const statusColor = (s: string | null) => (s === "ok" ? FIL.green : s === "failed" ? FIL.mag : s === "running" ? FIL.amber : "rgba(255,255,255,0.25)");
const runState = (s: string): "ok" | "fail" | "warn" | "idle" => (s === "ok" ? "ok" : s === "failed" ? "fail" : s === "running" ? "warn" : "idle");

export function JobsFilament({ jobs }: { jobs: JobView[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "attention" | "ondemand">("all");
  const [busy, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [toggling, startToggle] = useTransition();
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const failing = jobs.filter((j) => j.lastStatus === "failed").length;
  const live = jobs.filter((j) => j.lastStatus === "running").length;
  const nextDue = jobs.filter((j) => j.nextRun).sort((a, b) => (a.nextRun! < b.nextRun! ? -1 : 1))[0];

  const shown = jobs.filter((j) => (filter === "attention" ? j.lastStatus === "failed" : filter === "ondemand" ? !j.schedule || j.runnable : true));

  function run(name: string) {
    setRunning(name);
    start(async () => {
      const r = await runJobNow(name);
      if (r.ok) toast.success(r.message || "Run started.");
      else toast.error(r.message || "Couldn't start that job.");
      setRunning(null);
      router.refresh();
    });
  }

  function toggle(job: JobView, next: boolean) {
    if (!next && job.guarded && !window.confirm(
      `Pause “${job.name}”?\n\nThis is a safety/infrastructure job. It will NOT run on schedule until you switch it back on.`,
    )) return;
    setTogglingName(job.name);
    startToggle(async () => {
      const r = await setJobEnabled(job.name, next);
      if (r.ok) toast.success(next ? `${job.name} enabled.` : `${job.name} paused.`);
      else toast.error("Couldn’t change that — admins only.");
      setTogglingName(null);
      router.refresh();
    });
  }

  const tabs: [typeof filter, string][] = [["all", "All"], ["attention", `Needs attention${failing ? ` · ${failing}` : ""}`], ["ondemand", "On-demand"]];

  return (
    <div data-section="jobs" className="flex flex-1 flex-col gap-6 p-6 text-[#eef1f4]">
      <FilHead title="Jobs Monitor" sub="Every scheduled task as one live timeline. Failures pull the current." register="STREAM" />

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-t pt-5" style={{ borderColor: FIL.hair }}>
        <FilStat value={jobs.length} label="Jobs" />
        <FilStat value={failing} label="Failing" color={failing ? FIL.mag : FIL.mut} live={failing > 0} />
        <FilStat value={live} label="Running" color={live ? FIL.amber : FIL.mut} />
        <FilStat value={nextDue ? fmtFuture(nextDue.nextRun) : "—"} label="Next due" color={FIL.curhi} />
      </div>

      <div className="flex gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className="rounded-full border px-3 py-1 text-[11.5px] transition-colors"
            style={filter === k ? { borderColor: "rgba(39,240,212,0.35)", background: "rgba(39,240,212,0.1)", color: FIL.curhi } : { borderColor: FIL.line, color: FIL.mut }}>
            {label}
          </button>
        ))}
      </div>

      <FilStream>
        {shown.map((job) => (
          <FilStreamRow
            key={job.name}
            color={statusColor(job.lastStatus)}
            title={
              <div className="flex items-center gap-2.5">
                <span className="truncate text-[13px] font-medium text-white">{job.name}</span>
                {job.schedule && <span className="font-mono text-[10px]" style={{ color: FIL.dim }}>{job.schedule}</span>}
                {!job.enabled && <span className="rounded px-1.5 text-[9px] uppercase tracking-wide" style={{ background: "rgba(255,255,255,0.06)", color: FIL.dim }}>paused</span>}
              </div>
            }
            meta={
              <span>
                last {fmtPast(job.lastRunAt)} · {dur(job.lastDurationMs)}
                {job.successRate != null && <> · {job.successRate}% ok</>}
                {job.nextRun && <> · next {fmtFuture(job.nextRun)}</>}
              </span>
            }
            right={
              <div className="flex items-center gap-3">
                <Switch checked={job.enabled} disabled={toggling && togglingName === job.name} onCheckedChange={(c) => toggle(job, c)} aria-label={`${job.enabled ? "Pause" : "Enable"} ${job.name}`} />
                {job.runs.length > 0 && <FilDots states={job.runs.slice(0, 8).map((r) => runState(r.status))} />}
                {job.runnable && (
                  <button type="button" disabled={busy} onClick={() => run(job.name)} aria-label={`Run ${job.name} now`}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-opacity disabled:opacity-50"
                    style={{ color: "#06231f", background: FIL.curhi }}>
                    {running === job.name ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Run
                  </button>
                )}
              </div>
            }
          />
        ))}
      </FilStream>
    </div>
  );
}
