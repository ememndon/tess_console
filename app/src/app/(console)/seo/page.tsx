import Link from "next/link";
import {
  Search,
  Gauge,
  ListChecks,
  Code2,
  FileText,
  Layers,
  Link2,
  TrendingUp,
  ExternalLink,
  CircleCheck,
} from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, SITE_KEYS, type SiteKey, type SiteScope } from "@/lib/site-scope";
import {
  getDirectories,
  getContentInventory,
  getSeoOverview,
  getGscConnection,
  getGscPerformance,
  getTopQueries,
  getTopGscPages,
  getOpportunities,
  getIndexCoverage,
  type Directory,
  type GscRow,
  type GscConnection,
} from "@/lib/seo";
import { getEmbeds } from "@/lib/analytics";
import { relativeTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile, TILE_COLORS } from "@/components/stat-tile";
import { SectionHeader } from "@/components/filament/section-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import { ConnectGsc } from "@/components/seo/connect-gsc";
import { ExportCsv } from "@/components/export-csv";
import { DirectoryRow } from "./directory-row";

export const metadata = { title: "SEO Center" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview", icon: Gauge },
  { key: "search", label: "Search", icon: Search },
  { key: "index", label: "Index coverage", icon: Layers },
  { key: "opportunities", label: "Opportunities", icon: TrendingUp },
  { key: "backlinks", label: "Backlinks", icon: Link2 },
  { key: "embeds", label: "Embed program", icon: Code2 },
  { key: "directories", label: "Directories", icon: ListChecks },
  { key: "content", label: "Content", icon: FileText },
] as const;

const dirTone: Record<Directory["status"], string> = {
  todo: "bg-muted-foreground/40",
  submitted: "bg-amber-500",
  listed: "bg-emerald-500",
  rejected: "bg-rose-500",
  na: "bg-muted-foreground/20",
};

// Search-tab time windows (resolved from GSC daily data). 24h is offered per
// request; Search Console data lags ~2 days, so short windows are often sparse.
const SEARCH_RANGES = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;
const SEARCH_RANGE_DAYS: readonly number[] = SEARCH_RANGES.map((r) => r.days);

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scope = await getSiteScope();
  const tab = (typeof sp.tab === "string" ? sp.tab : "overview") as (typeof TABS)[number]["key"];
  const rangeRaw = Number(typeof sp.range === "string" ? sp.range : 30);
  const range = SEARCH_RANGE_DAYS.includes(rangeRaw) ? rangeRaw : 30;
  const scopeName = scope === "all" ? "all sites" : SITE_META[scope as SiteKey].name;

  return (
    <div data-section="seo" className="flex flex-1 flex-col gap-6 p-6">
      <SectionHeader title="SEO Center" register="SURFACE">
        Search performance, index coverage, links, and content for {scopeName}. The Search-Console views connect once
        you authorize GSC; the embed program, directories and content inventory are live now.
      </SectionHeader>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/seo?tab=${t.key}`}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
              t.key === tab
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </Link>
        ))}
      </div>

      <SeoSection tab={tab} scope={scope} range={range} />
    </div>
  );
}

async function SeoSection({ tab, scope, range }: { tab: string; scope: SiteScope; range: number }) {
  if (tab === "overview") {
    const [o, gsc] = await Promise.all([getSeoOverview(scope), getGscConnection()]);
    const tiles = [
      { icon: FileText, label: "Pages in inventory", value: o.contentPages, href: "/seo?tab=content" },
      { icon: Code2, label: "Sites embedding widgets", value: o.embedDomains, href: "/seo?tab=embeds" },
      { icon: ListChecks, label: "Directory listings live", value: `${o.dirsListed}/${o.dirsTotal}`, href: "/seo?tab=directories" },
      { icon: Search, label: "Competitor pages tracked", value: o.competitorPages, href: "/competitors" },
    ];
    return (
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t, i) => (
            <Link key={t.label} href={t.href} className="transition-transform hover:-translate-y-0.5">
              <StatTile icon={t.icon} label={t.label} value={t.value} color={TILE_COLORS[i % TILE_COLORS.length]} />
            </Link>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Google Search Console</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {!gsc.keySet ? (
              <p className="text-muted-foreground">
                Not connected. Paste your service-account key in{" "}
                <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
                  Settings → Search &amp; SEO
                </Link>
                , then add its <code>client_email</code> as a user on each property. Powers the Search, Index coverage,
                Opportunities and Backlinks tabs (incl. GlobalResumeHub&apos;s X-of-195).
              </p>
            ) : gsc.connected ? (
              <p className="text-emerald-600 dark:text-emerald-400">Service-account key connected.</p>
            ) : (
              <p className="text-amber-600 dark:text-amber-400">
                Key saved but not verified — hit Test in{" "}
                <Link href="/settings" className="underline underline-offset-2">
                  Settings
                </Link>{" "}
                and confirm the service account is a user on each property.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              {SITE_KEYS.map((k) => {
                const c = gsc.sites[k];
                const enabled = !!c?.enabled;
                return (
                  <div key={k} className="flex items-center gap-2 rounded-lg border p-2.5">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        enabled ? (gsc.connected ? "bg-emerald-500" : "bg-amber-500") : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{SITE_META[k].name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {enabled ? (gsc.connected ? "ready to sync" : "awaiting key") : c?.note ?? "disabled"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tab === "search") {
    const [conn, perf, queries, pages] = await Promise.all([
      getGscConnection(),
      getGscPerformance(scope, range),
      getTopQueries(scope, range),
      getTopGscPages(scope, range),
    ]);
    const rangeLabel = SEARCH_RANGES.find((r) => r.days === range)?.label ?? `${range}d`;
    const rangePills = (
      <div className="flex items-center gap-0.5 rounded-full border p-0.5 text-xs">
        {SEARCH_RANGES.map((r) => (
          <Link
            key={r.days}
            href={`/seo?tab=search&range=${r.days}`}
            scroll={false}
            className={`rounded-full px-3 py-1 transition-colors ${
              range === r.days ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>
    );
    if (perf.points.length === 0) {
      return (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Search performance</h2>
            {rangePills}
          </div>
          {conn.keySet ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No Search Console data in the last {rangeLabel}. GSC data lags ~2 days, so short windows are often empty — try a longer range.
              </CardContent>
            </Card>
          ) : (
            <GscEmpty conn={conn} scope={scope} what="search performance" />
          )}
        </div>
      );
    }
    const chartPoints = perf.points.map((p) => ({ t: p.t, pageviews: p.impressions, visitors: p.clicks }));
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">
            Search performance <span className="text-muted-foreground">· last {rangeLabel}</span>
          </h2>
          {rangePills}
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Kpi label="Clicks" value={perf.clicks.toLocaleString()} sub={perf.prevClicks > 0 ? `prev ${rangeLabel}: ${perf.prevClicks.toLocaleString()}` : undefined} />
          <Kpi label="Impressions" value={perf.impressions.toLocaleString()} sub={perf.prevImpressions > 0 ? `prev ${rangeLabel}: ${perf.prevImpressions.toLocaleString()}` : undefined} />
          <Kpi label="Avg CTR" value={`${(perf.ctr * 100).toFixed(1)}%`} />
          <Kpi label="Avg position" value={perf.position == null ? "—" : perf.position.toFixed(1)} />
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">Clicks &amp; impressions</CardTitle>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm bg-primary/30" /> impressions</span>
              <span className="flex items-center gap-1"><span className="inline-block h-px w-3 border-t border-dashed border-foreground/50" /> clicks</span>
            </div>
          </CardHeader>
          <CardContent>
            <TrafficChart points={chartPoints} hourly={false} aLabel="impressions" bLabel="clicks" />
          </CardContent>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2">
          <GscTable title={`Top queries · ${rangeLabel}`} rows={queries} rangeLabel={rangeLabel} />
          <GscTable title={`Top pages · ${rangeLabel}`} rows={pages} pathMode rangeLabel={rangeLabel} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Clicks, impressions, CTR and position — and the top queries and pages — all reflect the selected range, from
          Search Console. CTR and position are impression-weighted. Note: GSC data lags ~2 days, so 24h and 7d are often
          sparse.
        </p>
      </div>
    );
  }

  if (tab === "index") {
    const [conn, cov] = await Promise.all([getGscConnection(), getIndexCoverage(scope)]);
    if (!conn.keySet)
      return (
        <ConnectGsc title="Index coverage — including GlobalResumeHub's country pages">
          See how many of each site&apos;s pages appear in Google Search, plus sitemap status. Connect Search Console to
          populate this.
        </ConnectGsc>
      );
    return (
      <div className="flex flex-col gap-4">
        {cov.map((c) => {
          const cfg = conn.sites[c.site];
          const pct = c.total > 0 ? Math.round((c.indexed / c.total) * 100) : 0;
          return (
            <Card key={c.site}>
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <span className={`size-2 rounded-full ${SITE_META[c.site as SiteKey]?.dot ?? "bg-muted"}`} />
                    {SITE_META[c.site as SiteKey]?.name ?? c.site}
                  </span>
                  <span>
                    {cfg?.enabled ? (
                      <>
                        <span className="font-semibold tabular-nums">{c.indexed.toLocaleString()}</span>
                        <span className="text-muted-foreground"> / {c.total.toLocaleString()} appearing in Search</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">not connected (separate account)</span>
                    )}
                  </span>
                </div>
                {cfg?.enabled && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {c.site === "resumehub" && cfg?.enabled && (
                  <p className="text-[11px] text-muted-foreground">
                    Includes the per-country pages — this is the X-of-195 coverage signal.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        <p className="text-[11px] text-muted-foreground">
          &quot;Appearing in Search&quot; = the page has Search impressions in the last 28 days — a free proxy for
          indexing. Strict per-URL index status (via URL Inspection) is a later enhancement.
        </p>
      </div>
    );
  }

  if (tab === "opportunities") {
    const [conn, opps] = await Promise.all([getGscConnection(), getOpportunities(scope)]);
    if (opps.length === 0) return <GscEmpty conn={conn} scope={scope} what="opportunity" />;
    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 pb-2">
          <div>
            <CardTitle className="text-sm">Keyword opportunities</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Queries at positions 8–25 (&quot;almost ranking&quot;), ranked by impressions × proximity to page one —
              strengthen these pages for the fastest wins.
            </p>
          </div>
          <ExportCsv
            filename="keyword-opportunities.csv"
            rows={opps.map((o) => ({ query: o.key, site: SITE_META[o.site as SiteKey]?.name ?? o.site, impressions: o.impressions, position: Number(o.position.toFixed(1)), ctr_pct: Number((o.ctr * 100).toFixed(1)) }))}
          />
        </CardHeader>
        <CardContent className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                {scope === "all" && <TableHead className="hidden sm:table-cell">Site</TableHead>}
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Position</TableHead>
                <TableHead className="hidden text-right md:table-cell">CTR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opps.map((o, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-xs truncate text-xs">{o.key}</TableCell>
                  {scope === "all" && (
                    <TableCell className={`hidden sm:table-cell text-xs ${SITE_META[o.site as SiteKey]?.text ?? ""}`}>
                      {SITE_META[o.site as SiteKey]?.name}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{o.impressions.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.position.toFixed(1)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{(o.ctr * 100).toFixed(1)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  if (tab === "backlinks") {
    const embeds = await getEmbeds(scope);
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <Link2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">Backlinks via the embed program + manual entry</p>
              <p className="text-muted-foreground">
                Search Console&apos;s API doesn&apos;t expose the external-links report, so the console tracks backlinks
                through the Calculatry widget-embed registry below (every site running a widget links back). The full GSC
                links report stays available in the Search Console UI.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Embedding domains</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            {embeds.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No embeds detected yet — ship the widget tracker (Analytics → Install) inside the embeddable widgets.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {embeds.map((e) => (
                  <li key={`${e.site}-${e.host}`} className="flex items-center gap-3 py-2.5">
                    <Link2 className="size-4 shrink-0 text-muted-foreground" />
                    <a href={`https://${e.host}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs hover:underline">
                      {e.host}
                    </a>
                    <span className="shrink-0 text-[11px] text-muted-foreground">seen {relativeTime(new Date(e.lastSeen))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tab === "embeds") {
    const embeds = await getEmbeds(scope);
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Widget-embed program (Calculatry backlink engine)</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {embeds.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No embeds detected yet. Ship the widget tracker (Analytics → Install) inside Calculatry&apos;s embeddable
              widgets — every third-party site running it appears here as a backlink prospect.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {embeds.map((e) => (
                <li key={`${e.site}-${e.host}`} className="flex items-center gap-3 py-2.5">
                  <Code2 className="size-4 shrink-0 text-muted-foreground" />
                  <a href={`https://${e.host}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs hover:underline">
                    {e.host}
                  </a>
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

  if (tab === "directories") {
    const dirs = await getDirectories(scope);
    if (scope === "all") {
      // Matrix: one row per directory, per-site status dots (scope to a site to edit).
      const byName = new Map<string, Directory[]>();
      for (const d of dirs) {
        const arr = byName.get(d.name) ?? [];
        arr.push(d);
        byName.set(d.name, arr);
      }
      return (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Directory &amp; listing pipeline</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            <p className="border-b py-2 text-[11px] text-muted-foreground">
              Switch to a specific site (top bar) to update its submission status.
            </p>
            <ul className="divide-y text-sm">
              {[...byName.entries()].map(([name, list]) => (
                <li key={name} className="flex items-center justify-between gap-3 py-2.5">
                  <a href={list[0].url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">
                    {name} <ExternalLink className="size-3 text-muted-foreground" />
                  </a>
                  <div className="flex items-center gap-3">
                    {list.map((d) => (
                      <span key={d.site} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span className={`size-1.5 rounded-full ${dirTone[d.status]}`} />
                        {SITE_META[d.site as SiteKey]?.name ?? d.site}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      );
    }
    // Scoped: editable per category.
    const cats = [...new Set(dirs.map((d) => d.category))];
    return (
      <div className="flex flex-col gap-4">
        {cats.map((cat) => (
          <Card key={cat}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{cat}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y py-0">
              {dirs.filter((d) => d.category === cat).map((d) => (
                <DirectoryRow key={d.id} dir={d} />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // (content tab below)
  return contentTab(tab, scope);
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-0.5 p-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </CardContent>
    </Card>
  );
}

function GscTable({ title, rows, pathMode, rangeLabel }: { title: string; rows: GscRow[]; pathMode?: boolean; rangeLabel?: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <ExportCsv
          filename={`${pathMode ? "gsc-pages" : "gsc-queries"}.csv`}
          rows={rows.map((r) => ({ [pathMode ? "page" : "query"]: r.key, clicks: r.clicks, impressions: r.impressions, ctr_pct: Number((r.ctr * 100).toFixed(2)), position: Number(r.position.toFixed(1)) }))}
        />
      </CardHeader>
      <CardContent className="py-0">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No data in the last {rangeLabel ?? "28 days"}.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pathMode ? "Page" : "Query"}</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Impr.</TableHead>
                <TableHead className="hidden text-right md:table-cell">CTR</TableHead>
                <TableHead className="text-right">Pos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-[16rem] truncate text-xs">
                    {pathMode ? r.key.replace(/^https?:\/\/[^/]+/, "") || "/" : r.key}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.clicks.toLocaleString()}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.impressions.toLocaleString()}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{(r.ctr * 100).toFixed(1)}%</TableCell>
                  <TableCell className="text-right tabular-nums">{r.position.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function GscEmpty({ conn, scope, what }: { conn: GscConnection; scope: SiteScope; what: string }) {
  if (!conn.keySet)
    return (
      <ConnectGsc title={`${what[0].toUpperCase()}${what.slice(1)} from Search Console`}>
        Connect Search Console (Settings → Search &amp; SEO) to populate this. Calculatry and GlobalResumeHub are ready;
        CheckInvestNg is on a separate Google account.
      </ConnectGsc>
    );
  const msg =
    scope === "checkinvest"
      ? "CheckInvestNg isn't connected yet — its Search Console is under a separate Google account."
      : "No data for this view yet — the connected sites are young, so Search Console has little history. It fills in as impressions accrue.";
  return (
    <Card>
      <CardContent className="p-8 text-center text-sm text-muted-foreground">{msg}</CardContent>
    </Card>
  );
}

async function contentTab(tab: string, scope: SiteScope) {
  if (tab === "content") {
    const { pages, summary } = await getContentInventory(scope);
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "Pages", value: summary.total },
            { label: "With traffic (30d)", value: summary.withTraffic },
            { label: "No traffic (30d)", value: summary.noTraffic },
            { label: "Index status unknown", value: summary.indexUnknown },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="flex flex-col gap-0.5 p-4">
                <span className="text-2xl font-semibold tabular-nums">{s.value.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Content inventory</CardTitle>
          </CardHeader>
          <CardContent className="py-0">
            {pages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Empty — the content-inventory crawler runs nightly (03:00) from each site&apos;s sitemap.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    {scope === "all" && <TableHead className="hidden sm:table-cell">Site</TableHead>}
                    <TableHead className="text-right">Views 30d</TableHead>
                    <TableHead className="hidden md:table-cell">Indexed</TableHead>
                    <TableHead className="hidden lg:table-cell">Last modified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.slice(0, 200).map((p) => (
                    <TableRow key={`${p.site}-${p.url}`}>
                      <TableCell className="max-w-xs truncate font-mono text-xs">{p.path}</TableCell>
                      {scope === "all" && (
                        <TableCell className={`hidden sm:table-cell text-xs ${SITE_META[p.site as SiteKey]?.text ?? ""}`}>
                          {SITE_META[p.site as SiteKey]?.name}
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums">{p.views30d.toLocaleString()}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {p.indexed == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : p.indexed ? (
                          <CircleCheck className="size-4 text-emerald-500" />
                        ) : (
                          <span className="text-xs text-rose-500">no</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {p.lastmod ? relativeTime(new Date(p.lastmod)) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
