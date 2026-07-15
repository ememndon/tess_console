"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, invitations } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

const INVITE_DAYS = 7;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// Only the owner (admin) manages the team.
async function requireOwner() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Only the owner can manage the team.");
  return user;
}

type InviteState = { error: string } | { ok: true; link: string; email: string; role: string } | null;
type InviteRole = "admin" | "manager" | "user";
const INVITE_ROLES: readonly string[] = ["admin", "manager", "user"];

export async function inviteMember(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const owner = await requireOwner();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { error: "Enter a valid email address." };
  const role = String(formData.get("role") ?? "manager");
  if (!INVITE_ROLES.includes(role)) return { error: "Pick a valid role." };

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { error: "That email already has an account." };

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 864e5);
  await db
    .insert(invitations)
    .values({ email, role: role as InviteRole, tokenHash: sha256(token), invitedBy: owner.name, expiresAt })
    .onConflictDoUpdate({
      target: invitations.email,
      set: { role: role as InviteRole, tokenHash: sha256(token), invitedBy: owner.name, createdAt: new Date(), expiresAt, acceptedAt: null },
    });

  await audit({ actorId: owner.id, actorName: owner.name, action: "team.invited", target: email, detail: { role } });
  revalidatePath("/settings");
  return { ok: true, link: `/invite/${token}`, email, role };
}

export async function revokeInvitation(id: string) {
  const owner = await requireOwner();
  await db.delete(invitations).where(eq(invitations.id, id));
  await audit({ actorId: owner.id, actorName: owner.name, action: "team.invite_revoked", target: id });
  revalidatePath("/settings");
}

export async function removeMember(id: string) {
  const owner = await requireOwner();
  if (id === owner.id) throw new Error("You cannot remove yourself.");
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target || target.role === "admin") throw new Error("Only managers can be removed.");
  await db.delete(users).where(eq(users.id, id));
  await audit({ actorId: owner.id, actorName: owner.name, action: "team.member_removed", target: target.email });
  revalidatePath("/settings");
}
