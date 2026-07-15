import "server-only";

// Face services (Tier 4) in the isolated face-worker:
//  - restore: GFPGAN sharpens the face (eyes/teeth/skin) in a FLUX scene.
//  - detect:  face detection only, used to place the headline on the empty side.
// Both return the detected face boxes so the render can avoid covering the face.
// Everything here is best-effort: disabled/unreachable/slow/errored → null, and
// the caller falls back gracefully (original scene, heuristic placement).

const FACE_URL = process.env.FACE_URL ?? "";
const ENABLED = process.env.FACE_RESTORE === "1";
const INTERNAL_KEY = process.env.INTERNAL_SYNC_KEY ?? "";

// [x1, y1, x2, y2, score] in source-image pixels.
export type FaceBox = [number, number, number, number, number];

export function faceRestoreEnabled(): boolean {
  return ENABLED && !!FACE_URL;
}

async function callFace(endpoint: "restore" | "detect", absPath: string, timeoutMs: number): Promise<FaceBox[] | null> {
  if (!FACE_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = endpoint === "restore" ? { inPath: absPath, outPath: absPath } : { inPath: absPath };
    const r = await fetch(`${FACE_URL}/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": INTERNAL_KEY },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { ok?: boolean; faces?: FaceBox[] } | null;
    if (!j?.ok) return null;
    return Array.isArray(j.faces) ? j.faces : [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Enhance the face(s) in the scene at `absPath` IN PLACE, returning the detected
// face boxes (or null if restoration is disabled/failed).
export async function enhanceFace(absPath: string): Promise<FaceBox[] | null> {
  if (!faceRestoreEnabled()) return null;
  return callFace("restore", absPath, 90_000);
}

// Detect faces without restoring — used for placement when restoration is off but
// the face service is still reachable. Gated only by FACE_URL.
export async function detectFaces(absPath: string): Promise<FaceBox[] | null> {
  return callFace("detect", absPath, 20_000);
}
