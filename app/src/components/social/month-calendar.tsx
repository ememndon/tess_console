import { Clapperboard, Megaphone } from "lucide-react";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import type { CalendarPost } from "@/lib/social";
import type { DayPlan } from "@/lib/demo/schedule";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const statusDot: Record<string, string> = {
  published: "bg-emerald-500",
  done: "bg-emerald-500",
  scheduled: "bg-sky-500",
  ready: "bg-amber-500",
  failed: "bg-rose-500",
  draft: "bg-muted-foreground/40",
};

// Server-rendered month grid (content calendar). Posts placed by their
// scheduled (or created) time in UTC; brand-colored chips with a status dot.
export function MonthCalendar({ posts, plan = [], year, month }: { posts: CalendarPost[]; plan?: DayPlan[]; year: number; month: number }) {
  const startDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const byDay = new Map<number, CalendarPost[]>();
  for (const p of posts) {
    const dt = new Date(p.at);
    if (dt.getUTCFullYear() === year && dt.getUTCMonth() === month) {
      const d = dt.getUTCDate();
      (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(p);
    }
  }

  // Standing daily content-plan overlay (posts per site + a demo video on its day).
  const planByDay = new Map<number, DayPlan[]>();
  for (const e of plan) (planByDay.get(e.day) ?? planByDay.set(e.day, []).get(e.day)!).push(e);

  const now = new Date();
  const isToday = (d: number) =>
    now.getUTCFullYear() === year && now.getUTCMonth() === month && now.getUTCDate() === d;

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="grid grid-cols-7 border-b bg-muted/30 text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5 text-center">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => (
          <div key={i} className={`min-h-[6.5rem] border-b border-r p-1.5 last:border-r-0 ${d ? "" : "bg-muted/20"}`}>
            {d && (
              <>
                <div className={`mb-1 text-[11px] ${isToday(d) ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                  {isToday(d) ? (
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background">{d}</span>
                  ) : (
                    d
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {(planByDay.get(d) ?? []).map((e, si) => {
                    const meta = SITE_META[e.site as SiteKey];
                    return (
                      <div
                        key={`pl-${si}`}
                        title={`Planned for ${meta?.name ?? e.site}: ${e.posts} posts${e.video ? " + 1 demo video (06:00 UTC)" : ""}. Tess generates these overnight as drafts; you review and schedule them.`}
                        className={`flex items-center gap-1 truncate rounded border border-dashed px-1 py-0.5 text-[10px] font-medium ${meta?.text ?? "text-muted-foreground"}`}
                      >
                        <Megaphone className="size-2.5 shrink-0" />
                        <span className="truncate">{meta?.name ?? e.site} · {e.posts}</span>
                        {e.video && <Clapperboard className="size-2.5 shrink-0" />}
                      </div>
                    );
                  })}
                  {(byDay.get(d) ?? []).slice(0, 4).map((p) => {
                    const meta = SITE_META[p.site as SiteKey];
                    return (
                      <div
                        key={p.id}
                        title={`${meta?.name ?? p.site} · ${p.kind} · ${p.status}${p.platforms.length ? ` · ${p.platforms.join(", ")}` : ""}\n${p.caption ?? ""}`}
                        className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] ${meta?.chip ?? "bg-muted"}`}
                      >
                        <span className={`size-1.5 shrink-0 rounded-full ${statusDot[p.status] ?? "bg-muted-foreground/40"}`} />
                        <span className="truncate">{p.caption?.replace(/\n/g, " ").slice(0, 28) || p.kind}</span>
                      </div>
                    );
                  })}
                  {(byDay.get(d)?.length ?? 0) > 4 && (
                    <span className="px-1 text-[10px] text-muted-foreground">+{byDay.get(d)!.length - 4} more</span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
