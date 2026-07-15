import "server-only";
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { auditLog } from "./db/schema";

export type AuditFilters = { actor?: string; module?: string; q?: string; from?: string; to?: string };
export type AuditRow = { id: number; at: string; actor: string; action: string; target: string | null; detail: unknown };

function buildWhere(f: AuditFilters): SQL | undefined {
  const c: SQL[] = [];
  if (f.actor) c.push(eq(auditLog.actorName, f.actor));
  if (f.module) c.push(ilike(auditLog.action, `${f.module}.%`));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    c.push(sql`(${auditLog.action} ILIKE ${like} OR ${auditLog.target} ILIKE ${like} OR ${auditLog.actorName} ILIKE ${like} OR ${auditLog.detail}::text ILIKE ${like})`);
  }
  if (f.from) c.push(gte(auditLog.createdAt, new Date(`${f.from}T00:00:00Z`)));
  if (f.to) c.push(lte(auditLog.createdAt, new Date(`${f.to}T23:59:59Z`)));
  return c.length ? and(...c) : undefined;
}

export async function queryAudit(f: AuditFilters, page = 1, pageSize = 50): Promise<{ rows: AuditRow[]; total: number; pageSize: number }> {
  const w = buildWhere(f);
  const rows = await db.select().from(auditLog).where(w).orderBy(desc(auditLog.id)).limit(pageSize).offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(auditLog).where(w);
  return {
    rows: rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.actorName, action: r.action, target: r.target, detail: r.detail })),
    total,
    pageSize,
  };
}

export async function auditFacets(): Promise<{ actors: string[]; modules: string[] }> {
  const actorRows = await db.selectDistinct({ a: auditLog.actorName }).from(auditLog).orderBy(auditLog.actorName);
  const modRows = (await db.execute(sql`SELECT DISTINCT split_part(action, '.', 1) AS m FROM audit_log ORDER BY m`)) as unknown as { m: string }[];
  return { actors: actorRows.map((r) => r.a), modules: modRows.map((r) => String(r.m)).filter(Boolean) };
}

function csvCell(v: unknown): string {
  let s = String(v ?? "");
  // CSV/formula injection: spreadsheet apps execute a cell that begins with
  // = + - @ (or a leading tab/CR). Audit values can be attacker-controlled
  // (e.g. the email typed at a failed login is stored as the actor). Prefix any
  // such value with a single quote so it's treated as literal text on open.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function auditCsv(f: AuditFilters): Promise<string> {
  const w = buildWhere(f);
  const rows = await db.select().from(auditLog).where(w).orderBy(desc(auditLog.id)).limit(5000);
  const head = ["time_utc", "actor", "action", "target", "detail"].join(",");
  const lines = rows.map((r) =>
    [r.createdAt.toISOString(), r.actorName, r.action, r.target ?? "", r.detail ? JSON.stringify(r.detail) : ""].map(csvCell).join(","),
  );
  return [head, ...lines].join("\n");
}
