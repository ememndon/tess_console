import Link from "next/link";
import {
  ExternalLink, ChartLine, Activity, Search, Mail, Megaphone, MousePointerClick,
  ShieldAlert, TriangleAlert, MailCheck, ListChecks, ArrowUpRight, ServerCog,
} from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { getOverview, type SiteOverview, type GlobalOverview } from "@/lib/overview";
import { getPendingApprovals } from "@/lib/agent/thread";
import { getCurrentUser } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { getDesignMode } from "@/lib/design-mode";
import { TessGreeting } from "./greeting";
import { PendingApprovals } from "./pending-approvals";
import { OverviewFilament } from "./overview-filament";
import { RefreshButton } from "./refresh-button";

export const metadata = { title: "Site Overview" };
export const dynamic = "force-dynamic";

const uptimeTone: Record<string, string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-rose-500",
  unknown: "text-muted-foreground",
  unconfigured: "text-muted-foreground",
};

// The owner's radiant KPI palette. Each tile owns a fixed, vivid hue (problem state
// is read from the count, not the colour). `dark` tiles use ink text for contrast
// on the bright green/amber.
const KPIS = [
  { key: "critical", label: "Critical alerts", icon: ShieldAlert, href: "/site-health", from: "#f50505", to: "#ff5252", dark: false },
  { key: "warning", label: "Warnings", icon: TriangleAlert, href: "/site-health", from: "#ffb200", to: "#ffd24d", dark: true },
  { key: "pendingApprovals", label: "Replies to approve", icon: MailCheck, href: "/inbox", from: "#05f559", to: "#62ff95", dark: true },
  { key: "jobsFailing", label: "Jobs failing", icon: ListChecks, href: "/jobs", from: "#5f37fa", to: "#8a6bff", dark: false },
] as const;

export default async function SiteOverviewPage() {
  const scope = await getSiteScope();
  const [{ sites, global }, user, approvals, design] = await Promise.all([getOverview(scope), getCurrentUser(), getPendingApprovals(), getDesignMode()]);
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] || "there";

  if (design === "filament") {
    return <OverviewFilament sites={sites} global={global} approvals={approvals} firstName={firstName} />;
  }

  const online = global.consoleStatus === "up";

  return (
    <div data-section="overview" className="flex flex-1 flex-col gap-6 p-6">
      <TessGreeting name={firstName} />

      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Site Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scope === "all" ? "All three properties at a glance." : `Scoped to ${SITE_META[scope as SiteKey].name} — switch back to All Sites in the top bar.`}
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
          <ServerCog className="size-3.5" />
          <span className="relative flex size-2">
            {online && <span className="absolute inline-flex size-full animate-ping rounded-full opacity-60" style={{ background: "#05f559" }} />}
            <span className="relative inline-flex size-2 rounded-full" style={{ background: online ? "#05f559" : "#ff5252" }} />
          </span>
          Console <span className={uptimeTone[global.consoleStatus]}>{online ? "online" : global.consoleStatus}</span>
        </span>
      </div>

      {/* Hero — the day's headline number with a live 7-day trend */}
      <div className="relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border p-4">
        <div>
          <div className="text-xs text-muted-foreground">Visitors today · {scope === "all" ? "all sites" : SITE_META[scope as SiteKey].name}</div>
          <div className="mt-1 flex items-end gap-2.5">
            <span className="text-3xl font-extrabold tabular-nums" style={{ color: "var(--primary)" }}>{global.visitorsToday.toLocaleString()}</span>
            <DeltaChip pct={global.visitorsDeltaPct} />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">last 7 days</div>
        </div>
        <Sparkline data={global.visitors7d} color="var(--primary)" w={190} h={46} />
      </div>

      {/* Global action strip — radiant, one fixed hue per metric */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {KPIS.map((k) => (
          <KpiTile key={k.key} href={k.href} icon={k.icon} label={k.label} value={(global as unknown as Record<string, number>)[k.key]} from={k.from} to={k.to} dark={k.dark} />
        ))}
      </div>

      {/* Per-site live cards */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {sites.map((s) => (
          <SiteCard key={s.site} s={s} />
        ))}
      </div>

      <PendingApprovals items={approvals} />

      {/* Recent activity — colour-coded by module */}
      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <Link href="/audit" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">Audit log <ArrowUpRight className="size-3" /></Link>
        </div>
        {global.recent.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="divide-y">
            {global.recent.map((r, i) => <ActivityRow key={i} r={r} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, w = 96, h = 28 }: { data: number[]; color: string; w?: number; h?: number }) {
  const pts = data && data.length > 1 ? data : [0, 0];
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = max - min || 1;
  const stepX = w / (pts.length - 1);
  const coords = pts.map((v, i) => `${(i * stepX).toFixed(1)},${(h - 3 - ((v - min) / range) * (h - 6)).toFixed(1)}`);
  const flat = max === 0;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ overflow: "visible" }}>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: flat ? 0.35 : 1, filter: flat ? undefined : `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}

function DeltaChip({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className="rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: up ? "rgba(5,245,89,0.14)" : "rgba(245,5,5,0.16)", color: up ? "#05f559" : "#ff5252" }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function KpiTile({ href, icon: Icon, label, value, from, to, dark }: { href: string; icon: typeof Activity; label: string; value: number; from: string; to: string; dark: boolean }) {
  const fg = dark ? "#0a160c" : "#ffffff";
  return (
    <Link
      href={href}
      className="relative flex items-center gap-3 overflow-hidden rounded-xl p-3.5 ring-1 ring-white/15 transition-transform hover:-translate-y-0.5"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})`, color: fg, boxShadow: `0 10px 30px -10px ${from}cc` }}
    >
      <div aria-hidden className="pointer-events-none absolute -right-5 -top-7 size-24 rounded-full bg-white/20" />
      <div aria-hidden className="pointer-events-none absolute -left-3 bottom-0 size-14 rounded-full bg-black/10" />
      <Icon className="relative size-5" style={{ opacity: 0.92 }} />
      <div className="relative min-w-0">
        <div className="text-xl font-bold tabular-nums">{value}</div>
        <div className="truncate text-[11px] font-medium" style={{ opacity: 0.92 }}>{label}</div>
      </div>
    </Link>
  );
}

function Metric({ href, icon: Icon, value, label, brand, muted }: { href: string; icon: typeof Activity; value: React.ReactNode; label: string; brand: string; muted?: boolean }) {
  return (
    <Link href={href} className="flex flex-col gap-1 rounded-lg border p-2.5 transition-colors hover:bg-white/5" style={{ background: `color-mix(in srgb, ${brand} 7%, transparent)` }}>
      <Icon className="size-4" style={{ color: brand, opacity: muted ? 0.45 : 0.95 }} />
      <span className={`text-lg font-semibold tabular-nums ${muted ? "text-muted-foreground/50" : ""}`}>{value}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">{label}</span>
    </Link>
  );
}

function SiteCard({ s }: { s: SiteOverview }) {
  const meta = SITE_META[s.site];
  const brand = `var(--site-${s.site})`;
  const uptimeText = s.uptimeStatus === "up" ? (s.uptime24h != null ? `${s.uptime24h}%` : "up") : s.uptimeStatus === "down" ? "DOWN" : "—";
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5" style={{ boxShadow: `0 16px 34px -22px ${brand}` }}>
      {/* brand-tinted header */}
      <div className="relative flex items-start justify-between gap-2 p-5 pb-3" style={{ background: `linear-gradient(120deg, color-mix(in srgb, ${brand} 22%, transparent), transparent 80%)` }}>
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: brand, boxShadow: `0 0 9px ${brand}` }} />
          <h2 className="text-base font-semibold">{s.name}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <RefreshButton label={`Refresh ${s.name} data`} />
          <a href={`https://${s.domain}`} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta?.chip ?? "bg-muted text-muted-foreground"} transition-opacity hover:opacity-80`}>
            {s.domain}<ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 pb-5">
        {/* hero metric: visitors today + 7-day sparkline + delta */}
        <Link href="/analytics" className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-extrabold tabular-nums" style={{ color: brand }}>{s.visitorsToday.toLocaleString()}</span>
              <DeltaChip pct={s.visitorsDeltaPct} />
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">visitors today</div>
          </div>
          <Sparkline data={s.visitors7d} color={brand} w={104} h={34} />
        </Link>

        {/* secondary metrics */}
        <div className="grid grid-cols-3 gap-2">
          <Metric href="/site-health" icon={Activity} value={<span className={uptimeTone[s.uptimeStatus]}>{uptimeText}</span>} label="Uptime 24h" brand={brand} />
          <Metric href="/seo" icon={Search} value={s.indexedPages.toLocaleString()} label="Indexed" muted={s.indexedPages === 0} brand={brand} />
          <Metric href="/seo" icon={MousePointerClick} value={s.clicks7d.toLocaleString()} label="GSC clicks 7d" muted={s.clicks7d === 0} brand={brand} />
          <Metric href="/inbox" icon={Mail} value={s.needsReply} label="Replies needed" muted={s.needsReply === 0} brand={brand} />
          <Metric href="/social" icon={Megaphone} value={s.scheduledPosts} label="Posts scheduled" muted={s.scheduledPosts === 0} brand={brand} />
          <Metric href="/analytics" icon={ChartLine} value={s.visitorsToday.toLocaleString()} label="Visitors today" brand={brand} />
        </div>
      </div>
    </div>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────
const MODULE: Record<string, { color: string; label: string }> = {
  social: { color: "#c061ff", label: "social" },
  content: { color: "#2af0c8", label: "content" },
  demo: { color: "#fb7185", label: "demo" },
  youtube: { color: "#ff5252", label: "youtube" },
  seo: { color: "#34d8f0", label: "seo" },
  gsc: { color: "#34d8f0", label: "seo" },
  inbox: { color: "#5b9dff", label: "mail" },
  email: { color: "#5b9dff", label: "mail" },
  mail: { color: "#5b9dff", label: "mail" },
  outreach: { color: "#5b9dff", label: "outreach" },
  vps: { color: "#ffb200", label: "vps" },
  server: { color: "#ffb200", label: "vps" },
  job: { color: "#5f37fa", label: "jobs" },
  feedback: { color: "#05f559", label: "feedback" },
};
const AV = ["#5f37fa", "#05f559", "#ffb200", "#5b9dff", "#c061ff", "#fb7185"];
function avColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}

function ActivityRow({ r }: { r: GlobalOverview["recent"][number] }) {
  const mod = MODULE[r.action.split(".")[0]] ?? { color: "#9b93b8", label: r.action.split(".")[0] || "system" };
  const ac = avColor(r.actor || "?");
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: ac, color: "#0a0a12" }}>
        {(r.actor || "?").charAt(0).toUpperCase()}
      </span>
      <span className="font-medium">{r.actor}</span>
      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${mod.color} 18%, transparent)`, color: mod.color }}>{mod.label}</span>
      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{r.action}</code>
      {r.target && <span className="truncate text-xs text-muted-foreground">{r.target}</span>}
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{relativeTime(new Date(r.at))}</span>
    </li>
  );
}
