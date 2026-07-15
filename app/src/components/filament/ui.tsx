import type { ReactNode } from "react";

// Filament register primitives — shared by the bespoke pages so the design
// language stays consistent. Presentational only (no hooks) so both server and
// client pages can use them. Filament-only; never rendered in Pulse.

export const FIL = {
  cur: "#27f0d4",
  curhi: "#8bffec",
  mag: "#ff4d6d",
  amber: "#ffc24d",
  green: "#34e08a",
  blue: "#3b82f6",
  tx: "#eef1f4",
  mut: "#9398a3",
  dim: "#6b7079",
  line: "rgba(255,255,255,0.08)",
  hair: "rgba(255,255,255,0.055)",
  panel: "rgba(255,255,255,0.018)",
};

export function FilHead({ title, sub, register }: { title: string; sub?: string; register?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">{title}</h1>
        {sub && <p className="mt-1 text-[12.5px]" style={{ color: FIL.mut }}>{sub}</p>}
      </div>
      {register && (
        <span className="mt-0.5 shrink-0 rounded-full border px-2.5 py-1 text-[9.5px] font-medium uppercase tracking-[0.16em]" style={{ borderColor: "rgba(39,240,212,0.3)", color: FIL.cur }}>
          {register}
        </span>
      )}
    </div>
  );
}

export function FilStat({ value, label, color = FIL.tx, live }: { value: ReactNode; label: string; color?: string; live?: boolean }) {
  return (
    <div className="relative" style={live ? { paddingLeft: 14 } : undefined}>
      {live && <span className="fil-surge absolute left-0 top-1 bottom-3.5 w-[2px]" style={{ background: FIL.cur, boxShadow: `0 0 10px ${FIL.cur}` }} />}
      <div className="font-mono text-[28px] font-medium leading-none tabular-nums" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.13em]" style={{ color: live ? FIL.cur : FIL.dim }}>{label}</div>
    </div>
  );
}

export function FilPanel({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border" style={{ borderColor: FIL.line, background: FIL.panel }}>
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: FIL.hair }}>
        <h2 className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: FIL.mut }}>{label}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function FilBar({ label, pct, value, tone = FIL.cur }: { label: string; pct: number; value?: string; tone?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span style={{ color: FIL.mut }}>{label}</span>
        <span className="font-mono tabular-nums" style={{ color: FIL.tx }}>{value ?? `${Math.round(pct)}%`}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: tone, boxShadow: `0 0 8px ${tone}88` }} />
      </div>
    </div>
  );
}

// A vertical event spine — content branches off it as rows. The Stream register.
export function FilStream({ children }: { children: ReactNode }) {
  return (
    <div className="relative pl-1">
      <span className="absolute left-[5px] top-3 bottom-3 w-[1.5px]" style={{ background: "linear-gradient(180deg, rgba(39,240,212,0.4), rgba(255,255,255,0.05))" }} />
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function FilStreamRow({ color, title, meta, right }: { color: string; title: ReactNode; meta?: ReactNode; right?: ReactNode }) {
  return (
    <div className="relative flex items-start gap-3 border-b py-3 pl-5" style={{ borderColor: FIL.hair }}>
      <span className="absolute left-0 top-[15px] size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{title}</div>
          {right && <div className="shrink-0">{right}</div>}
        </div>
        {meta && <div className="mt-0.5 text-[11px]" style={{ color: FIL.dim }}>{meta}</div>}
      </div>
    </div>
  );
}

// Tiny pass/fail run history as dots (job run timeline, monitor uptime, etc.).
export function FilDots({ states }: { states: ("ok" | "fail" | "warn" | "idle")[] }) {
  const c = { ok: FIL.green, fail: FIL.mag, warn: FIL.amber, idle: "rgba(255,255,255,0.18)" };
  return (
    <span className="inline-flex items-center gap-1">
      {states.map((s, i) => (
        <span key={i} className="size-[5px] rounded-full" style={{ background: c[s], boxShadow: s !== "idle" ? `0 0 5px ${c[s]}` : undefined }} />
      ))}
    </span>
  );
}
