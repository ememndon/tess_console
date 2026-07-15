"use server";

import crypto from "crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, invitations, auditLog } from "@/lib/db/schema";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  hasAnyUser,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth";
import { audit } from "@/lib/audit";

type FormState = { error: string } | null;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function acceptInvitation(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const [inv] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, sha256(token)))
    .limit(1);
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date())
    return { error: "This invitation is invalid or has expired. Ask the owner for a new link." };

  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!name) return { error: "Enter your name." };
  if (password.length < MIN_PASSWORD_LENGTH)
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters (long passwords mandatory).` };
  if (password !== confirm) return { error: "The two passwords do not match." };

  // Re-check the email is still free (owner could have created it meanwhile).
  const [clash] = await db.select().from(users).where(eq(users.email, inv.email)).limit(1);
  if (clash) return { error: "An account with this email already exists." };

  const [user] = await db
    .insert(users)
    .values({ name, email: inv.email, passwordHash: await hashPassword(password), role: inv.role })
    .returning();
  await db.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
  await audit({ actorId: user.id, actorName: user.name, action: "team.joined", detail: { email: inv.email, role: inv.role } });
  await createSession(user.id);
  redirect("/");
}

export async function setupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // One-shot: only available while no account exists.
  if (await hasAnyUser()) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!name || !email.includes("@")) return { error: "Enter your name and a valid email address." };
  if (password.length < MIN_PASSWORD_LENGTH)
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters (long passwords mandatory).` };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash: await hashPassword(password) })
    .returning();
  await audit({ actorId: user.id, actorName: user.name, action: "auth.setup", detail: { email } });
  await createSession(user.id);
  redirect("/");
}

// Brute-force throttle: too many recent failures pause further attempts. Backed
// by the audit log so it survives restarts. We throttle both by IP (stops a
// single attacker spraying many accounts, and can't be abused from afar to lock
// out a real user) and by email (defends one account against distributed guessing).
const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_FAILS = 8; // per email
const LOGIN_MAX_FAILS_IP = 20; // per source IP (higher: a shared NAT may host several real users)

// A valid argon2 hash for an account that does not exist. When no (loginable)
// user matches, we still verify the supplied password against this so a failed
// login takes the same time as a real password check — response time can't be
// used to enumerate which emails have accounts.
const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$MVpFv7Gar0ZG4FiSfLroMA$Fq1+cKqjuMAgcXxETDsnblBVmAG/hhLs++ezBpekfP8";

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "unknown";
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60_000);

  // Per-IP throttle first.
  if (ip !== "unknown") {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.login_failed"), sql`${auditLog.detail}->>'ip' = ${ip}`, gte(auditLog.createdAt, since)));
    if (n >= LOGIN_MAX_FAILS_IP) {
      await audit({ actorName: email || "unknown", action: "auth.login_blocked", detail: { ip, reason: "ip" } });
      return { error: `Too many attempts from your network. Please wait ${LOGIN_WINDOW_MIN} minutes and try again.` };
    }
  }

  // Per-email throttle.
  if (email) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.login_failed"), eq(auditLog.actorName, email), gte(auditLog.createdAt, since)));
    if (n >= LOGIN_MAX_FAILS) {
      await audit({ actorName: email, action: "auth.login_blocked", detail: { ip, reason: "email" } });
      return { error: `Too many failed attempts. Please wait ${LOGIN_WINDOW_MIN} minutes and try again.` };
    }
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let valid = false;
  if (user && user.role !== "tess") {
    valid = await verifyPassword(user.passwordHash, password);
  } else {
    // No matching loginable account — equalize timing against a dummy hash.
    try { await verifyPassword(DUMMY_PASSWORD_HASH, password); } catch { /* ignore */ }
  }

  if (!valid || !user) {
    await audit({ actorName: email || "unknown", action: "auth.login_failed", detail: { ip } });
    return { error: "Invalid email or password." };
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit({ actorId: user.id, actorName: user.name, action: "auth.login", detail: { ip } });
  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
