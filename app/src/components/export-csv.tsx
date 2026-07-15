"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// Reusable CSV download. Pass an array of flat row objects; the keys become the
// header row. Client-side only — no server round-trip.
export function ExportCsv({
  rows,
  filename,
  label = "Export CSV",
}: {
  rows: Record<string, string | number>[];
  filename: string;
  label?: string;
}) {
  function go() {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="outline" size="xs" className="gap-1.5" onClick={go} disabled={rows.length === 0}>
      <Download className="size-3.5" /> {label}
    </Button>
  );
}
