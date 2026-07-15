import { db } from "./db";
import { auditLog } from "./db/schema";

export async function audit(entry: {
  actorId?: string | null;
  actorName: string;
  action: string;
  target?: string;
  detail?: unknown;
}) {
  await db.insert(auditLog).values({
    actorId: entry.actorId ?? null,
    actorName: entry.actorName,
    action: entry.action,
    target: entry.target,
    detail: entry.detail,
  });
}
