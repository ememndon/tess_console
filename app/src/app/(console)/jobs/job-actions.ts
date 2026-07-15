"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_RUNNABLE } from "@/lib/jobs-monitor";
import { syncGsc } from "@/lib/gsc-sync";
import { syncAllMailboxes } from "@/lib/mail/sync";
import { runDnsChecks, purgeOldEmail } from "@/lib/dns-check";
import { publishDuePosts } from "@/lib/publish";

const RUNNERS: Record<string, () => Promise<unknown>> = {
  "gsc-sync": () => syncGsc(),
  "inbox-sync": () => syncAllMailboxes(),
  "dns-check": () => runDnsChecks(),
  "email-retention": () => purgeOldEmail(),
  "social-publish": () => publishDuePosts(),
};

export async function runJobNow(name: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireAdmin();
  if (!user) return { ok: false, message: "Not signed in." };
  const fn = RUNNERS[name];
  if (!fn || !APP_RUNNABLE.has(name)) return { ok: false, message: "This job runs via host cron and can't be triggered here." };
  await audit({ actorId: user.id, actorName: user.name, action: "job.run", target: name });
  try {
    await fn();
    revalidatePath("/jobs");
    return { ok: true, message: `Ran ${name}.` };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}

export async function setJobEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }> {
  const user = await requireAdmin();
  if (!user || user.role !== "admin") return { ok: false };
  await db.update(jobs).set({ enabled }).where(eq(jobs.name, name));
  await audit({ actorId: user.id, actorName: user.name, action: enabled ? "job.enable" : "job.disable", target: name });
  revalidatePath("/jobs");
  return { ok: true };
}
