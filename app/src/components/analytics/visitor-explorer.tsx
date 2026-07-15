"use client";

import { useState, useTransition } from "react";
import { ChevronRight, Monitor, Smartphone, Tablet, MousePointerClick, TriangleAlert, Eye, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { loadVisitorJourney } from "@/app/(console)/analytics/actions";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import type { VisitorRow, JourneyEvent } from "@/lib/analytics";

function flag(cc: string | null): string {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "Unknown";
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}
function place(v: VisitorRow): string {
  const country = countryName(v.country);
  const loc = [v.city, v.region && v.region !== v.city ? v.region : null].filter(Boolean).join(", ");
  return loc ? `${loc}, ${country}` : country;
}
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}
function DeviceIcon({ device }: { device: string | null }) {
  const I = device === "mobile" ? Smartphone : device === "tablet" ? Tablet : Monitor;
  return <I className="size-3.5 text-muted-foreground" />;
}

export function VisitorExplorer({ scope, day, visitors, showSite }: { scope: string; day: string; visitors: VisitorRow[]; showSite: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [journeys, setJourneys] = useState<Record<string, JourneyEvent[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, start] = useTransition();

  function toggle(v: VisitorRow) {
    if (openId === v.visitorId) {
      setOpenId(null);
      return;
    }
    setOpenId(v.visitorId);
    if (!journeys[v.visitorId]) {
      setLoadingId(v.visitorId);
      start(async () => {
        const j = await loadVisitorJourney(scope, v.visitorId, day);
        setJourneys((m) => ({ ...m, [v.visitorId]: j }));
        setLoadingId(null);
      });
    }
  }

  if (visitors.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No visitors recorded on this day yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{visitors.length} visitor{visitors.length === 1 ? "" : "s"} on this day · click one to see their full journey</p>
      {visitors.map((v) => {
        const open = openId === v.visitorId;
        return (
          <div key={v.visitorId} className="rounded-xl border">
            <button
              type="button"
              onClick={() => toggle(v)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
            >
              <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
              <Badge variant="secondary" className="shrink-0">{v.source ?? "Direct"}</Badge>
              <span className="shrink-0">{flag(v.country)}</span>
              <span className="min-w-0 flex-1 truncate">
                {place(v)}
                {showSite && v.site ? (
                  <span className="text-muted-foreground"> - {SITE_META[v.site as SiteKey]?.name ?? v.site}</span>
                ) : null}
              </span>
              <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                <DeviceIcon device={v.device} /> {v.browser ?? "—"}
              </span>
              <span className="flex shrink-0 items-center gap-2.5 text-xs tabular-nums text-muted-foreground">
                <span className="flex items-center gap-1" title="pages viewed"><Eye className="size-3.5" />{v.pageviews}</span>
                {v.events > 0 && <span className="flex items-center gap-1" title="events"><MousePointerClick className="size-3.5" />{v.events}</span>}
                {v.errors > 0 && <span className="flex items-center gap-1 text-rose-500" title="errors"><TriangleAlert className="size-3.5" />{v.errors}</span>}
              </span>
              <span className="hidden w-20 shrink-0 text-right text-[11px] text-muted-foreground md:block">
                {clock(v.firstSeen)}–{clock(v.lastSeen)}
              </span>
            </button>

            {open && (
              <div className="border-t bg-muted/20 px-4 py-3">
                {loadingId === v.visitorId && !journeys[v.visitorId] ? (
                  <p className="text-xs text-muted-foreground">Loading journey…</p>
                ) : (journeys[v.visitorId]?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground">No detailed events.</p>
                ) : (
                  <ol className="relative ml-1 flex flex-col gap-2 border-l pl-4">
                    {journeys[v.visitorId].map((e, i) => (
                      <li key={i} className="relative text-xs">
                        <span className={`absolute -left-[1.30rem] top-1 size-2 rounded-full ${e.type === "error" ? "bg-rose-500" : e.type === "event" ? "bg-violet-500" : e.type === "not_found" ? "bg-amber-500" : "bg-emerald-500"}`} />
                        <span className="text-muted-foreground tabular-nums">{clock(e.at)}</span>{" "}
                        {e.type === "pageview" && <span className="font-mono">{e.path ?? "/"}</span>}
                        {e.type === "event" && <span><span className="font-medium text-violet-600 dark:text-violet-400">{e.name ?? "event"}</span>{e.path ? <span className="font-mono text-muted-foreground"> · {e.path}</span> : null}</span>}
                        {e.type === "not_found" && <span><Badge variant="outline" className="mr-1 text-[10px]">404</Badge><span className="font-mono">{e.path ?? "/"}</span></span>}
                        {e.type === "error" && <span className="text-rose-600 dark:text-rose-400">{e.message ?? "Error"}{e.path ? <span className="font-mono text-muted-foreground"> · {e.path}</span> : null}</span>}
                      </li>
                    ))}
                  </ol>
                )}
                {v.source && v.source !== "Direct" && (
                  <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Search className="size-3" /> Arrived via {v.source}{v.landing ? <> on <span className="font-mono">{v.landing}</span></> : null}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
