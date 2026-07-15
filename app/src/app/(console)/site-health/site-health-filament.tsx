import { relativeTime } from "@/lib/format";
import type { MonitorView, RateView, VpsHealth } from "@/lib/health";
import type { CertInfo } from "@/lib/ssl";
import { AutoRefresh } from "@/components/analytics/auto-refresh";
import { FIL, FilHead, FilStat, FilPanel, FilBar, FilStream, FilStreamRow } from "@/components/filament/ui";

type Overview = { errors24: number; notFound24: number; recent: { title: string; body: string | null; severity: string; createdAt: Date }[] };

function humanUptime(secs: number): string {
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const barTone = (pct: number) => (pct >= 90 ? FIL.mag : pct >= 75 ? FIL.amber : FIL.green);
const monColor = (s: string) => (s === "up" ? FIL.green : s === "down" ? FIL.mag : "rgba(255,255,255,0.25)");
const sevColor = (s: string) => (s === "critical" ? FIL.mag : s === "warning" ? FIL.amber : FIL.cur);

function Timeline({ states }: { states: boolean[] }) {
  return (
    <span className="inline-flex items-end gap-[2px]">
      {states.slice(-24).map((ok, i) => (
        <span key={i} className="w-[3px] rounded-[1px]" style={{ height: ok ? 12 : 7, background: ok ? FIL.green : FIL.mag, boxShadow: `0 0 4px ${ok ? FIL.green : FIL.mag}77` }} />
      ))}
    </span>
  );
}

export function SiteHealthFilament({ http, vps, overview, certList }: { http: MonitorView[]; rate: RateView; vps: VpsHealth | null; overview: Overview; certList: CertInfo[] }) {
  const upCount = http.filter((m) => m.status === "up").length;
  return (
    <div data-section="health" className="flex flex-1 flex-col gap-6 p-6 text-[#eef1f4]">
      <div className="flex items-start justify-between gap-3">
        <FilHead title="Site Health" sub="Live vitals across the VPS, your endpoints, and TLS. The substrate reflects state." register="SIGNAL" />
        <AutoRefresh seconds={30} />
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-t pt-5" style={{ borderColor: FIL.hair }}>
        <FilStat value={`${upCount}/${http.length}`} label="Endpoints up" color={upCount === http.length ? FIL.green : FIL.amber} />
        <FilStat value={overview.errors24} label="Errors 24h" color={overview.errors24 ? FIL.mag : FIL.mut} live={overview.errors24 > 0} />
        <FilStat value={overview.notFound24} label="404s 24h" color={overview.notFound24 ? FIL.amber : FIL.mut} />
        <FilStat value={vps ? humanUptime(vps.uptimeSecs) : "—"} label="VPS uptime" color={FIL.curhi} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FilPanel label={vps ? `VPS · ${vps.cores} cores · ${vps.collectedAt ? relativeTime(new Date(vps.collectedAt)) : ""}` : "VPS"}>
          {vps ? (
            <div className="flex flex-col gap-4 p-4">
              <FilBar label="CPU" pct={vps.cpuPct} tone={barTone(vps.cpuPct)} />
              <FilBar label={`Memory · ${vps.memTotalGb}GB`} pct={vps.memUsedPct} tone={barTone(vps.memUsedPct)} />
              <FilBar label={`Disk · ${vps.diskTotalGb}GB`} pct={vps.diskUsedPct} tone={barTone(vps.diskUsedPct)} />
              <div className="flex items-baseline justify-between text-[11px]"><span style={{ color: FIL.mut }}>Load avg</span><span className="font-mono tabular-nums text-white">{vps.load.map((l) => l.toFixed(2)).join("  ")}</span></div>
              {vps.services.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: FIL.hair }}>
                  {vps.services.map((s) => (
                    <span key={s.name} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px]" style={{ borderColor: FIL.line, color: FIL.mut }}>
                      <span className="size-1.5 rounded-full" style={{ background: s.ok ? FIL.green : FIL.mag, boxShadow: `0 0 5px ${s.ok ? FIL.green : FIL.mag}` }} />{s.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="p-4 text-[12.5px]" style={{ color: FIL.mut }}>No VPS telemetry yet — the collector cron reports here.</p>
          )}
        </FilPanel>

        <FilPanel label="TLS certificates">
          {certList.length === 0 ? (
            <p className="p-4 text-[12.5px]" style={{ color: FIL.mut }}>No certificates checked.</p>
          ) : (
            <div className="flex flex-col">
              {certList.map((c) => {
                const tone = c.daysLeft == null ? FIL.dim : c.daysLeft < 14 ? FIL.mag : c.daysLeft < 30 ? FIL.amber : FIL.green;
                return (
                  <div key={c.host} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-0" style={{ borderColor: FIL.hair }}>
                    <span className="size-2 rounded-full" style={{ background: tone, boxShadow: `0 0 6px ${tone}` }} />
                    <span className="truncate text-[12px] text-white">{c.host}</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color: tone }}>{c.error ? "error" : c.daysLeft != null ? `${c.daysLeft}d left` : "—"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </FilPanel>
      </div>

      <FilPanel label="Endpoints">
        <div className="flex flex-col">
          {http.map((m) => (
            <div key={m.key} className="flex items-center gap-3 border-b px-4 py-3 last:border-0" style={{ borderColor: FIL.hair }}>
              <span className="size-2.5 rounded-full" style={{ background: monColor(m.status), boxShadow: `0 0 7px ${monColor(m.status)}` }} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-white">{m.label}</div>
                <div className="truncate text-[10.5px]" style={{ color: FIL.dim }}>{m.url}</div>
              </div>
              <div className="ml-auto flex items-center gap-5">
                {m.timeline?.length > 0 && <Timeline states={m.timeline} />}
                <div className="text-right">
                  <div className="font-mono text-[12px] tabular-nums" style={{ color: m.status === "up" ? FIL.green : FIL.mut }}>{m.uptime24h != null ? `${m.uptime24h}%` : m.status}</div>
                  <div className="font-mono text-[10px]" style={{ color: FIL.dim }}>{m.latencyMs != null ? `${m.latencyMs}ms` : "—"}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </FilPanel>

      {overview.recent.length > 0 && (
        <FilPanel label="Active alerts">
          <div className="px-4 py-2">
            <FilStream>
              {overview.recent.map((n, i) => (
                <FilStreamRow
                  key={i}
                  color={sevColor(n.severity)}
                  title={<span className="text-[12.5px] text-white">{n.title}</span>}
                  meta={n.body}
                  right={<span className="font-mono text-[10px]" style={{ color: FIL.dim }}>{relativeTime(new Date(n.createdAt))}</span>}
                />
              ))}
            </FilStream>
          </div>
        </FilPanel>
      )}
    </div>
  );
}
