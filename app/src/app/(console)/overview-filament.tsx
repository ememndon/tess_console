import type { ComponentProps } from "react";
import Link from "next/link";
import { ExternalLink, ArrowUpRight, ArrowUp, Command } from "lucide-react";
import type { SiteOverview, GlobalOverview } from "@/lib/overview";
import { relativeTime } from "@/lib/format";
import { FilamentHello } from "./filament-hello";
import { PendingApprovals } from "./pending-approvals";

type ApprovalItems = ComponentProps<typeof PendingApprovals>["items"];

const CUR = "#27f0d4";
const CURHI = "#8bffec";
const SITE_HEX: Record<string, string> = { calculatry: "#3b82f6", resumehub: "#f97316", checkinvest: "#10b981" };
const RADII = [72, 58, 44];

// The living system core: one ring per property, arc length = its uptime health.
function SystemCore({ sites }: { sites: SiteOverview[] }) {
  const rings = sites.slice(0, 3).map((s, i) => {
    const r = RADII[i];
    const c = 2 * Math.PI * r;
    let frac = s.uptime24h != null ? s.uptime24h / 100 : s.uptimeStatus === "up" ? 0.99 : s.uptimeStatus === "down" ? 0.25 : 0.6;
    frac = Math.max(0.02, Math.min(1, frac));
    const on = Math.max(4, c * frac);
    return { r, on, off: Math.max(0, c - on), color: SITE_HEX[s.site] ?? CUR };
  });
  return (
    <svg viewBox="0 0 180 180" width="170" height="170" aria-hidden className="shrink-0">
      <g className="fil-spin">
        <circle cx="90" cy="90" r="83" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="1.5 9" />
      </g>
      {rings.map((ring, i) => (
        <circle key={i} cx="90" cy="90" r={ring.r} fill="none" stroke={ring.color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${ring.on} ${ring.off}`} transform="rotate(-90 90 90)" opacity="0.92" />
      ))}
      <circle className="fil-nuc" cx="90" cy="90" r="27" fill={CUR} opacity="0.16" />
      <circle cx="90" cy="90" r="13" fill={CUR} opacity="0.8" />
      <circle cx="90" cy="90" r="6" fill={CURHI} />
    </svg>
  );
}

function Signal({ value, label, color, live }: { value: number; label: string; color: string; live?: boolean }) {
  const lit = value > 0;
  return (
    <div className="relative" style={live && lit ? { paddingLeft: 14 } : undefined}>
      {live && lit && <span className="fil-surge absolute left-0 top-1 bottom-3.5 w-[2px]" style={{ background: CUR, boxShadow: `0 0 10px ${CUR}` }} />}
      <div className="font-mono text-[30px] font-medium leading-none tabular-nums" style={{ color: lit ? color : "#9398a3", textShadow: lit && live ? `0 0 18px ${color}55` : undefined }}>
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.13em]" style={{ color: lit && live ? CUR : "#6b7079" }}>{label}</div>
    </div>
  );
}

const uptimeTone: Record<string, string> = { up: "#34e08a", down: "#ff4d6d", unknown: "#6b7079", unconfigured: "#6b7079" };

function PropertyNode({ s }: { s: SiteOverview }) {
  const color = SITE_HEX[s.site] ?? CUR;
  const up = s.uptimeStatus === "up" ? (s.uptime24h != null ? `${s.uptime24h}%` : "up") : s.uptimeStatus === "down" ? "DOWN" : "—";
  return (
    <div className="min-w-[150px] flex-1 pb-2" style={{ borderBottom: `1px solid ${color}33` }}>
      <Link href="/analytics" className="flex items-center gap-2">
        <span className="size-[6px] rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="text-[12.5px] font-medium text-white">{s.name}</span>
        <ExternalLink className="ml-auto size-3 text-[#6b7079]" />
      </Link>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="font-mono text-[17px] tabular-nums text-white">{s.visitorsToday.toLocaleString()}</span>
        <span className="text-[10px] uppercase tracking-[0.1em] text-[#6b7079]">today</span>
        <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color: uptimeTone[s.uptimeStatus] }}>{up}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2 text-[10.5px] text-[#9398a3]">
        <span>GSC clicks 7d</span>
        <span className="ml-auto font-mono tabular-nums text-white/80">{s.clicks7d.toLocaleString()}</span>
      </div>
    </div>
  );
}

export function OverviewFilament({
  sites,
  global,
  approvals,
  firstName,
}: {
  sites: SiteOverview[];
  global: GlobalOverview;
  approvals: ApprovalItems;
  firstName: string;
}) {
  const score = Math.max(0, Math.min(100, Math.round(100 - global.critical * 15 - global.warning * 4 - global.jobsFailing * 8)));
  const verdict = score >= 95 ? "nominal" : score >= 80 ? "watch" : "degraded";

  return (
    <div data-section="overview" className="flex flex-1 flex-col gap-6 p-6 text-[#eef1f4]">
      <div className="flex items-center gap-2.5">
        <span className="text-[13px] font-semibold tracking-tight text-white">Tess</span>
        <span className="text-[10px] font-medium tracking-[0.14em]" style={{ color: CUR }}>OPERATING</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] tracking-[0.12em] text-[#9398a3]" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <span className="size-[5px] rounded-full" style={{ background: CUR, boxShadow: `0 0 7px ${CUR}` }} /> FIELD · {verdict.toUpperCase()}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <SystemCore sites={sites} />
        <div className="min-w-[220px] flex-1">
          <FilamentHello name={firstName} />
          <div className="mt-2.5 flex items-baseline gap-2.5">
            <span className="font-mono text-[42px] font-medium leading-none tabular-nums text-white">{score}</span>
            <span className="text-[12px] text-[#6b7079]">/ 100</span>
            <span className="text-[11px] font-medium tracking-[0.14em]" style={{ color: CUR }}>{verdict.toUpperCase()}</span>
          </div>
          <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#6b7079]">System health · {sites.length} {sites.length === 1 ? "property" : "properties"}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-7 gap-y-4 border-t pt-5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <Signal value={global.critical} label="Critical" color="#ff4d6d" />
        <Signal value={global.warning} label="Warnings" color="#ffc24d" />
        <Signal value={global.pendingApprovals} label="Approvals · live" color={CURHI} live />
        <Signal value={global.jobsFailing} label="Jobs down" color="#ff4d6d" />
      </div>

      <div className="flex flex-wrap gap-x-7 gap-y-4">
        {sites.map((s) => (
          <PropertyNode key={s.site} s={s} />
        ))}
      </div>

      <div style={{ borderLeft: `2px solid ${CUR}`, background: "linear-gradient(90deg, rgba(39,240,212,0.06), transparent 85%)", boxShadow: "-1px 0 18px rgba(39,240,212,0.14)" }} className="rounded-r-lg">
        <PendingApprovals items={approvals} />
      </div>

      <div className="rounded-xl border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9398a3]">Recent activity</h2>
          <Link href="/audit" className="inline-flex items-center gap-0.5 text-xs text-[#9398a3] hover:text-white">Audit log <ArrowUpRight className="size-3" /></Link>
        </div>
        {global.recent.length === 0 ? (
          <p className="p-4 text-sm text-[#9398a3]">No activity yet.</p>
        ) : (
          <ul>
            {global.recent.map((r, i) => (
              <li key={i} className="flex items-center gap-3 border-t px-4 py-2 text-sm" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                <span className="font-medium text-white">{r.actor}</span>
                <code className="rounded px-1.5 py-0.5 font-mono text-[10px] text-[#9398a3]" style={{ background: "rgba(255,255,255,0.05)" }}>{r.action}</code>
                {r.target && <span className="truncate text-xs text-[#6b7079]">{r.target}</span>}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-[#6b7079]">{relativeTime(new Date(r.at))}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Link href="/agent" className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ border: "1px solid rgba(39,240,212,0.28)", background: "rgba(39,240,212,0.04)" }}>
          <Command className="size-4" style={{ color: CUR }} />
          <span className="text-[12.5px] text-[#9398a3]">Ask Tess to compose a view…</span>
          <ArrowUp className="ml-auto size-4 rounded-md p-0.5" style={{ color: "#06231f", background: CURHI }} />
        </Link>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {["what's bleeding money this week", "who needs a reply", "draft this week's posts"].map((c) => (
            <Link key={c} href="/agent" className="rounded-full border px-3 py-1 text-[11px] text-[#9398a3] hover:text-white" style={{ borderColor: "rgba(255,255,255,0.1)" }}>{c}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
