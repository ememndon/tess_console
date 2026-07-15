import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { type AgentControl, type AgentModule } from "./control-types";

// Kill switch + per-module pause. Global "paused" stops Tess's brain
// (LLM reasoning + autonomous actions). The deterministic crons — monitoring,
// watchdogs, scheduled publishing of pre-generated content, backups, alerts —
// MUST keep running regardless (deterministic independence rule). A per-module
// pause is a deliberate stop of that module's actions (e.g. halt social posting).
export { AGENT_MODULES } from "./control-types";
export type { AgentControl, AgentModule } from "./control-types";

const DEFAULT: AgentControl = { paused: false, modules: {} };

export async function getControl(): Promise<AgentControl> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "agent_control"));
  return { ...DEFAULT, ...((row?.value as AgentControl) ?? {}) };
}

export async function setControl(c: AgentControl): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "agent_control", value: c })
    .onConflictDoUpdate({ target: settings.key, set: { value: c, updatedAt: new Date() } });
}

export async function isTessPaused(): Promise<boolean> {
  return (await getControl()).paused;
}

export async function isModulePaused(m: AgentModule): Promise<boolean> {
  const c = await getControl();
  return c.paused || !!c.modules[m];
}
