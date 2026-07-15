"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { secrets } from "@/lib/db/schema";
import { encryptSecret } from "@/lib/vault";
import { getSecretValue, runSecretProbe } from "@/lib/secrets";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SECRET_CATALOG } from "@/lib/secrets-catalog";

type Result = { ok: boolean; message: string };

async function requireActor() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Unauthorized — only an admin can manage secrets.");
  return user;
}

export async function saveSecret(key: string, value: string): Promise<Result> {
  const user = await requireActor();
  const def = SECRET_CATALOG.find((d) => d.key === key);
  if (!def) return { ok: false, message: "Unknown secret." };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: "Value is empty." };

  const valueEnc = encryptSecret(trimmed);
  await db
    .insert(secrets)
    .values({
      key,
      label: def.label,
      category: def.category,
      valueEnc,
      status: "untested",
      updatedBy: user.name,
    })
    .onConflictDoUpdate({
      target: secrets.key,
      set: { valueEnc, status: "untested", lastTestedAt: null, updatedBy: user.name, updatedAt: new Date() },
    });

  await audit({ actorId: user.id, actorName: user.name, action: "vault.secret_saved", target: key });
  revalidatePath("/settings");
  return { ok: true, message: `${def.label} saved — encrypted in the vault.` };
}

export async function clearSecret(key: string): Promise<Result> {
  const user = await requireActor();
  await db.delete(secrets).where(eq(secrets.key, key));
  await audit({ actorId: user.id, actorName: user.name, action: "vault.secret_cleared", target: key });
  revalidatePath("/settings");
  return { ok: true, message: "Secret removed." };
}

export async function testSecret(key: string): Promise<Result> {
  const user = await requireActor();
  const value = await getSecretValue(key);
  if (!value) return { ok: false, message: "Set the secret before testing." };

  const result = await runSecretProbe(key, value);
  await db
    .update(secrets)
    .set({ status: result.ok ? "ok" : "failed", lastTestedAt: new Date() })
    .where(eq(secrets.key, key));

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: "vault.secret_tested",
    target: key,
    detail: { ok: result.ok },
  });
  revalidatePath("/settings");
  return result;
}
