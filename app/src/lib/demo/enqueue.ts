import "server-only";
import { db } from "@/lib/db";
import { mediaJobs } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { getRecipe } from "./recipes";
import { buildDemoScenario } from "./scenario";
import { defaultVoiceForSite } from "./voices";
import type { DemoScenario } from "./types";

// Output always lands as a Social Studio DRAFT — never auto-posted (guardrail #1).
export type EnqueueResult = { jobId: string; feature: string; site: string; guard: { ok: boolean; offending: string[] } };

// Low-level: insert a render job (any scenario source) + audit + notify.
export async function insertMediaJob(opts: {
  site: string;
  recipeId: string;
  feature: string;
  url: string;
  scenario: DemoScenario;
  requestedBy: string;
  createdBy?: string;
  actor?: string;
  voice?: string;
  music?: string;
  formats?: string[];
}): Promise<string> {
  const [job] = await db
    .insert(mediaJobs)
    .values({
      site: opts.site,
      recipeId: opts.recipeId,
      feature: opts.feature,
      url: opts.url,
      scenario: opts.scenario,
      formats: opts.formats ?? ["9:16", "16:9"],
      voice: opts.voice ?? defaultVoiceForSite(opts.site),
      music: opts.music ?? "auto",
      status: "pending",
      requestedBy: opts.requestedBy,
      createdBy: opts.createdBy ?? "tess",
    })
    .returning({ id: mediaJobs.id });

  await audit({
    actorName: opts.actor ?? opts.createdBy ?? "Tess",
    action: "demo.enqueue",
    target: opts.recipeId,
    detail: { site: opts.site, jobId: job.id, by: opts.requestedBy },
  });
  // Console-showcase (bare) renders are an internal pipeline — don't notify the owner
  // per section (an 18-section batch would otherwise fire 18 "queued" notifications).
  if (!opts.scenario?.bare) {
    await notify({
      severity: "info",
      title: `🎬 Demo render queued — ${SITE_META[opts.site as SiteKey]?.name ?? opts.site}`,
      body: `"${opts.feature}" is rendering. You'll get the draft videos to review & post when it's done.`,
      module: "demo",
    });
  }
  return job.id;
}

// Recipe-based demo: writes the brand-voice script now and queues the render.
export async function enqueueDemoJob(opts: {
  recipeId: string;
  requestedBy: string;
  createdBy?: string;
  actor?: string;
  voice?: string;
  music?: string;
  notes?: string;
  formats?: string[];
}): Promise<EnqueueResult> {
  const recipe = getRecipe(opts.recipeId);
  if (!recipe) throw new Error(`unknown recipe: ${opts.recipeId}`);

  const { scenario, guard } = await buildDemoScenario(recipe, { notes: opts.notes });
  const jobId = await insertMediaJob({
    site: recipe.site,
    recipeId: recipe.id,
    feature: recipe.feature,
    url: recipe.url,
    scenario,
    requestedBy: opts.requestedBy,
    createdBy: opts.createdBy,
    actor: opts.actor,
    voice: opts.voice,
    music: opts.music,
    formats: opts.formats,
  });
  return { jobId, feature: recipe.feature, site: recipe.site, guard };
}
