import "server-only";
import { cookies } from "next/headers";

// Which design system the console renders. "pulse" = the original (legacy) look;
// "filament" = the new design language. Stored in a cookie so it flips instantly
// with no rebuild, and DEFAULTS TO PULSE — nothing changes until the owner opts in.
// The legacy Pulse code path is never touched, so reverting is byte-for-byte exact.
export type DesignMode = "pulse" | "filament";

export async function getDesignMode(): Promise<DesignMode> {
  return (await cookies()).get("design")?.value === "filament" ? "filament" : "pulse";
}
