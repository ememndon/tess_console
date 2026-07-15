import "server-only";
import { remember } from "./memory";

// Feedback learning loop: capture the owner's reactions — rejected proposals,
// edited drafts — as durable PREFERENCE notes so Tess drafts closer to what the
// owner actually ships over time. These surface in getMemoryBlock alongside her
// own remember() notes, so future turns "see" the lesson. Best-effort: learning
// must never block the action that triggered it.
export async function notePreference(note: string): Promise<void> {
  try {
    await remember({ note: note.slice(0, 500), scope: "preference", createdBy: "feedback" });
  } catch {
    /* swallow — a failed lesson is not worth failing the user's action */
  }
}
