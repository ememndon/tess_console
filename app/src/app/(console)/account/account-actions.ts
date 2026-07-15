"use server";

import { revalidatePath } from "next/cache";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Update the signed-in admin's own profile (display name + login email).
export async function updateProfile(input: { name: string; email: string }): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Not signed in." };
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { ok: false, message: "Enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };

  // Email is the login identifier — keep it unique across accounts.
  const [clash] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, user.id))).limit(1);
  if (clash) return { ok: false, message: "Another account already uses that email." };

  await db.update(users).set({ name, email }).where(eq(users.id, user.id));
  await audit({ actorId: user.id, actorName: name, action: "account.profile.update", detail: { email } });
  revalidatePath("/account");
  revalidatePath("/", "layout"); // header shows the name/email
  return { ok: true, message: "Profile updated." };
}

// Change the signed-in admin's password (requires the current one).
export async function changePassword(input: { current: string; next: string; confirm: string }): Promise<{ ok: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Not signed in." };

  const ok = await verifyPassword(user.passwordHash, input.current);
  if (!ok) return { ok: false, message: "Your current password is incorrect." };
  if (input.next.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (input.next === input.current) return { ok: false, message: "New password must be different from the current one." };
  if (input.next !== input.confirm) return { ok: false, message: "The two new passwords do not match." };

  await db.update(users).set({ passwordHash: await hashPassword(input.next) }).where(eq(users.id, user.id));
  await audit({ actorId: user.id, actorName: user.name, action: "account.password.change" });
  return { ok: true, message: "Password changed." };
}
