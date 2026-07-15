"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert, TriangleAlert, MailCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, type NavItem } from "@/lib/nav";
import { canViewSection } from "@/lib/access";

// The Filament rail: a living core (Tess) at the top, zone-grouped navigation
// with a voltage-cyan active "current", and a persistent vitals cluster at the
// bottom so system health is readable from every page. Replaces the legacy
// Sidebar only when design mode = filament; Pulse keeps its own sidebar.

const CUR = "#27f0d4";
const ZONES: { label: string; hrefs: string[] }[] = [
  { label: "Pulse", hrefs: ["/", "/analytics"] },
  { label: "Studio", hrefs: ["/content-strategy", "/demo-studio", "/social"] },
  { label: "Growth", hrefs: ["/seo", "/competitors"] },
  { label: "Comms", hrefs: ["/inbox", "/outreach"] },
  { label: "Ops", hrefs: ["/site-health", "/feedback", "/playbooks", "/jobs", "/audit"] },
];
const PINNED = ["/agent", "/settings"];

function byHref(href: string): NavItem | undefined {
  return NAV.find((n) => n.href === href);
}

function Row({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors",
        active ? "text-white" : "text-[#9398a3] hover:text-white hover:bg-white/[0.04]"
      )}
      style={active ? { background: "rgba(39,240,212,0.12)" } : undefined}
    >
      {active && <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: CUR, boxShadow: `0 0 8px ${CUR}` }} />}
      <Icon className="size-[15px] shrink-0" style={active ? { color: CUR } : undefined} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Vital({ icon: Icon, value, color }: { icon: typeof ShieldAlert; value: number; color: string }) {
  const lit = value > 0;
  return (
    <div className="flex flex-col items-center gap-1" title={`${value}`}>
      <Icon className="size-[15px]" style={{ color: lit ? color : "#54585f" }} />
      <span className="font-mono text-[11px] tabular-nums" style={{ color: lit ? color : "#6b7079", textShadow: lit ? `0 0 8px ${color}55` : undefined }}>
        {value}
      </span>
    </div>
  );
}

export function FilamentNav({ vitals, role }: { vitals: { critical: number; warning: number; approvals: number }; role: string }) {
  // Read gating: only keep hrefs this role may view (drops empty zones too).
  const zones = ZONES.map((z) => ({ ...z, hrefs: z.hrefs.filter((h) => canViewSection(role, h)) })).filter((z) => z.hrefs.length > 0);
  const pinned = PINNED.filter((h) => canViewSection(role, h));
  return (
    <nav className="relative hidden w-[212px] shrink-0 flex-col bg-[#0a0b0d] md:flex" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
      <Link href="/" className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="relative inline-flex size-7 shrink-0 items-center justify-center">
          <span className="fil-nuc absolute inset-0 rounded-full" style={{ background: CUR, opacity: 0.18 }} />
          <span className="size-3 rounded-full" style={{ background: "#c9fff5", boxShadow: `0 0 12px ${CUR}` }} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">Tess</span>
        <span className="ml-auto text-[9px] font-medium tracking-[0.14em]" style={{ color: CUR }}>LIVE</span>
      </Link>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {zones.map((zone) => (
          <div key={zone.label} className="mb-3">
            <div className="px-2.5 pb-1.5 text-[9.5px] font-medium uppercase tracking-[0.16em] text-[#54585f]">{zone.label}</div>
            <div className="flex flex-col gap-0.5">
              {zone.hrefs.map((h) => {
                const item = byHref(h);
                return item ? <Row key={h} item={item} /> : null;
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-3 flex items-center justify-around border-t border-white/[0.07] py-3">
        <Vital icon={ShieldAlert} value={vitals.critical} color="#ff4d6d" />
        <Vital icon={TriangleAlert} value={vitals.warning} color="#ffc24d" />
        <Vital icon={MailCheck} value={vitals.approvals} color={CUR} />
      </div>

      {pinned.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-white/[0.07] px-3 py-2">
          {pinned.map((h) => {
            const item = byHref(h);
            return item ? <Row key={h} item={item} /> : null;
          })}
        </div>
      )}
    </nav>
  );
}
