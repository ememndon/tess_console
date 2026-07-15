import "server-only";
import { desc } from "drizzle-orm";
import { CronExpressionParser } from "cron-parser";
import { db } from "./db";
import { jobs, jobRuns } from "./db/schema";

// Jobs the app can trigger on demand (they have an in-process runner). The rest
// run as host cron scripts and can't be kicked from inside the container.
export const APP_RUNNABLE = new Set(["gsc-sync", "inbox-sync", "dns-check", "email-retention", "social-publish"]);

// Content/agent jobs that are safe to pause freely from the UI. Everything else
// is treated as safety/infrastructure (backups, security, uptime, notifications,
// …) and the UI asks for confirmation before pausing it, so a critical monitor
// can't be switched off by accident. The on/off itself is enforced on the box by
// scripts/job-gate.sh, which every cron script consults before doing work.
export const UNGUARDED_JOBS = new Set(["agent-tick", "social-publish", "gsc-sync", "competitor-poll", "content-inventory", "daily-report"]);

function nextRun(schedule: string): string | null {
  try {
    return CronExpressionParser.parse(schedule, { tz: "UTC" }).next().toDate().toISOString();
  } catch {
    return null;
  }
}

export type JobRunLite = { id: number; startedAt: string; finishedAt: string | null; status: string; output: string | null };
export type JobView = {
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
  lastStatus: string | null;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastOutput: string | null;
  nextRun: string | null;
  runnable: boolean;
  guarded: boolean; // safety/infra job — UI confirms before pausing
  successRate: number | null; // % ok over recent runs
  runs: JobRunLite[];
};

export async function getJobsView(): Promise<JobView[]> {
  const all = await db.select().from(jobs).orderBy(jobs.name);
  const runs = await db.select().from(jobRuns).orderBy(desc(jobRuns.id)).limit(400);

  const byJob = new Map<string, JobRunLite[]>();
  const stats = new Map<string, { ok: number; total: number }>();
  for (const r of runs) {
    const arr = byJob.get(r.jobName) ?? [];
    if (arr.length < 8) arr.push({ id: r.id, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null, status: r.status, output: r.output });
    byJob.set(r.jobName, arr);
    const s = stats.get(r.jobName) ?? { ok: 0, total: 0 };
    if (r.status !== "running") { s.total++; if (r.status === "ok") s.ok++; }
    stats.set(r.jobName, s);
  }

  return all.map((j) => {
    const s = stats.get(j.name);
    return {
      name: j.name,
      description: j.description,
      schedule: j.schedule,
      enabled: j.enabled,
      lastStatus: j.lastStatus,
      lastRunAt: j.lastRunAt ? j.lastRunAt.toISOString() : null,
      lastDurationMs: j.lastDurationMs,
      lastOutput: j.lastOutput,
      nextRun: j.enabled ? nextRun(j.schedule) : null,
      runnable: APP_RUNNABLE.has(j.name),
      guarded: !UNGUARDED_JOBS.has(j.name),
      successRate: s && s.total > 0 ? Math.round((100 * s.ok) / s.total) : null,
      runs: byJob.get(j.name) ?? [],
    };
  });
}
