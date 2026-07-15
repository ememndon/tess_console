import Link from "next/link";
import { headers } from "next/headers";
import {
  Users,
  Eye,
  Gauge,
  TriangleAlert,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Radio,
  MousePointerClick,
  FileWarning,
  Globe,
  Code2,
} from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, SITE_KEYS, type SiteKey, type SiteScope } from "@/lib/site-scope";
import {
  getKpis,
  getTimeseries,
  getRealtime,
  hasAnyEvents,
  getTopPages,
  getReferrers,
  getUtmSources,
  getGeo,
  getDevices,
  getBrowsers,
  getEventNames,
  getNotFound,
  getErrors,
  getEventProps,
  getEmbeds,
  listVisitors,
  RANGES,
  ALGO_UPDATES,
  type Range,
  type Bar,
} from "@/lib/analytics";
import { relativeTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import { tileGradientClass, tileGlowShadow, type TileColor } from "@/components/stat-tile";
import { ExportCsv } from "@/components/export-csv";
import { AutoRefresh } from "@/components/analytics/auto-refresh";
import { LiveStrip } from "@/components/analytics/live-strip";
import { VisitorExplorer } from "@/components/analytics/visitor-explorer";
import { SnippetBox } from "@/components/analytics/snippet-box";
import { InstallVerify } from "./install-verify";
import { CollapsibleCard } from "@/components/analytics/collapsible-card";
import { getDesignMode } from "@/lib/design-mode";
import { AnalyticsFilament } from "./analytics-filament";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const SECTIONS = [
  { key: "pages", label: "Pages", icon: Eye },
  { key: "visitors", label: "Visitors", icon: Users },
  { key: "sources", label: "Sources", icon: ArrowUpRight },
  { key: "audience", label: "Audience", icon: Globe },
  { key: "events", label: "Events", icon: MousePointerClick },
  { key: "errors", label: "Errors", icon: TriangleAlert },
  { key: "embeds", label: "Embeds", icon: Code2 },
  { key: "install", label: "Install", icon: Code2 },
] as const;

function flag(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Full country name from a 2-letter ISO code (e.g. "NG" → "Nigeria"). The geo
// rows store the code (or the literal "Unknown"); show the readable name.
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code; // "Unknown" or anything unexpected
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

function pct(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prev) / prev) * 100);
}

function Delta({ now, prev }: { now: number; prev: number }) {
  const d = pct(now, prev);
  if (d === null)
    return <span className="text-[11px] text-muted-foreground">new</span>;
  const up = d > 0;
  const flat = d === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const tone = flat ? "text-muted-foreground" : up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] ${tone}`}>
      <Icon className="size-3" />
      {Math.abs(d)}%
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  sub,
  color = "violet",
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  delta?: React.ReactNode;
  sub?: string;
  color?: TileColor;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${tileGradientClass(color)} p-4 text-white`} style={{ boxShadow: tileGlowShadow(color) }}>
      <div aria-hidden className="pointer-events-none absolute -right-5 -top-7 size-24 rounded-full bg-white/15" />
      <div className="pointer-events-none absolute right-7 top-7 size-12 rounded-full bg-white/10" aria-hidden />
      <div className="relative flex items-center gap-1.5 text-xs font-medium text-white/85">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="relative mt-1.5 flex items-end gap-2">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        <span className="pb-0.5 [&_*]:!text-white/90">{delta}</span>
      </div>
      {sub && <span className="relative mt-0.5 block text-[11px] font-medium text-white/80">{sub}</span>}
    </div>
  );
}

function BarList({
  title,
  rows,
  render,
  showUv = true,
  empty = "No data in this range yet.",
  action,
}: {
  title: string;
  rows: Bar[];
  render?: (key: string) => React.ReactNode;
  showUv?: boolean;
  empty?: string;
  action?: React.ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader className={action ? "flex-row items-center justify-between pb-2" : "pb-2"}>
        <CardTitle className="text-sm">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="py-0">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.key} className="relative py-2">
                <div
                  className="absolute inset-y-1 left-0 rounded-sm bg-primary/[0.08]"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
                <div className="relative flex items-center justify-between gap-3 px-1 text-sm">
                  <span className="truncate">{render ? render(r.key) : r.key}</span>
                  <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                    <span>{r.count.toLocaleString()}</span>
                    {showUv && (
                      <span className="text-[11px] text-muted-foreground">{r.visitors.toLocaleString()} uv</span>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// The public origin that serves the tracker (t.js) / feedback (fb.js) / widget (w.js)
// scripts — i.e. what the copy-paste install snippets should point at. Normally the
// request host; but during a showcase CAPTURE the request host is the INTERNAL app
// hostname (app:3000), which must never appear in the video, so fall back to the real
// public console origin (SHOWCASE_ORIGIN, default the production console domain).
const SHOWCASE_ORIGIN = process.env.SHOWCASE_ORIGIN ?? process.env.PUBLIC_BASE_URL ?? "https://staging.tessconsole.cloud";
function consoleOrigin(host: string | null, capture: boolean): string {
  if (capture || !host || /^(app:3000|localhost|127\.0\.0\.1)/.test(host)) return SHOWCASE_ORIGIN;
  return `https://${host}`;
}

function InstallSection({ origin, scope }: { origin: string; scope: SiteScope }) {
  const keys: SiteKey[] = scope === "all" ? SITE_KEYS : [scope as SiteKey];
  return (
    <div className="flex flex-col gap-3">
      <CollapsibleCard title="Install the tracking snippet" defaultOpen>
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 text-[13px] leading-relaxed">
          <span className="font-medium">Add this to every page of the site.</span> Put the line in the shared
          layout / <code className="text-foreground">&lt;head&gt;</code> template (the part rendered on all pages) so
          every pageview is counted — not just the homepage. It loads once per page, is cookieless and &lt;&nbsp;2&nbsp;KB,
          and needs no consent banner. GA4 can stay installed in parallel as a cross-check.
        </div>
        {keys.map((k) => (
          <div key={k} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className={`size-2 rounded-full ${SITE_META[k].dot}`} />
              {SITE_META[k].name}
              <span className="text-muted-foreground">({SITE_META[k].domain})</span>
            </div>
            <SnippetBox
              label={`${SITE_META[k].name} snippet`}
              code={`<script defer data-site="${k}" src="${origin}/t.js"></script>`}
            />
            <InstallVerify siteKey={k} />
          </div>
        ))}
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Verify installation</span> pings the live
          site, confirms the snippet is in its HTML with the right <code>data-site</code>, and checks
          that the console is receiving its data.
        </p>
      </CollapsibleCard>

      <CollapsibleCard title="404 pages" hint="Track missing pages separately">
        <p className="text-muted-foreground">
          On the not-found page, swap the normal snippet for this one — add{" "}
          <code className="text-foreground">data-404</code> so misses are tracked as 404s instead of pageviews.
        </p>
        <SnippetBox label="404 snippet" code={`<script defer data-site="${keys[0]}" data-404 src="${origin}/t.js"></script>`} />
      </CollapsibleCard>

      <CollapsibleCard title="Single-page apps" hint="Count client-side route changes">
        <p className="text-muted-foreground">
          If the site navigates without full page reloads, add{" "}
          <code className="text-foreground">data-spa</code> so each in-app route change counts as a pageview.
        </p>
        <SnippetBox label="SPA snippet" code={`<script defer data-site="${keys[0]}" data-spa src="${origin}/t.js"></script>`} />
      </CollapsibleCard>

      <CollapsibleCard title="Custom events" hint="Track downloads, sign-ups, clicks…">
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 text-[13px] leading-relaxed">
          The snippet above auto-tracks pageviews, 404s and JS errors. Anything else — a download, a
          sign-up, a calculator run — is a <span className="font-medium">custom event</span> you fire
          yourself with one line. The snippet exposes a global{" "}
          <code className="text-foreground">tess()</code> function for exactly that; there is no extra
          script to install.
        </div>
        <ol className="ml-4 list-decimal space-y-2 text-[13px] leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
          <li>
            Install the base snippet above on every page — it defines{" "}
            <code className="text-foreground">tess()</code> globally.
          </li>
          <li>
            From the user action (a click, a form submit, etc.) call{" "}
            <code className="text-foreground">{`tess('event_name', { ...props })`}</code> — run it{" "}
            <span className="font-medium text-foreground">inside the handler</span>, guarded with{" "}
            <code className="text-foreground">{`if (window.tess)`}</code>.
          </li>
          <li>
            Watch them arrive on the <span className="font-medium text-foreground">Events</span> tab
            within seconds — click an event name to see the per-prop breakdown.
          </li>
        </ol>
        <p className="text-[13px] font-medium text-foreground">Example — a download button</p>
        <SnippetBox
          label="Download button"
          code={`<a id="dl-modern" href="/templates/modern.docx" download>Download</a>\n\n<script>\n  document.getElementById('dl-modern').addEventListener('click', function () {\n    if (window.tess) tess('download_template', { template: 'modern', format: 'docx' });\n  });\n</script>`}
        />
        <div className="rounded-lg border bg-muted/30 p-3 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Rules.</span> Call{" "}
          <code className="text-foreground">tess()</code> from inside a handler, never at the top of
          the page — the snippet is <code className="text-foreground">defer</code>, so it is not
          defined during the first HTML parse (this is the most common reason events never arrive).
          Keep the name short, lowercase and stable (put the changing detail in props). Name ≤ 80
          chars; props is a small flat object of strings/numbers, ≤ 4 KB.
        </div>
        <p className="text-[13px] font-medium text-foreground">More examples</p>
        <SnippetBox label="More events" code={`tess('calc_used', { calculator: 'mortgage' });\ntess('signup', { plan: 'pro' });\ntess('cta_click', { id: 'hero_get_started' });`} />
      </CollapsibleCard>

      <CollapsibleCard title={`"Was this helpful?" widget`} hint="Feeds the Feedback module">
        <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3 text-[13px] leading-relaxed">
          <span className="font-medium">Drop-in widget — paste one tag, no code.</span> It renders a
          Yes / No prompt with an optional comment box, handles the thank-you state, and posts straight
          to the <span className="font-medium">Feedback</span> module. Self-contained (isolated styles,
          no dependency on the tracker) and remembers a visitor who already answered a page.
        </div>
        <SnippetBox label="Drop-in feedback widget" code={`<script defer data-site="${keys[0]}" src="${origin}/fb.js"></script>`} />
        <div className="text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Options</span> (all optional, as attributes on
          the tag):
          <ul className="mt-1 ml-4 list-disc space-y-0.5 marker:text-muted-foreground/60">
            <li><code className="text-foreground">data-mode</code> — <code>float</code> (default, bottom-right) or <code>inline</code> (renders where the tag sits in your content)</li>
            <li><code className="text-foreground">data-target</code> — a CSS selector to mount into, e.g. <code>{`data-target="#feedback"`}</code></li>
            <li><code className="text-foreground">data-question</code> — prompt text (default <code>Was this helpful?</code>)</li>
            <li><code className="text-foreground">data-accent</code> — brand color, e.g. <code>data-accent=&quot;#2e0161&quot;</code></li>
            <li><code className="text-foreground">data-theme</code> — <code>auto</code> (default) / <code>light</code> / <code>dark</code></li>
          </ul>
        </div>
        <p className="text-[13px] font-medium text-foreground">Prefer your own buttons?</p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Skip <code className="text-foreground">fb.js</code> and call{" "}
          <code className="text-foreground">tess.feedback()</code> yourself (needs the base tracker
          snippet) — same destination.
        </p>
        <SnippetBox label="Manual API" code={`tess.feedback('helpful');\ntess.feedback('not_helpful', 'The number looked wrong');`} />
      </CollapsibleCard>

      {(scope === "all" || scope === "calculatry") && (
        <CollapsibleCard title="Calculatry widget-embed tracker" hint="Build the embed registry (backlinks)">
          <p className="text-muted-foreground">
            Ship this inside the embeddable widget (not the site pages) so every third-party site running it pings
            home — building the embed registry that feeds the backlink program.
          </p>
          <SnippetBox label="Widget tracker" code={`<script defer data-site="calculatry" src="${origin}/w.js"></script>`} />
        </CollapsibleCard>
      )}
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scope = await getSiteScope();
  const hdrs = await headers();
  const host = hdrs.get("host");
  const origin = consoleOrigin(host, hdrs.get("x-tess-capture") === "1");

  const rangeRaw = Number(Array.isArray(sp.range) ? sp.range[0] : sp.range);
  const range: Range = ([1, 7, 30, 90] as number[]).includes(rangeRaw) ? (rangeRaw as Range) : 7;
  const tab = (typeof sp.tab === "string" ? sp.tab : "pages") as (typeof SECTIONS)[number]["key"];
  const selectedEvent = typeof sp.event === "string" ? sp.event : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;

  const hrefWith = (over: { range?: Range; tab?: string; event?: string | null; day?: string }) => {
    const p = new URLSearchParams();
    p.set("range", String(over.range ?? range));
    p.set("tab", over.tab ?? tab);
    const ev = over.event === null ? undefined : (over.event ?? selectedEvent);
    if (ev) p.set("event", ev);
    const d = over.day ?? (tab === "visitors" ? day : undefined);
    if (d && d !== today) p.set("day", d);
    return `/analytics?${p.toString()}`;
  };

  const has = await hasAnyEvents(scope);
  const scopeName = scope === "all" ? "All sites" : SITE_META[scope as SiteKey].name;

  // First run — focus the owner on installing the snippet; auto-refresh flips to
  // the live dashboard the moment the first event lands.
  if (!has) {
    return (
      <div data-section="analytics" className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              First-party, cookieless traffic for {scopeName}. Waiting for the first event…
            </p>
          </div>
          <AutoRefresh seconds={10} />
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <Radio className="size-4 animate-pulse text-primary" />
          No data yet. Install a snippet below, then load one of the sites — it shows up here within seconds.
        </div>
        <InstallSection origin={origin} scope={scope} />
      </div>
    );
  }

  const [kpis, points, realtime] = await Promise.all([
    getKpis(scope, range),
    getTimeseries(scope, range),
    getRealtime(scope),
  ]);

  if ((await getDesignMode()) === "filament") {
    return (
      <AnalyticsFilament
        scope={scope}
        range={range}
        scopeName={scopeName}
        kpis={kpis}
        points={points}
        realtime={realtime}
        tab={tab}
        hrefWith={hrefWith}
        sections={SECTIONS}
        deepDives={<Section tab={tab} scope={scope} range={range} origin={origin} selectedEvent={selectedEvent} day={day} hrefWith={hrefWith} />}
      />
    );
  }

  return (
    <div data-section="analytics" className="flex flex-1 flex-col gap-6 p-6">
      {/* Header + range */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            First-party, cookieless traffic for {scopeName}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border bg-card p-1">
            {RANGES.map((r) => (
              <Link
                key={r.value}
                href={hrefWith({ range: r.value })}
                scroll={false}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  r.value === range ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Unique visitors"
          color="violet"
          value={kpis.visitors.toLocaleString()}
          delta={<Delta now={kpis.visitors} prev={kpis.prevVisitors} />}
        />
        <KpiCard
          icon={Eye}
          label="Pageviews"
          color="orange"
          value={kpis.pageviews.toLocaleString()}
          delta={<Delta now={kpis.pageviews} prev={kpis.prevPageviews} />}
        />
        <KpiCard
          icon={Gauge}
          label="Avg load time"
          color="emerald"
          value={kpis.avgLoadMs == null ? "—" : `${(kpis.avgLoadMs / 1000).toFixed(2)}s`}
          sub={`${kpis.events.toLocaleString()} custom events`}
        />
        <KpiCard
          icon={TriangleAlert}
          label="JS errors"
          color="cyan"
          value={kpis.errors.toLocaleString()}
          sub={kpis.errors > 0 ? "see Errors tab" : "none in range"}
        />
      </div>

      {/* Traffic chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">Traffic over time</CardTitle>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-primary/30" /> pageviews</span>
            <span className="flex items-center gap-1"><span className="inline-block h-px w-3 border-t border-dashed border-foreground/50" /> visitors</span>
          </div>
        </CardHeader>
        <CardContent>
          <TrafficChart points={points} hourly={range === 1} annotations={ALGO_UPDATES} />
        </CardContent>
      </Card>

      {/* Real-time strip — self-refreshes every 5s via its own lightweight endpoint */}
      <LiveStrip scope={scope} initial={realtime} showSite={scope === "all"} />

      {/* Section nav */}
      <div className="flex flex-wrap gap-1 border-b">
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            href={hrefWith({ tab: s.key, event: null })}
            scroll={false}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              s.key === tab
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <s.icon className="size-3.5" />
            {s.label}
          </Link>
        ))}
      </div>

      <Section tab={tab} scope={scope} range={range} origin={origin} selectedEvent={selectedEvent} day={day} hrefWith={hrefWith} />
    </div>
  );
}

async function Section({
  tab,
  scope,
  range,
  origin,
  selectedEvent,
  day,
  hrefWith,
}: {
  tab: string;
  scope: SiteScope;
  range: Range;
  origin: string;
  selectedEvent?: string;
  day: string;
  hrefWith: (o: { range?: Range; tab?: string; event?: string | null; day?: string }) => string;
}) {
  if (tab === "install") return <InstallSection origin={origin} scope={scope} />;

  if (tab === "visitors") {
    const visitors = await listVisitors(scope, day);
    // Day picker: the last 7 UTC days, newest first.
    const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    const today = days[0];
    const label = (d: string) => (d === today ? "Today" : d === days[1] ? "Yesterday" : new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }));
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <Link
              key={d}
              href={hrefWith({ tab: "visitors", day: d })}
              scroll={false}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${d === day ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label(d)}
            </Link>
          ))}
        </div>
        <VisitorExplorer scope={scope} day={day} visitors={visitors} showSite={scope === "all"} />
      </div>
    );
  }

  if (tab === "pages") {
    const [pages, notFound] = await Promise.all([getTopPages(scope, range), getNotFound(scope, range)]);
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <BarList
          title="Top pages"
          rows={pages}
          render={(k) => <span className="font-mono text-xs">{k}</span>}
          action={<ExportCsv filename="top-pages.csv" rows={pages.map((p) => ({ page: p.key, views: p.count }))} />}
        />
        <BarList
          title="Top 404s (missing pages)"
          rows={notFound}
          showUv={false}
          empty="No 404s tracked yet — add data-404 to your not-found page."
          render={(k) => (
            <span className="flex items-center gap-1.5 font-mono text-xs">
              <FileWarning className="size-3 text-amber-500" />
              {k}
            </span>
          )}
        />
      </div>
    );
  }

  if (tab === "sources") {
    const [refs, utm] = await Promise.all([getReferrers(scope, range), getUtmSources(scope, range)]);
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <BarList title="Referrers" rows={refs} empty="No external referrers yet — most traffic is direct." />
        <BarList title="UTM sources" rows={utm} empty="No campaign-tagged traffic yet." />
      </div>
    );
  }

  if (tab === "audience") {
    const [geo, devices, browsers] = await Promise.all([
      getGeo(scope, range),
      getDevices(scope, range),
      getBrowsers(scope, range),
    ]);
    return (
      <div className="grid gap-5 lg:grid-cols-3">
        <BarList
          title="Countries"
          rows={geo}
          render={(k) => (
            <span className="flex items-center gap-2">
              <span>{flag(k)}</span>
              {countryName(k)}
            </span>
          )}
        />
        <BarList title="Devices" rows={devices} showUv={false} render={(k) => <span className="capitalize">{k}</span>} />
        <BarList title="Browsers" rows={browsers} showUv={false} />
      </div>
    );
  }

  if (tab === "events") {
    const names = await getEventNames(scope, range);
    const active = selectedEvent ?? names[0]?.key;
    const props = active ? await getEventProps(scope, range, active) : [];
    // Group prop values by prop key (top 6 each).
    const byProp = new Map<string, { val: string; count: number }[]>();
    for (const p of props) {
      const arr = byProp.get(p.prop) ?? [];
      if (arr.length < 6) arr.push({ val: p.val, count: p.count });
      byProp.set(p.prop, arr);
    }
    return (
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Custom events</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            {names.length === 0 ? (
              <p className="py-8 text-center text-xs leading-relaxed text-muted-foreground">
                No custom events yet. Add a one-line <code>tess(&apos;name&apos;, props)</code> call to your
                sites —{" "}
                <Link href={hrefWith({ tab: "install" })} scroll={false} className="text-primary underline-offset-2 hover:underline">
                  see Install → Custom events
                </Link>{" "}
                for steps.
              </p>
            ) : (
              <ul className="divide-y">
                {names.map((e) => (
                  <li key={e.key}>
                    <Link
                      href={hrefWith({ tab: "events", event: e.key })}
                      scroll={false}
                      className={`flex items-center justify-between gap-2 py-2 text-sm transition-colors hover:text-foreground ${
                        e.key === active ? "font-medium text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <span className="truncate font-mono text-xs">{e.key}</span>
                      <span className="shrink-0 tabular-nums">{e.count.toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {active ? <>Properties of <code className="font-mono">{active}</code></> : "Properties"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {!active ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Select an event to explore its properties.</p>
            ) : byProp.size === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">This event has no properties.</p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2">
                {[...byProp.entries()].map(([prop, vals]) => {
                  const max = Math.max(1, ...vals.map((v) => v.count));
                  return (
                    <div key={prop}>
                      <p className="mb-1.5 font-mono text-xs text-muted-foreground">{prop}</p>
                      <ul className="divide-y">
                        {vals.map((v) => (
                          <li key={v.val} className="relative py-1.5">
                            <div className="absolute inset-y-0.5 left-0 rounded-sm bg-primary/[0.08]" style={{ width: `${(v.count / max) * 100}%` }} />
                            <div className="relative flex items-center justify-between gap-2 px-1 text-xs">
                              <span className="truncate">{v.val}</span>
                              <span className="tabular-nums">{v.count.toLocaleString()}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tab === "errors") {
    const errors = await getErrors(scope, range);
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">JS errors (grouped by message)</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {errors.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No JavaScript errors captured in this range. 🎉</p>
          ) : (
            <ul className="divide-y">
              {errors.map((e, i) => (
                <li key={i} className="flex items-start gap-3 py-3">
                  <Badge variant="destructive" className="shrink-0 tabular-nums">
                    {e.count}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{e.message}</p>
                    <p className="text-[11px] text-muted-foreground">
                      last on <span className="font-mono">{e.lastPath ?? "—"}</span> · {relativeTime(new Date(e.lastSeen))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  if (tab === "embeds") {
    const embeds = await getEmbeds(scope);
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Widget-embed registry</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {embeds.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No embeds detected yet. Ship the widget tracker (Install tab) inside Calculatry&apos;s embeddable widgets.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {embeds.map((e) => (
                <li key={`${e.site}-${e.host}`} className="flex items-center gap-3 py-2.5">
                  <Code2 className="size-4 shrink-0 text-muted-foreground" />
                  <a
                    href={`https://${e.host}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                  >
                    {e.host}
                  </a>
                  {scope === "all" && (
                    <span className={`shrink-0 text-[11px] ${SITE_META[e.site as SiteKey]?.text ?? ""}`}>
                      {SITE_META[e.site as SiteKey]?.name ?? e.site}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{e.hits.toLocaleString()} pings</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">seen {relativeTime(new Date(e.lastSeen))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  return null;
}
