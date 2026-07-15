"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryListings } from "@/lib/db/schema";
import { requireOperator } from "@/lib/auth";
import { audit } from "@/lib/audit";

type DirStatus = "todo" | "submitted" | "listed" | "rejected" | "na";

export async function setDirectoryStatus(id: string, status: DirStatus, link?: string) {
  const user = await requireOperator();
  if (!user) return;
  await db
    .update(directoryListings)
    .set({ status, link: link?.trim() || null, updatedAt: new Date(), updatedBy: user.name })
    .where(eq(directoryListings.id, id));
  await audit({ actorId: user.id, actorName: user.name, action: "directory.status", target: id, detail: { status } });
  revalidatePath("/seo");
}
