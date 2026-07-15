import { CFG } from "./config.js";
import { claimJob, completeJob, failJob } from "./api.js";
import { renderJob } from "./render.js";

const log = (m: string) => console.log(`${new Date().toISOString()} [worker] ${m}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`render timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

// The Demo Studio worker loop. Polls for one pending job at a time (concurrency 1 so
// browser + encode never starve the web app), renders it, and reports back. It runs
// independently of Tess's pause state — a queued render always completes.
async function main() {
  log(`starting — app=${CFG.appUrl} mediaRoot=${CFG.mediaRoot} poll=${CFG.pollMs}ms`);
  if (!CFG.internalKey) log("WARNING: INTERNAL_SYNC_KEY is empty — claims will be rejected by the app");

  for (;;) {
    let claimed = false;
    try {
      const job = await claimJob();
      if (job) {
        claimed = true;
        log(`claimed job ${job.id} — ${job.site}/${job.recipeId} "${job.feature}" formats=${(job.formats || []).join(",")}`);
        try {
          const { media, caption, durationSec } = await withTimeout(renderJob(job), CFG.jobTimeoutMs);
          await completeJob(job.id, media, durationSec, caption);
          log(`completed job ${job.id} — ${media.length} files, ${durationSec}s`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`FAILED job ${job.id}: ${msg}`);
          await failJob(job.id, msg);
        }
      } else {
        log("waiting for jobs");
      }
    } catch (e) {
      log(`loop error: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Brief pause after a job (let the box settle), longer when idle.
    await sleep(claimed ? 2000 : CFG.pollMs);
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
