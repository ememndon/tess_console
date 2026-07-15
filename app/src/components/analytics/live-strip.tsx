"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SITE_META, type SiteKey } from "@/lib/site-scope";

export type RTEvent = {
  type: string;
  name: string | null;
  path: string | null;
  country: string | null;
  device: string | null;
  site: string;
  createdAt: string;
};
export type Realtime = { active: number; recent: RTEvent[] };

function flag(cc: string | null): string {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
function rel(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Real-time strip. Seeded with the server-rendered snapshot, then self-refreshes
// every 5s from the lightweight /api/analytics/realtime endpoint so "active now"
// and the latest hits appear within seconds (the whole-page refresh was ~15s).
export function LiveStrip({ scope, initial, showSite }: { scope: string; initial: Realtime; showSite: boolean }) {
  const [data, setData] = useState<Realtime>(initial);
  const [live, setLive] = useState(true);
  const liveRef = useRef(true);
  liveRef.current = live;

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!liveRef.current || document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/analytics/realtime?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
        if (r.ok && !cancelled) setData(await r.json());
      } catch {
        /* transient — keep last good data */
      }
    };
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scope]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <span className="relative flex size-2">
            {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/70" />}
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Real-time · <span className="tabular-nums">{data.active}</span> active now
        </CardTitle>
        <button
          type="button"
          onClick={() => setLive((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title={live ? "Live — click to pause" : "Paused — click to resume"}
        >
          <RefreshCw className={`size-3 ${live ? "animate-spin [animation-duration:3s]" : ""}`} />
          {live ? "Live" : "Paused"}
        </button>
      </CardHeader>
      <CardContent className="py-0">
        {data.recent.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No activity in the last 30 minutes.</p>
        ) : (
          <ul className="divide-y text-sm">
            {data.recent.map((e, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                  {e.type === "not_found" ? "404" : e.name ?? e.type}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{e.path ?? "—"}</span>
                {showSite && (
                  <span className={`shrink-0 text-[11px] ${SITE_META[e.site as SiteKey]?.text ?? ""}`}>
                    {SITE_META[e.site as SiteKey]?.name ?? e.site}
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {e.country ? `${flag(e.country)} ` : ""}
                  {e.device ?? ""}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{rel(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
