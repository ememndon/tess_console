import "server-only";
import { desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { monitors, notifications, settings } from "./db/schema";

// Site Health queries. Monitor state is written by the host cron
// checks; this layer reads it for the dashboard.

export type MonitorView = {
  key: string;
  label: string;
  url: string;
  status: "up" | "down" | "unknown" | "unconfigured";
  latencyMs: number | null;
  code: number | null;
  checkedAt: Date | null;
  downSince: Date | null;
  error: string | null;
  uptime24h: number | null;
  timeline: boolean[];
};

type Row = Record<string, unknown>;
const rows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

export async function getMonitors(): Promise<{ http: MonitorView[]; rate: RateView }> {
  const all = await db.select().from(monitors);

  const upRows = await rows(sql`
    SELECT monitor_key, round(100.0 * count(*) FILTER (WHERE ok) / nullif(count(*),0), 1)::float AS pct
    FROM monitor_checks WHERE checked_at >= now() - interval '24 hours'
    GROUP BY monitor_key
  `);
  const up = new Map(upRows.map((r) => [String(r.monitor_key), r.pct == null ? null : Number(r.pct)]));

  const tlRows = await rows(sql`
    SELECT monitor_key, ok FROM (
      SELECT monitor_key, ok, id, row_number() OVER (PARTITION BY monitor_key ORDER BY id DESC) rn
      FROM monitor_checks
    ) s WHERE rn <= 40 ORDER BY monitor_key, id ASC
  `);
  const tl = new Map<string, boolean[]>();
  for (const r of tlRows) {
    const k = String(r.monitor_key);
    const arr = tl.get(k) ?? [];
    arr.push(r.ok === true);
    tl.set(k, arr);
  }

  const http: MonitorView[] = all
    .filter((m) => m.kind === "http")
    .map((m) => ({
      key: m.key,
      label: m.label,
      url: m.url,
      status: m.lastStatus,
      latencyMs: m.lastLatencyMs,
      code: m.lastCode,
      checkedAt: m.lastCheckedAt,
      downSince: m.downSince,
      error: m.lastError,
      uptime24h: up.get(m.key) ?? null,
      timeline: tl.get(m.key) ?? [],
    }))
    .sort((a, b) => (a.key === "console" ? 1 : 0) - (b.key === "console" ? 1 : 0));

  const r = all.find((m) => m.kind === "rate");
  const rate: RateView = {
    key: r?.key ?? "checkinvest-rates",
    label: r?.label ?? "Rate pipeline",
    status: (r?.lastStatus ?? "unknown") as RateView["status"],
    checkedAt: r?.lastCheckedAt ?? null,
    error: r?.lastError ?? null,
    detail: (r?.detail as RateView["detail"]) ?? null,
  };

  return { http, rate };
}

// Translate the probe's HTTP code into a plain-English likely cause, so Tess can
// diagnose (not just report) why a site dipped. The code is the key signal.
function likelyCause(code: number | null): string {
  if (code == null || code === 0) return "No response — the probe couldn't connect at all (a network/DNS blip, or the host/container was briefly unreachable).";
  if (code === 502 || code === 503 || code === 504) return `Gateway error (HTTP ${code}) — the Caddy reverse proxy couldn't reach the app: usually a brief app restart/redeploy, or Caddy needing a reload (the known app↔Caddy DNS quirk after recreating the app container).`;
  if (code >= 520 && code <= 524) return `Cloudflare couldn't get a valid response from the origin (HTTP ${code}) — the app/Caddy behind Cloudflare briefly hiccuped, timed out, or dropped the connection. Check the app container + Caddy for that window (a restart/redeploy is the usual trigger).`;
  if (code >= 500) return `Application error (HTTP ${code}) — the app itself returned a server error; check the app logs for that window.`;
  if (code === 429) return "Rate limited (HTTP 429) — too many requests hit the origin.";
  if (code >= 400) return `HTTP ${code} at the probed URL — a routing/edge/auth-wall issue rather than the app being down.`;
  if (code >= 200 && code < 400) return `Slow response — returned HTTP ${code} but exceeded the 12s probe timeout, so it was logged as down. A performance blip, not a hard outage.`;
  return `HTTP ${code}.`;
}

export type Incident = {
  site: string;
  label: string;
  started: string;
  ended: string;
  failedChecks: number;
  approxDurationMin: number;
  httpCode: number | null;
  maxLatencyMs: number | null;
  likelyCause: string;
};

// Reconstruct downtime windows from the per-check history (kept 7 days): groups of
// consecutive failed checks per monitor, with timing, the representative HTTP code,
// and a likely cause. This is the "incident log" the dashboard number alone lacks.
export async function getUptimeIncidents(hours = 48): Promise<{ incidents: Incident[]; events: { at: string; severity: string; title: string; body: string | null }[] }> {
  const inc = await rows(sql`
    WITH c AS (
      SELECT mc.monitor_key, m.label, mc.ok, mc.code, mc.latency_ms, mc.checked_at,
        row_number() OVER (PARTITION BY mc.monitor_key ORDER BY mc.checked_at)
        - row_number() OVER (PARTITION BY mc.monitor_key, mc.ok ORDER BY mc.checked_at) AS grp
      FROM monitor_checks mc JOIN monitors m ON m.key = mc.monitor_key
      WHERE mc.checked_at >= now() - make_interval(hours => ${hours})
    )
    SELECT monitor_key, max(label) AS label,
      min(checked_at) AS started, max(checked_at) AS ended,
      count(*)::int AS checks,
      mode() WITHIN GROUP (ORDER BY code) AS code,
      max(latency_ms)::int AS max_latency
    FROM c WHERE ok = false
    GROUP BY monitor_key, grp
    ORDER BY min(checked_at) DESC
    LIMIT 40
  `);
  const incidents: Incident[] = inc.map((r) => {
    const code = r.code == null ? null : Number(r.code);
    const started = new Date(r.started as string);
    const ended = new Date(r.ended as string);
    return {
      site: String(r.monitor_key),
      label: String(r.label),
      started: started.toISOString(),
      ended: ended.toISOString(),
      failedChecks: Number(r.checks),
      approxDurationMin: Math.max(1, Math.round((ended.getTime() - started.getTime()) / 60000)),
      httpCode: code,
      maxLatencyMs: r.max_latency == null ? null : Number(r.max_latency),
      likelyCause: likelyCause(code),
    };
  });
  const ev = await db
    .select()
    .from(notifications)
    .where(eq(notifications.module, "health"))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  const events = ev.map((n) => ({ at: n.createdAt.toISOString(), severity: n.severity, title: n.title, body: n.body }));
  return { incidents, events };
}

export type RateView = {
  key: string;
  label: string;
  status: "up" | "down" | "unknown" | "unconfigured";
  checkedAt: Date | null;
  error: string | null;
  detail: { updatedAt?: string; ageHours?: number; maxAgeHours?: number } | null;
};

export type VpsHealth = {
  collectedAt: string;
  cpuPct: number;
  cores: number;
  memUsedPct: number;
  memTotalGb: number;
  diskUsedPct: number;
  diskTotalGb: number;
  load: number[];
  uptimeSecs: number;
  services: { name: string; ok: boolean; status: string }[];
  lastBackupAt: number | null;
  lastSecurityAt: number | null;
};

export async function getVpsHealth(): Promise<VpsHealth | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "vps_health"));
  return (row?.value as VpsHealth) ?? null;
}

export async function getHealthOverview() {
  const [errs] = await rows(sql`
    SELECT
      count(*) FILTER (WHERE type='error' AND created_at >= now() - interval '24 hours')::int AS errors24,
      count(*) FILTER (WHERE type='not_found' AND created_at >= now() - interval '24 hours')::int AS nf24
    FROM events
  `);
  // Every unread alert lands here, not just module='health' — the Site Overview
  // "Critical alerts" / "Warnings" tiles count unread notifications across ALL
  // modules (security, vps, system, …) and link here, so this list has to show
  // the same set or the count points at a page where the alert can't be found.
  // Unread first (the counted ones), then most-recent as a short history tail.
  const recent = await db
    .select({
      id: notifications.id,
      severity: notifications.severity,
      title: notifications.title,
      body: notifications.body,
      module: notifications.module,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
    })
    .from(notifications)
    .orderBy(sql`(${notifications.readAt} is null) desc`, desc(notifications.createdAt))
    .limit(12);
  return {
    errors24: Number(errs?.errors24 ?? 0),
    notFound24: Number(errs?.nf24 ?? 0),
    recent,
  };
}
