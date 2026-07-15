import Link from "next/link";
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  Clock,
  ShieldCheck,
  DatabaseBackup,
  TriangleAlert,
  FileWarning,
  CircleCheck,
  CircleX,
  CircleHelp,
  Settings as SettingsIcon,
  ArrowUpRight,
} from "lucide-react";
import { getMonitors, getVpsHealth, getHealthOverview, type MonitorView, type RateView } from "@/lib/health";
import { getCertExpiries, type CertInfo } from "@/lib/ssl";
import { getDesignMode } from "@/lib/design-mode";
import { SiteHealthFilament } from "./site-health-filament";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { relativeTime, utcStamp } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/analytics/auto-refresh";

export const metadata = { title: "Site Health" };
export const dynamic = "force-dynamic";

function humanUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function word(pct: number, warn: number, crit: number): { label: string; tone: string } {
  if (pct >= crit) return { label: "critical", tone: "text-rose-600 dark:text-rose-400" };
  if (pct >= warn) return { label: "getting full", tone: "text-amber-600 dark:text-amber-400" };
  return { label: "healthy", tone: "text-emerald-600 dark:text-emerald-400" };
}

function barTone(pct: number, warn: number, crit: number): string {
  if (pct >= crit) return "bg-rose-500";
  if (pct >= warn) return "bg-amber-500";
  return "bg-emerald-500";
}

function StatusBadge({ status }: { status: MonitorView["status"] }) {
  if (status === "up")
    return (
      <Badge variant="secondary" className="gap-1 text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="size-3" /> Up
      </Badge>
    );
  if (status === "down")
    return (
      <Badge variant="destructive" className="gap-1">
        <CircleX className="size-3" /> Down
      </Badge>
    );
  if (status === "unconfigured")
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <CircleHelp className="size-3" /> Not configured
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <CircleHelp className="size-3" /> Unknown
    </Badge>
  );
}

function Timeline({ checks }: { checks: boolean[] }) {
  if (checks.length === 0) return <span className="text-[11px] text-muted-foreground">no checks yet</span>;
  return (
    <div className="flex items-end gap-px" title={`last ${checks.length} checks`}>
      {checks.map((ok, i) => (
        <span key={i} className={`h-4 w-1 rounded-sm ${ok ? "bg-emerald-500/70" : "bg-rose-500"}`} />
      ))}
    </div>
  );
}

function MonitorCard({ m }: { m: MonitorView }) {
  const meta = SITE_META[m.key as SiteKey];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${meta?.dot ?? "bg-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">{m.label}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{m.url.replace(/^https?:\/\//, "")}</p>
            </div>
          </div>
          <StatusBadge status={m.status} />
        </div>

        <Timeline checks={m.timeline} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            uptime 24h: <span className="font-medium text-foreground">{m.uptime24h == null ? "—" : `${m.uptime24h}%`}</span>
          </span>
          <span>
            latency: <span className="font-medium text-foreground">{m.latencyMs == null ? "—" : `${m.latencyMs}ms`}</span>
          </span>
          {m.code != null && <span>HTTP {m.code}</span>}
          {m.checkedAt && <span>checked {relativeTime(new Date(m.checkedAt))}</span>}
        </div>
        {m.status === "down" && m.downSince && (
          <p className="text-[11px] text-rose-600 dark:text-rose-400">
            Down since {utcStamp(new Date(m.downSince))}
            {m.error ? ` · ${m.error}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RateCard({ rate }: { rate: RateView }) {
  const age = rate.detail?.ageHours;
  const max = rate.detail?.maxAgeHours ?? 4;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4" /> CheckInvestNg rate pipeline
        </CardTitle>
        <StatusBadge status={rate.status} />
      </CardHeader>
      <CardContent className="text-sm">
        {rate.status === "unconfigured" ? (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground">
              The watchdog checks — from outside the site — that published rates are fresh, and alerts if they go stale
              beyond {max}h. It needs to know how CheckInvestNg exposes its &quot;last updated&quot; time.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[13px]">
              <SettingsIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Configure the freshness signal in <span className="font-medium">Settings → rate_watchdog</span>: set{" "}
                <code>mode</code> to <code>regex</code> (a pattern capturing the timestamp) or <code>json</code> (an
                endpoint + field), and <code>configured: true</code>. Until then it stays off and never false-alarms.
              </span>
            </div>
          </div>
        ) : rate.status === "down" ? (
          <p className="text-rose-600 dark:text-rose-400">
            Rates are <span className="font-semibold">stale</span> — last updated {age?.toFixed(1)}h ago (threshold {max}h).
            {rate.checkedAt ? ` Checked ${relativeTime(new Date(rate.checkedAt))}.` : ""}
          </p>
        ) : (
          <p className="text-emerald-600 dark:text-emerald-400">
            Fresh — rates updated {age != null ? `${age.toFixed(1)}h` : "recently"} ago (within {max}h).
            {rate.checkedAt ? (
              <span className="text-muted-foreground"> Checked {relativeTime(new Date(rate.checkedAt))}.</span>
            ) : null}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  pct,
  detail,
  warn = 80,
  crit = 90,
}: {
  icon: typeof Cpu;
  label: string;
  pct: number;
  detail: string;
  warn?: number;
  crit?: number;
}) {
  const w = word(pct, warn, crit);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        <span>
          <span className="font-medium tabular-nums">{pct}%</span> <span className={`text-xs ${w.tone}`}>— {w.label}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barTone(pct, warn, crit)}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground">{detail}</span>
    </div>
  );
}

function SslCard({ certs }: { certs: { site: string; domain: string; cert: CertInfo }[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">TLS certificates</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {certs.map(({ site, domain, cert }) => {
          const d = cert.daysLeft;
          const tone = cert.error || d == null ? "text-muted-foreground" : d < 14 ? "text-rose-600 dark:text-rose-400" : d < 30 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
          return (
            <Card key={domain}>
              <CardContent className="flex items-center gap-3 p-4">
                <ShieldCheck className={`size-5 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${SITE_META[site as SiteKey]?.dot ?? "bg-muted"}`} />
                    <span className="truncate text-sm font-medium">{domain}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {cert.error ? `couldn't check: ${cert.error}` : d == null ? "no certificate" : `expires ${cert.validTo ? utcStamp(new Date(cert.validTo)) : "?"}${cert.issuer ? ` · ${cert.issuer}` : ""}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-lg font-semibold tabular-nums ${tone}`}>{d == null ? "—" : d}</div>
                  <div className="text-[10px] text-muted-foreground">days left</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export default async function HealthPage() {
  const domains = SITE_KEYS.map((k) => SITE_META[k].domain);
  const [{ http, rate }, vps, overview, certList] = await Promise.all([getMonitors(), getVpsHealth(), getHealthOverview(), getCertExpiries(domains)]);

  if ((await getDesignMode()) === "filament") {
    return <SiteHealthFilament http={http} rate={rate} vps={vps} overview={overview} certList={certList} />;
  }

  const certs = SITE_KEYS.map((k, i) => ({ site: k, domain: SITE_META[k].domain, cert: certList[i] }));

  const issues = http.filter((m) => m.status === "down").length + (rate.status === "down" ? 1 : 0);
  const allGood = issues === 0;

  return (
    <div data-section="health" className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Site Health</h1>
          <p className="text-sm text-muted-foreground">
            Uptime, rate-pipeline freshness, and the VPS at a glance. Checks run on the box every few minutes and alert
            the bell on any change.
          </p>
        </div>
        <AutoRefresh seconds={30} />
      </div>

      {/* Status banner */}
      <div
        className={`flex items-center gap-3 rounded-xl border p-4 bg-gradient-to-r ${
          allGood
            ? "border-emerald-500/40 from-emerald-500/20 via-emerald-500/[0.08] to-transparent"
            : "border-rose-500/40 from-rose-500/20 via-rose-500/[0.08] to-transparent"
        }`}
      >
        {allGood ? (
          <CircleCheck className="size-6 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <TriangleAlert className="size-6 text-rose-600 dark:text-rose-400" />
        )}
        <div>
          <p className="font-medium">
            {allGood ? "All systems operational" : `${issues} issue${issues > 1 ? "s" : ""} need attention`}
          </p>
          <p className="text-xs text-muted-foreground">
            {http.filter((m) => m.status === "up").length}/{http.length} endpoints up
            {rate.status !== "unconfigured" ? ` · rate pipeline ${rate.status === "up" ? "fresh" : "stale"}` : ""}
          </p>
        </div>
      </div>

      {/* Uptime monitors */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Uptime</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {http.map((m) => (
            <MonitorCard key={m.key} m={m} />
          ))}
        </div>
      </section>

      {/* TLS certificates */}
      <SslCard certs={certs} />

      {/* Rate watchdog */}
      <RateCard rate={rate} />

      {/* VPS health */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Server className="size-4" /> VPS health
          </CardTitle>
          {vps && <span className="text-[11px] text-muted-foreground">updated {relativeTime(new Date(vps.collectedAt))}</span>}
        </CardHeader>
        <CardContent>
          {!vps ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Collecting the first snapshot…</p>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-5 sm:grid-cols-3">
                <Metric
                  icon={Cpu}
                  label="CPU"
                  pct={vps.cpuPct}
                  warn={75}
                  crit={90}
                  detail={`${vps.cores} cores · load ${vps.load.join(" / ")}`}
                />
                <Metric icon={MemoryStick} label="Memory" pct={vps.memUsedPct} warn={80} crit={92} detail={`of ${vps.memTotalGb} GB`} />
                <Metric icon={HardDrive} label="Disk" pct={vps.diskUsedPct} warn={80} crit={90} detail={`of ${vps.diskTotalGb} GB`} />
              </div>

              <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Uptime</p>
                    <p className="font-medium">{humanUptime(vps.uptimeSecs)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DatabaseBackup className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Last backup</p>
                    <p className="font-medium">{vps.lastBackupAt ? relativeTime(new Date(vps.lastBackupAt * 1000)) : "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Last security update</p>
                    <p className="font-medium">{vps.lastSecurityAt ? relativeTime(new Date(vps.lastSecurityAt * 1000)) : "—"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Server className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Services</p>
                    <div className="flex flex-wrap gap-2">
                      {vps.services.map((s) => (
                        <span key={s.name} className="flex items-center gap-1 text-xs">
                          <span className={`size-1.5 rounded-full ${s.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
                          {s.name.replace("tess-", "")}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Errors & 404s + recent alerts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Errors &amp; 404s (24h)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/analytics?tab=errors"
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
              >
                <TriangleAlert className="size-5 text-amber-500" />
                <div>
                  <p className="text-xl font-semibold tabular-nums">{overview.errors24}</p>
                  <p className="text-xs text-muted-foreground">
                    JS errors <ArrowUpRight className="inline size-3" />
                  </p>
                </div>
              </Link>
              <Link
                href="/analytics?tab=pages"
                className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
              >
                <FileWarning className="size-5 text-amber-500" />
                <div>
                  <p className="text-xl font-semibold tabular-nums">{overview.notFound24}</p>
                  <p className="text-xs text-muted-foreground">
                    404s <ArrowUpRight className="inline size-3" />
                  </p>
                </div>
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Spikes raise a notification automatically (threshold configurable in Settings). Full breakdowns live in
              Analytics.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active alerts</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            {overview.recent.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">No alerts — all quiet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {overview.recent.map((nlog) => (
                  <li key={nlog.id} className={`flex items-center gap-2 py-2 ${nlog.readAt ? "opacity-50" : ""}`}>
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        nlog.severity === "critical"
                          ? "bg-rose-500"
                          : nlog.severity === "warning"
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate">{nlog.title}</span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{nlog.module}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(new Date(nlog.createdAt))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
