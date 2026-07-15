"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Download, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { AuditRow, AuditFilters } from "@/lib/audit-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportAuditCsv } from "./audit-actions";
import { FIL, FilHead } from "@/components/filament/ui";

const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace("T", " ") + " UTC";
const ALL = "__all__";

// See audit-client.tsx: blur the actor only when the name is itself personal data.
const isEmailActor = (a: string) => /\S+@\S+\.\S+/.test(a);

export function AuditFilament({
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
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("page");
    router.push(`/audit?${p.toString()}`);
  }
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
      a.href = url; a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Exported");
    });
  }

  const hasFilters = !!(filters.actor || filters.module || filters.q || filters.from || filters.to);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div data-section="audit" className="flex flex-1 flex-col gap-5 p-6 text-[#eef1f4]">
      <FilHead title="Audit Log" sub="Every action by every user, human or Tess — one append-only river." register="STREAM" />

      <div className="flex flex-wrap items-end gap-2 rounded-xl border p-3" style={{ borderColor: FIL.line, background: FIL.panel }}>
        <Field label="Actor">
          <Select value={filters.actor ?? ALL} onValueChange={(v) => setParam({ actor: v && v !== ALL ? v : undefined })}>
            <SelectTrigger size="sm" className="w-40"><SelectValue>{(v) => (v === ALL ? "Anyone" : <span className={isEmailActor(String(v)) ? "redact" : undefined}>{String(v)}</span>)}</SelectValue></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              {facets.actors.map((a) => (
                <SelectItem key={a} value={a}>
                  <span className={isEmailActor(a) ? "redact" : undefined}>{a}</span>
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
        <Field label="From"><Input type="date" defaultValue={filters.from} onChange={(e) => setParam({ from: e.target.value || undefined })} className="h-8 w-36 text-xs" /></Field>
        <Field label="To"><Input type="date" defaultValue={filters.to} onChange={(e) => setParam({ to: e.target.value || undefined })} className="h-8 w-36 text-xs" /></Field>
        <Field label="Search"><Input defaultValue={filters.q} onKeyDown={(e) => { if (e.key === "Enter") setParam({ q: (e.target as HTMLInputElement).value || undefined }); }} placeholder="action, target, detail…" className="h-8 w-52 text-xs" /></Field>
        {hasFilters && (
          <button type="button" onClick={() => router.push("/audit")} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px]" style={{ color: FIL.mut }}><X className="size-3.5" /> Clear</button>
        )}
        <button type="button" onClick={onExport} disabled={pending} className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] disabled:opacity-50" style={{ borderColor: FIL.line, color: FIL.tx }}>
          <Download className="size-3.5" /> {pending ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <p className="px-1 text-[11px]" style={{ color: FIL.dim }}>{total.toLocaleString()} entries{hasFilters ? " (filtered)" : ""}</p>

      {rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-sm" style={{ borderColor: FIL.line, color: FIL.mut }}>No entries match these filters.</div>
      ) : (
        <div className="relative pl-1">
          <span className="absolute left-[5px] top-3 bottom-3 w-[1.5px]" style={{ background: "linear-gradient(180deg, rgba(39,240,212,0.4), rgba(255,255,255,0.05))" }} />
          {rows.map((r) => <RowFil key={r.id} r={r} />)}
        </div>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs" style={{ color: FIL.mut }}>
          <span>Page {page} of {lastPage}</span>
          <button type="button" disabled={page <= 1} onClick={() => goPage(page - 1)} aria-label="Previous page" className="rounded-md border p-1.5 disabled:opacity-40" style={{ borderColor: FIL.line }}><ChevronLeft className="size-3.5" /></button>
          <button type="button" disabled={page >= lastPage} onClick={() => goPage(page + 1)} aria-label="Next page" className="rounded-md border p-1.5 disabled:opacity-40" style={{ borderColor: FIL.line }}><ChevronRight className="size-3.5" /></button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: FIL.dim }}>{label}</span>
      {children}
    </div>
  );
}

function RowFil({ r }: { r: AuditRow }) {
  const [open, setOpen] = useState(false);
  const hasDetail = r.detail != null || !!r.target;
  const tess = r.actor === "Tess";
  const color = tess ? FIL.cur : "rgba(255,255,255,0.35)";
  return (
    <div className="relative pl-5">
      <span className="absolute left-0 top-[14px] size-2.5 rounded-full" style={{ background: color, boxShadow: tess ? `0 0 8px ${color}` : undefined }} />
      <button type="button" onClick={() => hasDetail && setOpen((o) => !o)} className="flex w-full items-center gap-2.5 border-b py-3 text-left" style={{ borderColor: FIL.hair, cursor: hasDetail ? "pointer" : "default" }}>
        <span className={`text-[12.5px] font-medium text-white${isEmailActor(r.actor) ? " redact" : ""}`}>{r.actor}</span>
        <code className="rounded px-1.5 py-0.5 font-mono text-[10.5px]" style={{ background: "rgba(255,255,255,0.05)", color: tess ? FIL.curhi : FIL.mut }}>{r.action}</code>
        {r.target && <span className="redact truncate font-mono text-[11px]" style={{ color: FIL.dim }}>{r.target}</span>}
        <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: FIL.dim }}>{fmt(r.at)}</span>
      </button>
      {open && (
        <pre className="redact-strong mb-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md p-2 font-mono text-[11px]" style={{ background: "rgba(255,255,255,0.04)", color: FIL.mut }}>
          {r.detail ? JSON.stringify(r.detail, null, 2) : `target: ${r.target}`}
        </pre>
      )}
    </div>
  );
}
