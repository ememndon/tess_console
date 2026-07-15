import { Swords, Newspaper, ExternalLink, Sparkles, Globe, TrendingUp, Radar } from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { getCompetitorSets, getCompetitorStats, getRecentPublications } from "@/lib/competitors";
import { relativeTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/stat-tile";
import { SectionHeader } from "@/components/filament/section-header";
import { ConnectGsc } from "@/components/seo/connect-gsc";
import { CompetitorEditor } from "./competitor-editor";

export const metadata = { title: "Competitors" };
export const dynamic = "force-dynamic";

export default async function CompetitorsPage() {
  const scope = await getSiteScope();
  const [sets, stats, pubs] = await Promise.all([
    getCompetitorSets(scope),
    getCompetitorStats(scope),
    getRecentPublications(scope),
  ]);
  const scopeName = scope === "all" ? "all sites" : SITE_META[scope as SiteKey].name;
  const totalTracked = stats.reduce((sum, s) => sum + s.total, 0);
  const newThisWeek = stats.reduce((sum, s) => sum + s.new7d, 0);
  const competitorCount = sets.reduce((sum, s) => sum + s.competitors.length, 0);

  return (
    <div data-section="competitors" className="flex flex-1 flex-col gap-6 p-6">
      <SectionHeader title="Competitors" register="STREAM">
        Free-layer competitor tracking for {scopeName}: their sitemaps/RSS are polled daily and new pages surface
        here. Keyword overlap arrives with Search Console.
      </SectionHeader>

      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={Radar} label="Competitors tracked" value={competitorCount} color="violet" />
        <StatTile icon={Globe} label="Pages indexed" value={totalTracked.toLocaleString()} color="cyan" />
        <StatTile icon={TrendingUp} label="New this week" value={newThisWeek} color="emerald" />
      </div>

      {/* Competitor lists */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Tracked competitors</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {sets.map((s) => (
            <CompetitorEditor key={s.site} site={s.site} competitors={s.competitors} />
          ))}
        </CardContent>
      </Card>

      {/* Coverage summary */}
      {stats.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map((s) => (
            <Card key={`${s.site}-${s.competitor}`}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.competitor}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {scope === "all" ? `${SITE_META[s.site as SiteKey]?.name} · ` : ""}
                    {s.lastDiscovered ? `updated ${relativeTime(new Date(s.lastDiscovered))}` : "—"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="text-lg font-semibold tabular-nums">{s.total.toLocaleString()}</span>
                  {s.new7d > 0 ? (
                    <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                      +{s.new7d} this week
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">pages tracked</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* New publications feed */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Newspaper className="size-4" />
          <CardTitle className="text-sm">Recently discovered publications</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {pubs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing yet — the poller runs nightly (03:30). The first crawl seeds the baseline; genuinely new pages
              surface from the next day.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {pubs.map((p, i) => (
                <li key={i} className="flex items-center gap-3 py-2">
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {p.competitor}
                  </span>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-1 truncate hover:underline"
                  >
                    <span className="truncate">{p.title ?? p.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </a>
                  {scope === "all" && (
                    <span className={`shrink-0 text-[11px] ${SITE_META[p.site as SiteKey]?.text ?? ""}`}>
                      {SITE_META[p.site as SiteKey]?.name}
                    </span>
                  )}
                  <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(new Date(p.discoveredAt))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Keyword overlap (GSC) */}
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4" /> Keyword overlap
        </h2>
        <ConnectGsc title="See where competitors outrank you">
          Once Search Console is connected, this maps the queries where your sites already get impressions against the
          competitors holding page one — so you know exactly which pages to strengthen.
        </ConnectGsc>
      </div>
    </div>
  );
}
