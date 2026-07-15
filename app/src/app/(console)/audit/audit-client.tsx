"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, X, ChevronRight, ChevronLeft } from "lucide-react";
import type { AuditRow, AuditFilters } from "@/lib/audit-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { exportAuditCsv } from "./audit-actions";

const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace("T", " ") + " UTC";
const ALL = "__all__";

// Actor names are personas and service accounts (Tess, Emem, Claude Code (builder),
// daily-pipeline …) — showing them is the point of this page, and blurring them in the
// table while the Actor dropdown lists them in full protects nothing. Blur the actor
// only when the name is itself personal data, i.e. an email address. Target/detail stay
// masked regardless (they carry addresses, IPs and message ids).
const isEmailActor = (a: string) => /\S+@\S+\.\S+/.test(a);

export function AuditView({
  rows, total, page, pageSize, facets, filters,
}: {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  facets: { actors: string[]; modules: string[] };
  filters: AuditFilters;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function setParam(patch: Record<string, string | undefined>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page"); // any filter change resets to page 1
    router.push(`/audit?${p.toString()}`);
  }

  const hasFilters = !!(filters.actor || filters.module || filters.q || filters.from || filters.to);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  function goPage(n: number) {
    const p = new URLSearchParams(sp.toString());
    p.set("page", String(n));
    router.push(`/audit?${p.toString()}`);
  }

  function onExport() {
    start(async () => {
      const r = await exportAuditCsv(filters);
      if (!r.ok || !r.csv) { toast.error(r.message ?? "Export failed"); return; }
      const blob = new Blob([r.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border p-3">
        <Field label="Actor">
          <Select value={filters.actor ?? ALL} onValueChange={(v) => setParam({ actor: v && v !== ALL ? v : undefined })}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue>
                {(v) =>
                  v === ALL ? "Anyone" : <span className={cn(isEmailActor(String(v)) && "redact")}>{String(v)}</span>
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              {facets.actors.map((a) => (
                <SelectItem key={a} value={a}>
                  <span className={cn(isEmailActor(a) && "redact")}>{a}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Module">
          <Select value={filters.module ?? ALL} onValueChange={(v) => setParam({ module: v && v !== ALL ? v : undefined })}>
            <SelectTrigger size="sm" className="w-36"><SelectValue>{(v) => (v === ALL ? "All modules" : String(v))}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All modules</SelectItem>
              {facets.modules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" defaultValue={filters.from} onChange={(e) => setParam({ from: e.target.value || undefined })} className="h-8 w-36 text-xs" />
        </Field>
        <Field label="To">
          <Input type="date" defaultValue={filters.to} onChange={(e) => setParam({ to: e.target.value || undefined })} className="h-8 w-36 text-xs" />
        </Field>
        <Field label="Search">
          <Input defaultValue={filters.q} onKeyDown={(e) => { if (e.key === "Enter") setParam({ q: (e.target as HTMLInputElement).value || undefined }); }} placeholder="action, target, detail…" className="h-8 w-52 text-xs" />
        </Field>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => router.push("/audit")}><X className="size-3.5" /> Clear</Button>
        )}
        <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={onExport} disabled={pending}>
          <Download className="size-3.5" /> {pending ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      <p className="px-1 text-xs text-muted-foreground">{total.toLocaleString()} entries{hasFilters ? " (filtered)" : ""}</p>

      {rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">No entries match these filters.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8"></th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="text-muted-foreground">Page {page} of {lastPage}</span>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => goPage(page - 1)}><ChevronLeft className="size-3.5" /></Button>
          <Button variant="outline" size="icon-sm" disabled={page >= lastPage} onClick={() => goPage(page + 1)}><ChevronRight className="size-3.5" /></Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Row({ r }: { r: AuditRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = r.detail != null || r.target;
  return (
    <>
      <tr className={cn("border-b last:border-0", hasDetail && "cursor-pointer hover:bg-muted/20")} onClick={() => hasDetail && setOpen((o) => !o)}>
        <td className="pl-3 text-muted-foreground">{hasDetail && <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />}</td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{fmt(r.at)}</td>
        <td className={cn("px-3 py-2", isEmailActor(r.actor) && "redact")}>{r.actor}</td>
        <td className="px-3 py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.action}</code></td>
        <td className="redact max-w-xs truncate px-3 py-2 font-mono text-xs text-muted-foreground">{r.target ?? "—"}</td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/10 last:border-0">
          <td></td>
          <td colSpan={4} className="px-3 py-2">
            <pre className="redact-strong overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
              {r.detail ? JSON.stringify(r.detail, null, 2) : `target: ${r.target}`}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}
