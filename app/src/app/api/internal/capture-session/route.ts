import type { NextRequest } from "next/server";
import crypto from "crypto";
import { asc, eq } from "drizzle-orm";
import { safeKeyEqual } from "@/lib/internal-auth";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { audit } from "@/lib/audit";

// Mints a SHORT-LIVED admin session for the demo recorder so the console
// showcase tour can be filmed behind auth — no login screen (and no password)
// ever appears on camera. The recorder sets the returned token as the session
// cookie via Playwright before navigation.
// Guarded by INTERNAL_SYNC_KEY and reachable only on the compose network.
// The token is returned exactly once and never logged; the session row is
// tagged (ip/userAgent) so it is identifiable and revocable in the DB.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAPTURE_SESSION_MINUTES = 120;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function POST(req: NextRequest) {
  if (!safeKeyEqual(req.headers.get("x-internal-key"))) {
    return new Response("forbidden", { status: 403 });
  }
  // The oldest admin account is the owner — the tour films as him, matching the
  // first-person script. (Tess's agent identity is not a users row, so a plain
  // role filter is safe.)
  const admin = (
    await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "admin")).orderBy(asc(users.createdAt)).limit(1)
  )[0];
  if (!admin) return Response.json({ error: "no admin user" }, { status: 500 });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + CAPTURE_SESSION_MINUTES * 60_000);
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId: admin.id,
    expiresAt,
    ip: "internal",
    userAgent: "tess-capture-recorder",
  });
  await audit({
    actorName: "Tess (recorder)",
    action: "capture.session",
    target: admin.name,
    detail: { expiresAt: expiresAt.toISOString(), ttlMinutes: CAPTURE_SESSION_MINUTES },
  });
  return Response.json({ cookieName: "tess_session", token, expiresAt: expiresAt.toISOString() });
}
