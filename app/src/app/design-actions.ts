"use server";

import { cookies } from "next/headers";
import type { DesignMode } from "@/lib/design-mode";

// Flip the console between the Pulse (legacy) and Filament (new) design systems.
// Pure cookie write — the client reloads to re-read it server-side. Reversible
// at any time; defaults back to Pulse if the cookie is ever cleared.
export async function setDesignMode(mode: DesignMode): Promise<void> {
  (await cookies()).set("design", mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
