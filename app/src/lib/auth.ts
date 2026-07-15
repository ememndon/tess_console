import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users, sessions } from "./db/schema";
import { audit } from "./audit";
import { canViewSection } from "./access";

const COOKIE = "tess_session";
const SESSION_DAYS = 30;
// Long passwords mandatory on all human logins.
export const MIN_PASSWORD_LENGTH = 16;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export const hashPassword = (pw: string) => argonHash(pw);
export const verifyPassword = (hashed: string, pw: string) => argonVerify(hashed, pw);

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const h = await headers();
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent"),
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_DAYS * 86400,
    path: "/",
  });
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row || row.expiresAt < new Date()) return null;
  return row.user;
});

// Role tiers: admin (full) > manager (operational writes) > user (read-only explore).
// Helpers return the user when authorized, else null — callers keep their existing
// `if (!user) return <denied>` guard, so denial reads the same as "not signed in".
export async function requireAdmin() {
  const u = await getCurrentUser();
  return u && u.role === "admin" ? u : null;
}
export async function requireOperator() {
  const u = await getCurrentUser();
  return u && (u.role === "admin" || u.role === "manager") ? u : null;
}

export async function hasAnyUser(): Promise<boolean> {
  const r = await db.execute(sql`select 1 from users limit 1`);
  return r.length > 0;
}

/** Guard for all console pages: first run → /setup, no session → /login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (user) return user;
  redirect((await hasAnyUser()) ? "/login" : "/setup");
}

/**
 * Page-level READ guard. Call at the top of a restricted page (see access.ts):
 * a signed-in user who lacks view access is redirected to the dashboard. This is
 * the secure counterpart to the cosmetic nav hiding — the real enforcement, run
 * close to the data so a "user" can't reach restricted modules by typing the URL.
 */
export async function requireSectionView(href: string) {
  const user = await requireUser();
  if (!canViewSection(user.role, href)) redirect("/");
  return user;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    const user = await getCurrentUser();
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    if (user) await audit({ actorId: user.id, actorName: user.name, action: "auth.logout" });
  }
  store.delete(COOKIE);
}
