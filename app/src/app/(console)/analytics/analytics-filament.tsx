import type { ReactNode, ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { RANGES, ALGO_UPDATES, type Range, type Kpis } from "@/lib/analytics";
import { SITE_META, type SiteKey, type SiteScope } from "@/lib/site-scope";
import { relativeTime } from "@/lib/format";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import { AutoRefresh } from "@/components/analytics/auto-refresh";
import { FIL, FilHead, FilStat, FilPanel } from "@/components/filament/ui";

type Realtime = { active: number; recent: { type: string; name?: string | null; path?: string | null; site: string; country?: string | null; device?: string | null; createdAt: Date | string }[] };
type HrefWith = (over: { range?: Range; tab?: string; event?: string | null }) => string;

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="text-[10px]" style={{ color: FIL.dim }}>new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  const color = pct > 0 ? FIL.green : pct < 0 ? FIL.mag : FIL.dim;
  return <span className="inline-flex items-center gap-0.5 text-[10.5px] font-mono" style={{ color }}><Icon className="size-3" />{Math.abs(pct)}%</span>;
}

export function AnalyticsFilament({
  scope, range, scopeName, kpis, points, realtime, tab, hrefWith, sections, deepDives,
}: {
  scope: SiteScope;
  range: Range;
  scopeName: string;
  kpis: Kpis;
  points: ComponentProps<typeof TrafficChart>["points"];
  realtime: Realtime;
  tab: string;
  hrefWith: HrefWith;
  sections: readonly { key: string; label: string; icon: LucideIcon }[];
  deepDives: ReactNode;
}) {
  return (
    <div data-section="analytics" className="flex flex-1 flex-col gap-6 p-6 text-[#eef1f4]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <FilHead title="Analytics" sub={`First-party, cookieless traffic for ${scopeName}.`} register="SIGNAL" />
        <div className="flex items-center rounded-full border p-0.5" style={{ borderColor: FIL.line }}>
          {RANGES.map((r) => {
            const active = r.value === range;
            return (
              <Link key={r.value} href={hrefWith({ range: r.value })} scroll={false} className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={active ? { background: "rgba(39,240,212,0.15)", color: FIL.curhi } : { color: FIL.mut }}>
                {r.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-t pt-5" style={{ borderColor: FIL.hair }}>
        <FilStat value={kpis.visitors.toLocaleString()} label="Unique visitors" color={FIL.curhi} live />
        <div className="flex flex-col gap-1.5">
          <FilStat value={kpis.pageviews.toLocaleString()} label="Pageviews" />
          <Delta now={kpis.pageviews} prev={kpis.prevPageviews} />
        </div>
        <FilStat value={kpis.avgLoadMs == null ? "—" : `${(kpis.avgLoadMs / 1000).toFixed(2)}s`} label="Avg load" color={FIL.green} />
        <FilStat value={kpis.events.toLocaleString()} label="Custom events" color={FIL.mut} />
        <FilStat value={kpis.errors.toLocaleString()} label="JS errors" color={kpis.errors > 0 ? FIL.mag : FIL.mut} />
      </div>

      <FilPanel label="Traffic over time">
        <div className="p-4"><TrafficChart points={points} hourly={range === 1} annotations={ALGO_UPDATES} /></div>
      </FilPanel>

      <FilPanel label={`Real-time · ${realtime.active} active now`} action={<AutoRefresh seconds={15} />}>
        {realtime.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs" style={{ color: FIL.mut }}>No activity in the last 30 minutes.</p>
        ) : (
          <ul className="px-4">
            {realtime.recent.map((e, i) => (
              <li key={i} className="flex items-center gap-3 border-b py-2 text-sm last:border-0" style={{ borderColor: FIL.hair }}>
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] capitalize" style={{ background: "rgba(255,255,255,0.05)", color: FIL.mut }}>{e.type === "not_found" ? "404" : e.name ?? e.type}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: FIL.tx }}>{e.path ?? "—"}</span>
                {scope === "all" && <span className="shrink-0 text-[11px]" style={{ color: FIL.mut }}>{SITE_META[e.site as SiteKey]?.name ?? e.site}</span>}
                <span className="shrink-0 text-[11px]" style={{ color: FIL.dim }}>{e.country ? `${e.country} ` : ""}{e.device ?? ""}</span>
                <span className="shrink-0 font-mono text-[10px]" style={{ color: FIL.dim }}>{relativeTime(new Date(e.createdAt))}</span>
              </li>
            ))}
          </ul>
        )}
      </FilPanel>

      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: FIL.line }}>
        {sections.map((s) => {
          const active = s.key === tab;
          return (
            <Link key={s.key} href={hrefWith({ tab: s.key, event: null })} scroll={false}
              className="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors"
              style={active ? { borderColor: FIL.cur, color: "#fff" } : { borderColor: "transparent", color: FIL.mut }}>
              <s.icon className="size-3.5" />{s.label}
            </Link>
          );
        })}
      </div>

      {deepDives}
    </div>
  );
}
