import Link from "next/link";
import { CalendarClock, CalendarDays, Megaphone, Palette, Radio, Hand, Bot, CheckCircle2, Pause, ChevronLeft, ChevronRight, PenLine, Sparkles, Clapperboard } from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, SITE_KEYS, type SiteKey } from "@/lib/site-scope";
import { getBrandProfiles, getSocialConfig, getQueue, getStudioCounts, getHandoffItems, getCalendarPosts, type PlatformConfig } from "@/lib/social";
import { getSecretValue } from "@/lib/secrets";
import { PLATFORM_META, type Platform } from "@/lib/social-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MonthCalendar } from "@/components/social/month-calendar";
import { contentPlanForMonth } from "@/lib/demo/schedule";
import { POSTS_PER_DAY } from "@/lib/social/daily-plan";
import { StatTile } from "@/components/stat-tile";
import { SectionHeader } from "@/components/filament/section-header";
import { BrandEditor, PlatformConfigRow } from "./config-client";
import { Composer } from "./composer-client";
import { CarouselDialog } from "./carousel-client";
import { BatchDialog } from "./batch-client";
import { HandoffActions } from "./handoff-client";
import { QueueList } from "./queue-list-client";
import { CreatePost } from "./create-post-client";
import { CaptionStudio } from "./caption-studio-client";
import { YouTubePackPanel } from "./youtube-pack-client";

export const metadata = { title: "Social Studio" };
export const dynamic = "force-dynamic";

// Friendly heading for a date subsection in the queue (YYYY-MM-DD, UTC).
function dayLabel(key: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(key + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const TABS = [
  { key: "queue", label: "Queue", icon: CalendarClock },
  { key: "create", label: "Create", icon: PenLine },
  { key: "captions", label: "Caption Studio", icon: Sparkles },
  { key: "youtube", label: "YouTube", icon: Clapperboard },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "brands", label: "Brand voices", icon: Palette },
  { key: "channels", label: "Channels", icon: Radio },
] as const;

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scope = await getSiteScope();
  const tab = (typeof sp.tab === "string" ? sp.tab : "queue") as (typeof TABS)[number]["key"];
  const scopeName = scope === "all" ? "all brands" : SITE_META[scope as SiteKey].name;

  return (
    <div data-section="social" className="flex flex-1 flex-col gap-6 p-6">
      <SectionHeader title="Social Studio" register="STUDIO">
        Brand-voice content for {scopeName} — text, banners and video. X &amp; Telegram post autonomously; Meta &amp;
        LinkedIn are prepared for manual posting.
      </SectionHeader>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/social?tab=${t.key}`}
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

      <Section
        tab={tab}
        scope={scope}
        scopeName={scopeName}
        monthParam={typeof sp.month === "string" ? sp.month : undefined}
        postParam={typeof sp.post === "string" ? sp.post : undefined}
      />
    </div>
  );
}

async function Section({
  tab,
  scope,
  scopeName,
  monthParam,
  postParam,
}: {
  tab: string;
  scope: Awaited<ReturnType<typeof getSiteScope>>;
  scopeName: string;
  monthParam?: string;
  postParam?: string;
}) {
  if (tab === "calendar") {
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth();
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      year = y;
      month = m - 1;
    }
    const from = new Date(Date.UTC(year, month, 1)).toISOString();
    const to = new Date(Date.UTC(year, month + 1, 1)).toISOString();
    const posts = await getCalendarPosts(scope, from, to);
    const schedule = contentPlanForMonth(year, month, POSTS_PER_DAY).filter((e) => scope === "all" || e.site === scope);
    const prev = new Date(Date.UTC(year, month - 1, 1));
    const next = new Date(Date.UTC(year, month + 1, 1));
    const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Link href={`/social?tab=calendar&month=${ym(prev)}`} className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted/40">
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{label}</span>
            <Link href={`/social?tab=calendar&month=${ym(next)}`} className="inline-flex size-7 items-center justify-center rounded-md border hover:bg-muted/40">
              <ChevronRight className="size-4" />
            </Link>
            <Link href="/social?tab=calendar" className="ml-1 text-xs text-muted-foreground hover:text-foreground">Today</Link>
          </div>
          <div className="flex gap-2">
            <BatchDialog defaultSite={scope === "all" ? "calculatry" : scope} />
            <CarouselDialog defaultSite={scope === "all" ? "calculatry" : scope} />
            <Composer defaultSite={scope === "all" ? "calculatry" : scope} />
          </div>
        </div>
        <MonthCalendar posts={posts} plan={schedule} year={year} month={month} />
        <p className="text-[11px] text-muted-foreground">
          UTC dates · solid chips = real posts (status dot: sky = scheduled, emerald = published, rose = failed). Dashed
          chips = the standing daily plan Tess generates overnight as drafts ({POSTS_PER_DAY} posts/site, plus a 🎬 demo
          video on each site&apos;s day); you review and schedule them manually.
        </p>
      </div>
    );
  }

  if (tab === "create") {
    return <CreatePost defaultSite={scope === "all" ? "calculatry" : scope} />;
  }

  if (tab === "captions") {
    const sites = (scope === "all" ? SITE_KEYS : [scope as SiteKey]).map((k) => ({ key: k, name: SITE_META[k]?.name ?? k }));
    return <CaptionStudio sites={sites} defaultSite={scope === "all" ? "calculatry" : scope} initialPostRef={postParam} />;
  }

  if (tab === "youtube") {
    const sites = (scope === "all" ? SITE_KEYS : [scope as SiteKey]).map((k) => ({ key: k, name: SITE_META[k]?.name ?? k }));
    return <YouTubePackPanel sites={sites} defaultSite={scope === "all" ? "calculatry" : scope} initialPostRef={postParam} />;
  }

  if (tab === "brands") {
    const brands = await getBrandProfiles(scope);
    return (
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {brands.map((b) => (
          <BrandEditor key={b.site} brand={b} />
        ))}
      </div>
    );
  }

  if (tab === "channels") {
    const [cfg, telegramTokenSet] = await Promise.all([
      getSocialConfig(scope),
      getSecretValue("telegram_bot_token").then((v) => !!v),
    ]);
    const bySite = new Map<string, PlatformConfig[]>();
    for (const c of cfg) {
      const arr = bySite.get(c.site) ?? [];
      arr.push(c);
      bySite.set(c.site, arr);
    }
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-[13px] text-muted-foreground">
          <Bot className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium text-foreground">Autonomous</span> platforms publish on schedule with no human
            in the loop. <span className="font-medium text-foreground">Manual handoff</span> generates the content and
            drops the final files in the posting queue for you to post by hand. Connect X &amp; Telegram accounts below
            to enable autonomous posting; Facebook, Instagram &amp; LinkedIn are manual-handoff only for now.
          </span>
        </div>
        {[...bySite.entries()].map(([site, list]) => (
          <Card key={site}>
            <CardHeader className="flex flex-row items-center gap-2 pb-1">
              <span className={`size-2.5 rounded-full ${SITE_META[site as SiteKey]?.dot ?? "bg-muted"}`} />
              <CardTitle className="text-sm">{SITE_META[site as SiteKey]?.name ?? site}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y py-0">
              {list.map((c) => (
                <PlatformConfigRow key={c.platform} cfg={c} telegramTokenSet={telegramTokenSet} />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // queue (default)
  const [counts, queue, handoff] = await Promise.all([getStudioCounts(scope), getQueue(scope), getHandoffItems(scope)]);
  const defaultSite = scope === "all" ? "calculatry" : scope;
  // Group the queue into date subsections (by scheduled date, else created date).
  // getQueue is already sorted newest-first, so same-day posts land together.
  const queueGroups: { key: string; label: string; posts: typeof queue }[] = [];
  for (const p of queue) {
    const key = (p.scheduledAt ?? p.createdAt).slice(0, 10); // YYYY-MM-DD (UTC)
    const last = queueGroups[queueGroups.length - 1];
    if (last && last.key === key) last.posts.push(p);
    else queueGroups.push({ key, label: dayLabel(key), posts: [p] });
  }
  const tiles = [
    { icon: CalendarClock, label: "Scheduled", value: counts.scheduled, color: "violet" as const },
    { icon: Hand, label: "Awaiting manual post", value: counts.handoff, color: "orange" as const },
    { icon: CheckCircle2, label: "Published", value: counts.published, color: "emerald" as const },
    { icon: Pause, label: "Paused platforms", value: counts.paused, color: "cyan" as const },
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Compose a post or batch-generate them. Handoff items wait below.</p>
        <div className="flex gap-2">
          <BatchDialog defaultSite={defaultSite} />
          <CarouselDialog defaultSite={defaultSite} />
          <Composer defaultSite={defaultSite} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <StatTile key={t.label} icon={t.icon} label={t.label} value={t.value} color={t.color} />
        ))}
      </div>

      {/* Manual posting queue (Meta / LinkedIn handoff) — always shown so it stays
          discoverable; the empty state explains how items get here. */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Hand className="size-4 text-amber-500" />
          <CardTitle className="text-sm">Ready for manual posting</CardTitle>
          <span className="text-[11px] text-muted-foreground">— caption + media prepared; post on the platform, then mark done</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {handoff.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing here yet. When you approve a post that has a Facebook, Instagram or LinkedIn channel (open a draft, add the channel, then mark it Ready), Tess prepares the caption and media here for you to download and post by hand.</p>
          ) : (
            handoff.map((h) => (
              <div key={h.targetId} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start">
                {h.media[0] &&
                  (h.media[0].type === "video" ? (
                    <video src={h.media[0].url} controls muted className="h-24 w-24 shrink-0 rounded-md border object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={h.media[0].url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <img src={h.media[0].url} alt="" className="h-20 w-36 rounded-md border object-cover" />
                    </a>
                  ))}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    {h.ref && <span className="font-mono text-[11px] text-muted-foreground" title="Post ID">#{h.ref}</span>}
                    <Badge variant="outline" className="text-[10px] capitalize">{PLATFORM_META[h.platform as Platform]?.label ?? h.platform}</Badge>
                    <span className={`text-xs ${SITE_META[h.site as SiteKey]?.text ?? ""}`}>{SITE_META[h.site as SiteKey]?.name}</span>
                  </div>
                  <p className="whitespace-pre-line text-sm text-muted-foreground line-clamp-3">{h.caption}</p>
                  {h.media[0] && (
                    <a href={h.media[0].url} download className="mt-1 inline-block text-[11px] underline underline-offset-2 hover:text-foreground">
                      Download {h.media[0].type === "video" ? "video" : "image"}
                    </a>
                  )}
                </div>
                <HandoffActions targetId={h.targetId} caption={h.caption ?? ""} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {queue.length === 0 && handoff.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full border bg-card">
              <Megaphone className="size-5 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold">The queue is empty</h3>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Set each brand&apos;s voice and channel schedule in the tabs above. The composer, banner/video generation
              and the autonomous + handoff publishers come online next — then scheduled posts and the manual posting
              queue show up here.
            </p>
            <div className="flex gap-2">
              <Link href="/social?tab=brands" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/40">
                Set brand voices
              </Link>
              <Link href="/social?tab=channels" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/40">
                Configure channels
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : queue.length === 0 ? null : (
        <QueueList groups={queueGroups} />
      )}
    </div>
  );
}
