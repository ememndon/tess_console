import Link from "next/link";
import { MessageSquareHeart, Sparkles, Eye, CheckCircle2 } from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { listFeedback, feedbackCounts, type FeedbackStatus } from "@/lib/feedback";
import { EmptyState } from "@/components/empty-state";
import { StatTile } from "@/components/stat-tile";
import { SectionHeader } from "@/components/filament/section-header";
import { FeedbackList, type FeedbackItem } from "./feedback-list";

export const metadata = { title: "Feedback" };
export const dynamic = "force-dynamic";

const FILTERS: { key: FeedbackStatus | "all"; label: string }[] = [
  { key: "new", label: "New" },
  { key: "seen", label: "Seen" },
  { key: "actioned", label: "Actioned" },
  { key: "all", label: "All" },
];

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const scope = await getSiteScope();
  const status = (typeof sp.status === "string" ? sp.status : "new") as FeedbackStatus | "all";

  const [counts, rows] = await Promise.all([feedbackCounts(scope), listFeedback(scope, status)]);
  const items: FeedbackItem[] = rows.map((f) => ({
    id: f.id,
    site: f.site,
    rating: f.rating,
    message: f.message,
    path: f.path,
    country: f.country,
    status: f.status,
    at: f.createdAt.toISOString(),
  }));
  const scopeName = scope === "all" ? "all sites" : SITE_META[scope as SiteKey].name;

  return (
    <div data-section="feedback" className="flex flex-1 flex-col gap-6 p-6">
      <SectionHeader title="Feedback" register="STREAM">
        &quot;Was this helpful?&quot; responses and problem reports from {scopeName}, collected by the analytics
        widget.
      </SectionHeader>

      {counts.total === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          title="No feedback yet"
          description={'Wire your sites\' "Was this helpful?" buttons to tess.feedback() (see Analytics → Install). Submissions land here for triage.'}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile icon={Sparkles} label="New" value={counts.new ?? 0} color="violet" />
            <StatTile icon={Eye} label="Seen" value={counts.seen ?? 0} color="cyan" />
            <StatTile icon={CheckCircle2} label="Actioned" value={counts.actioned ?? 0} color="emerald" />
            <StatTile icon={MessageSquareHeart} label="Total" value={counts.total} color="pink" />
          </div>

          <div className="flex flex-wrap items-center gap-1 self-start rounded-full border bg-card p-1">
            {FILTERS.map((f) => {
              const count = f.key === "all" ? counts.total : (counts[f.key as FeedbackStatus] ?? 0);
              return (
                <Link
                  key={f.key}
                  href={`/feedback?status=${f.key}`}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors ${f.key === status ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {f.label}
                  <span className={`text-xs tabular-nums ${f.key === status ? "" : "text-muted-foreground"}`}>{count}</span>
                </Link>
              );
            })}
          </div>
          <FeedbackList items={items} scope={scope} />
        </>
      )}
    </div>
  );
}
