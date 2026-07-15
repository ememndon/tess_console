import { CFG } from "./config.js";
import type { MediaJob, MediaOut } from "./types.js";

// Internal-API client. The worker never touches the DB; it claims/reports jobs
// through the app's INTERNAL_SYNC_KEY-guarded routes so the app stays the sole writer.
async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${CFG.appUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-key": CFG.internalKey },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function claimJob(): Promise<MediaJob | null> {
  const r = await post("/api/internal/media/claim");
  if (!r.ok) throw new Error(`claim ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { job: MediaJob | null };
  return j.job ?? null;
}

export async function completeJob(jobId: string, media: MediaOut[], durationSec: number, caption?: string): Promise<void> {
  const r = await post("/api/internal/media/complete", { jobId, media, durationSec, caption });
  if (!r.ok) throw new Error(`complete ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// Console showcase tours: mint a short-lived admin session so the recorder can
// film the console behind auth. Returns the cookie the browser context must set.
export async function captureSession(): Promise<{ cookieName: string; token: string }> {
  const r = await post("/api/internal/capture-session");
  if (!r.ok) throw new Error(`capture-session ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as { cookieName: string; token: string };
}

export async function failJob(jobId: string, error: string): Promise<void> {
  try {
    await post("/api/internal/media/fail", { jobId, error: error.slice(0, 900) });
  } catch {
    /* best effort — the job will be visibly stuck in 'running' if even this fails */
  }
}
