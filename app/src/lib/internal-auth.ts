import "server-only";
import { timingSafeEqual } from "crypto";

// Constant-time check of a request-supplied key against INTERNAL_SYNC_KEY.
// Internal cron/worker endpoints used `supplied !== process.env.INTERNAL_SYNC_KEY`,
// a non-constant-time string compare that can leak the secret a character at a
// time via response timing. This compares in constant time and returns false if
// the secret is unset or the values differ (length included, without an early
// return that would leak the length).
export function safeKeyEqual(supplied: string | null | undefined): boolean {
  const secret = process.env.INTERNAL_SYNC_KEY;
  if (!secret || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    timingSafeEqual(b, b); // burn a comparison so timing doesn't reveal the length
    return false;
  }
  return timingSafeEqual(a, b);
}
