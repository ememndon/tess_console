import "server-only";
import { and, asc, desc, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import { users, invitations } from "./db/schema";

export async function listUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

export async function listPendingInvites() {
  return db
    .select()
    .from(invitations)
    .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .orderBy(desc(invitations.createdAt));
}
