"use server";

import { requireOperator } from "@/lib/auth";
import { auditCsv, type AuditFilters } from "@/lib/audit-query";

export async function exportAuditCsv(filters: AuditFilters): Promise<{ ok: boolean; csv?: string; message?: string }> {
  // Same bar as viewing the Audit Log page (manager+). The page guard does not
  // protect this action — server actions are independently callable — so the
  // role check must live here too, beside the data.
  const user = await requireOperator();
  if (!user) return { ok: false, message: "You don't have permission to export the audit log." };
  const csv = await auditCsv(filters);
  return { ok: true, csv };
}
