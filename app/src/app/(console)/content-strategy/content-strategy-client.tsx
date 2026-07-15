"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Radar, Flame, Sparkles, Calendar, Wand2, Plug, ExternalLink, TrendingUp, Plus, Pencil, X, Check, ImageIcon, Clapperboard, Loader2, Trash2, Search, Images } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { OutlierVideo } from "@/lib/research/ingest";
import type { NicheStrategy } from "@/lib/research/analyze";
import type { PlanItem } from "@/lib/research/grid";
import { addNiche, editNiche, removeNiche, loadOutliers, runResearch, runStrategy, buildPlan, generatePlanItemAction, clearBacklog, deleteBacklogItems, checkWhatsWorking, setCarouselPlan } from "./content-strategy-actions";

export type SiteData = {
  site: string;
  name: string;
  domain: string;
  niches: string[];
  primary: string;
  carouselPlan: boolean; // opt-in: schedule Instagram carousels into this site's plans
  outliers: OutlierVideo[];
  planRef: string | null;
  planItems: PlanItem[];
  plans: { ref: string; status: string; createdAt: string; summary: Record<string, unknown> }[];
};

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const satColor: Record<string, string> = { low: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400", high: "bg-rose-500/15 text-rose-600 dark:text-rose-400" };

export function ContentStrategyClient({ sites, youtubeReady, mcpReady, baseUrl }: { sites: SiteData[]; youtubeReady: boolean; mcpReady: boolean; baseUrl: string }) {
  const [activeSite, setActiveSite] = useState(sites[0]?.site ?? "");
  const [niches, setNiches] = useState<Record<string, string[]>>(Object.fromEntries(sites.map((s) => [s.site, s.niches])));
  const [active, setActive] = useState<Record<string, string>>(Object.fromEntries(sites.map((s) => [s.site, s.primary])));
  const [newNiche, setNewNiche] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ site: string; niche: string } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [outliersByNiche, setOutliersByNiche] = useState<Record<string, OutlierVideo[]>>(Object.fromEntries(sites.filter((s) => s.primary).map((s) => [s.primary, s.outliers])));
  const [strategyByNiche, setStrategyByNiche] = useState<Record<string, NicheStrategy | null>>({});
  const [planItems, setPlanItems] = useState<Record<string, PlanItem[]>>(Object.fromEntries(sites.map((s) => [s.site, s.planItems])));
  const [carouselByS, setCarouselByS] = useState<Record<string, boolean>>(Object.fromEntries(sites.map((s) => [s.site, s.carouselPlan])));
  const [genId, setGenId] = useState<string>(""); // plan item currently generating
  const [tab, setTab] = useState<"strategy" | "backlog">("strategy");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [restored, setRestored] = useState(false);

  // Remember where you left off (per browser): restore the last site + the last
  // niche on each site when you return to Content Director, instead of resetting
  // to the first site. Runs once on mount, then persists on every change.
  useEffect(() => {
    try {
      const lastSite = localStorage.getItem("cd:lastSite");
      if (lastSite && sites.some((s) => s.site === lastSite)) setActiveSite(lastSite);
      setActive((prev) => {
        const next = { ...prev };
        for (const s of sites) {
          const n = localStorage.getItem(`cd:lastNiche:${s.site}`);
          if (n && s.niches.includes(n)) next[s.site] = n;
        }
        return next;
      });
    } catch { /* localStorage unavailable (private mode, etc.) */ }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored) return; // don't overwrite the stored value before it's read
    try {
      localStorage.setItem("cd:lastSite", activeSite);
      const n = active[activeSite];
      if (n) localStorage.setItem(`cd:lastNiche:${activeSite}`, n);
    } catch { /* ignore */ }
  }, [restored, activeSite, active]);

  const site = sites.find((s) => s.site === activeSite);
  if (!site) return <div className="p-6 text-sm text-muted-foreground">No sites in scope.</div>;

  const siteNiches = niches[activeSite] ?? [];
  const activeNiche = active[activeSite] ?? "";
  const ol = outliersByNiche[activeNiche] ?? [];
  const carouselOn = !!carouselByS[activeSite];
  const strat = strategyByNiche[activeNiche] ?? null;

  const run = (label: string, fn: () => Promise<{ ok: boolean; message?: string }>, after?: (r: unknown) => void) => {
    setBusy(label);
    startTransition(async () => {
      try {
        const r = await fn();
        if (r.ok) { if (r.message) toast.success(r.message); after?.(r); }
        else toast.error(r.message ?? "Failed.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed.");
      } finally {
        setBusy("");
      }
    });
  };

  const selectNiche = (n: string) => {
    setActive((m) => ({ ...m, [activeSite]: n }));
    if (outliersByNiche[n] === undefined) {
      loadOutliers(n).then((r) => { if (r.ok) setOutliersByNiche((m) => ({ ...m, [n]: r.outliers ?? [] })); });
    }
  };

  const onAdd = () => {
    const val = newNiche[activeSite] ?? "";
    run("add", () => addNiche(activeSite, val), (r) => {
      const rr = r as { niches?: string[] };
      if (rr.niches) {
        setNiches((m) => ({ ...m, [activeSite]: rr.niches! }));
        const added = rr.niches[rr.niches.length - 1];
        setActive((m) => ({ ...m, [activeSite]: added }));
      }
      setNewNiche((m) => ({ ...m, [activeSite]: "" }));
    });
  };

  const onSaveEdit = () => {
    if (!editing) return;
    const { site: s, niche: oldN } = editing;
    run("edit", () => editNiche(s, oldN, editVal), (r) => {
      const rr = r as { niches?: string[] };
      if (rr.niches) {
        setNiches((m) => ({ ...m, [s]: rr.niches! }));
        if (active[s] === oldN) setActive((m) => ({ ...m, [s]: editVal.trim() }));
      }
      setEditing(null);
    });
  };

  const onRemove = (n: string) => {
    run("remove", () => removeNiche(activeSite, n), (r) => {
      const rr = r as { niches?: string[] };
      if (rr.niches) {
        setNiches((m) => ({ ...m, [activeSite]: rr.niches! }));
        if (active[activeSite] === n) setActive((m) => ({ ...m, [activeSite]: rr.niches![0] ?? "" }));
      }
    });
  };

  const generateItem = (item: PlanItem) => {
    setGenId(item.id);
    startTransition(async () => {
      try {
        const r = await generatePlanItemAction(item.id);
        if (r.ok) {
          toast.success(r.kind === "video" ? "Video queued — it'll appear in Social Studio when it finishes rendering." : r.kind === "carousel" ? `Carousel generated${r.postRef ? ` (#${r.postRef})` : ""} — it's in Social Studio, ready for manual posting.` : `Image post generated${r.postRef ? ` (#${r.postRef})` : ""}.`);
          setPlanItems((m) => ({ ...m, [activeSite]: (m[activeSite] ?? []).map((it) => (it.id === item.id ? { ...it, status: r.kind === "video" ? "queued" : "generated", postRef: r.postRef ?? it.postRef } : it)) }));
        } else toast.error(r.message ?? "Generation failed.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed.");
      } finally {
        setGenId("");
      }
    });
  };
  const sitePlan = planItems[activeSite] ?? [];
  const LOW_BACKLOG = 12;
  const DONE_STATUSES = new Set(["generated", "queued"]);
  const activeBriefs = sitePlan.filter((it) => !DONE_STATUSES.has(it.status));
  const doneCount = sitePlan.length - activeBriefs.length;
  const plannedCount = sitePlan.filter((it) => it.status === "planned").length;
  const visibleBriefs = showDone ? sitePlan : activeBriefs;

  const toggleSel = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleSelectAll = () =>
    setSelected((s) => (s.size === visibleBriefs.length ? new Set() : new Set(visibleBriefs.map((p) => p.id))));
  const deleteSelected = () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected brief(s)? This can't be undone.`)) return;
    startTransition(async () => {
      const r = await deleteBacklogItems(activeSite, ids);
      if (r.ok) { toast.success(r.message ?? "Deleted."); if (r.items) setPlanItems((m) => ({ ...m, [activeSite]: r.items! })); setSelected(new Set()); }
      else toast.error(r.message ?? "Failed.");
    });
  };
  const clearAll = () => {
    if (!sitePlan.length) return;
    if (!confirm(`Clear ALL ${sitePlan.length} briefs for ${site.name}? This wipes the backlog so you can start fresh. Generated drafts in Social Studio are NOT affected. This can't be undone.`)) return;
    startTransition(async () => {
      const r = await clearBacklog(activeSite);
      if (r.ok) { toast.success(r.message ?? "Cleared."); setPlanItems((m) => ({ ...m, [activeSite]: [] })); setSelected(new Set()); }
      else toast.error(r.message ?? "Failed.");
    });
  };

  return (
    <div data-section="content-strategy" className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Radar className="size-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Content Director</h1>
          <p className="text-sm text-muted-foreground">Manage each site's niches, find what is already winning, and build a 30-day plan. Any AI can drive this too.</p>
        </div>
      </div>

      {/* Connection panel */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Plug className="size-4" /> Connect an AI to Tess</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={youtubeReady ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>{youtubeReady ? "● YouTube data connected" : "○ Add a YouTube Data API key"}</Badge>
            <Badge className={mcpReady ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>{mcpReady ? "● Access token set" : "○ Set an access token"}</Badge>
            {(!youtubeReady || !mcpReady) && <Link href="/settings?tab=secrets" className="text-xs text-primary underline">Configure in Settings → Secrets</Link>}
          </div>
          <div className="grid gap-1 rounded-md bg-muted/40 p-2 font-mono text-xs">
            <div><span className="text-muted-foreground">MCP server: </span>{baseUrl}/api/mcp</div>
            <div><span className="text-muted-foreground">REST base:&nbsp; </span>{baseUrl}/api/content-intel/&lt;action&gt;</div>
          </div>
        </CardContent>
      </Card>

      {/* Site selector with niche counts */}
      {sites.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {sites.map((s) => (
            <button key={s.site} onClick={() => { setActiveSite(s.site); setSelected(new Set()); }} className={cn("rounded-full px-3 py-1 text-sm transition-colors", s.site === activeSite ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70")}>
              {s.name} <span className="opacity-70">· {(niches[s.site] ?? []).length}</span>
            </button>
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as "strategy" | "backlog")} className="gap-4">
        <TabsList>
          <TabsTrigger value="strategy" className="gap-1.5"><Sparkles className="size-3.5" /> Research &amp; Strategy</TabsTrigger>
          <TabsTrigger value="backlog" className="gap-1.5"><Calendar className="size-3.5" /> Content backlog{sitePlan.length ? <Badge variant="secondary" className="ml-1 px-1.5 text-[10px]">{sitePlan.length}</Badge> : null}</TabsTrigger>
        </TabsList>

        <TabsContent value="strategy" className="flex flex-col gap-4">
      {/* ── Niches widget ── */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Radar className="size-4" /> Niches for {site.name}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={newNiche[activeSite] ?? ""}
              onChange={(e) => setNewNiche((m) => ({ ...m, [activeSite]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") onAdd(); }}
              placeholder={`Add a niche for ${site.name} (e.g. "personal finance calculators")`}
              className="h-9"
            />
            <Button size="sm" disabled={pending || !(newNiche[activeSite] ?? "").trim()} onClick={onAdd} className="gap-1.5"><Plus className="size-3.5" /> Add</Button>
          </div>

          {siteNiches.length === 0 ? (
            <p className="text-xs text-muted-foreground">No niches yet. Add one above — it's the phrase you'd search on YouTube to find competitors' content.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {siteNiches.map((n) =>
                editing && editing.site === activeSite && editing.niche === n ? (
                  <span key={n} className="inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5">
                    <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") setEditing(null); }} autoFocus className="h-6 w-44 border-0 px-1 text-xs shadow-none focus-visible:ring-0" />
                    <button onClick={onSaveEdit} className="text-emerald-600 hover:text-emerald-500" title="Save"><Check className="size-3.5" /></button>
                    <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground" title="Cancel"><X className="size-3.5" /></button>
                  </span>
                ) : (
                  <span key={n} className={cn("group inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors", n === activeNiche ? "border-primary bg-primary/10 text-primary" : "bg-muted/50 text-foreground hover:bg-muted")}>
                    <button onClick={() => selectNiche(n)} className="max-w-[200px] truncate" title="Select this niche">{n}</button>
                    <button onClick={() => { setEditing({ site: activeSite, niche: n }); setEditVal(n); }} className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100" title="Edit"><Pencil className="size-3" /></button>
                    <button onClick={() => onRemove(n)} disabled={pending} className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 hover:!text-rose-500" title="Remove"><X className="size-3.5" /></button>
                  </span>
                ),
              )}
            </div>
          )}

          {/* Action bar — operates on the selected niche */}
          {activeNiche && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="text-xs text-muted-foreground">Working on <span className="font-medium text-foreground">{activeNiche}</span>:</span>
              <Button size="sm" disabled={pending} onClick={() => run("research", () => runResearch(activeSite, activeNiche), (r) => { const rr = r as { niche?: string; outliers?: OutlierVideo[] }; if (rr.niche && rr.outliers) setOutliersByNiche((m) => ({ ...m, [rr.niche!]: rr.outliers! })); })} className="gap-1.5"><Flame className="size-3.5" /> {busy === "research" && pending ? "Researching…" : "Research niche"}</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("strategy", () => runStrategy(activeSite, activeNiche), (r) => { const rr = r as { niche?: string; strategy?: NicheStrategy }; if (rr.niche && rr.strategy) setStrategyByNiche((m) => ({ ...m, [rr.niche!]: rr.strategy! })); })} className="gap-1.5"><Sparkles className="size-3.5" /> {busy === "strategy" && pending ? "Analyzing…" : "Analyze strategy"}</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("plan", () => buildPlan(activeSite, activeNiche, 30), (r) => { const rr = r as { items?: PlanItem[] }; if (rr.items) { setPlanItems((m) => ({ ...m, [activeSite]: rr.items! })); setTab("backlog"); } })} className="gap-1.5"><Calendar className="size-3.5" /> {busy === "plan" && pending ? "Building 30-day plan…" : "Build 30-day plan"}</Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("plan-blend", () => buildPlan(activeSite, activeNiche, 30, "blend"), (r) => { const rr = r as { items?: PlanItem[] }; if (rr.items) { setPlanItems((m) => ({ ...m, [activeSite]: rr.items! })); setTab("backlog"); } })} className="gap-1.5"><Wand2 className="size-3.5" /> {busy === "plan-blend" && pending ? "Blending…" : "Blend Search + YouTube"}</Button>
            </div>
          )}

          {/* Google Search demand — builds a plan straight from the site's own Search
              Console queries (real demand + the exact ranking page per post). No niche needed. */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Or build from <span className="font-medium text-foreground">Google Search demand</span> (your real search queries, no niche needed):</span>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("plan-gsc", () => buildPlan(activeSite, undefined, 30, "gsc"), (r) => { const rr = r as { items?: PlanItem[] }; if (rr.items) { setPlanItems((m) => ({ ...m, [activeSite]: rr.items! })); setTab("backlog"); } })} className="gap-1.5"><Search className="size-3.5" /> {busy === "plan-gsc" && pending ? "Building from Google Search…" : "Build from Google Search"}</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("feedback", () => checkWhatsWorking(activeSite))} className="gap-1.5" title="Re-read Search Console for past Search-anchored posts and double down on the pages that climbed"><TrendingUp className="size-3.5" /> {busy === "feedback" && pending ? "Checking…" : "Check what's working"}</Button>
          </div>

          {/* Post types — opt this site's plans into Instagram carousels (off by default) */}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Post types:</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => { const next = !carouselOn; run("carousel", () => setCarouselPlan(activeSite, next), () => setCarouselByS((m) => ({ ...m, [activeSite]: next }))); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50",
                carouselOn ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40",
              )}
              title="When on, each 30-day plan schedules about one Instagram carousel a day for listicle-style topics. Drafted for manual posting like every other post. Off by default."
            >
              <Images className="size-3.5" /> Instagram carousels: {carouselOn ? "on" : "off"}
            </button>
            <span className="text-[11px] text-muted-foreground">Beta: ~1 swipeable carousel/day for listicle-style topics; manual posting.</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Outlier leaderboard */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="size-4" /> Viral outliers <span className="text-xs font-normal text-muted-foreground">{activeNiche ? `· ${activeNiche}` : ""}</span></CardTitle></CardHeader>
          <CardContent>
            {!activeNiche ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Add and select a niche to begin.</p>
            ) : ol.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No data yet — click Research niche.</p>
            ) : (
              <div className="space-y-1.5">
                {ol.map((v, i) => (
                  <a key={v.externalId} href={v.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md border p-1.5 hover:bg-muted/40">
                    <span className="w-5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
                    {v.thumbnail ? <img src={v.thumbnail} alt="" className="h-10 w-16 shrink-0 rounded object-cover" /> : <div className="h-10 w-16 shrink-0 rounded bg-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{v.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{v.channelTitle} · {fmt(v.views)} views{v.isShort ? " · short" : ""}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      {v.outlierScore != null && <Badge variant="secondary" className="px-1.5 text-[10px]">{v.outlierScore}x</Badge>}
                      {v.opportunityScore != null && <span className="text-[10px] font-semibold text-primary">opp {v.opportunityScore}</span>}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Strategy */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Wand2 className="size-4" /> Strategy {activeNiche ? <span className="text-xs font-normal text-muted-foreground">· {activeNiche}</span> : null}</CardTitle></CardHeader>
          <CardContent>
            {!strat ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Run Analyze strategy for ranked subtopics, winning formats and hook formulas.</p>
            ) : (
              <div className="space-y-4 text-sm">
                {strat.summary && <p className="rounded-md bg-muted/40 p-2 text-xs italic">{strat.summary}</p>}
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Subtopics to make next</div>
                  <div className="space-y-1.5">
                    {strat.subtopics.map((s) => (
                      <div key={s.rank} className="rounded-md border p-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-primary">#{s.rank}</span>
                          <span className="flex-1 text-xs font-medium">{s.title}</span>
                          <Badge className={cn("px-1.5 text-[10px]", satColor[s.saturation])}>{s.saturation}</Badge>
                        </div>
                        {s.pattern && <p className="mt-1 text-[11px] text-muted-foreground">{s.pattern}</p>}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Winning formats</div>
                  <div className="flex flex-wrap gap-1.5">{strat.formats.map((f) => (<Badge key={f.id} variant="secondary" className="text-[11px]" title={f.template}>{f.name}{f.winShare ? ` · ${f.winShare}%` : ""}</Badge>))}</div>
                </div>
                {strat.hookPatterns.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Hook formulas</div>
                    <ul className="space-y-0.5">{strat.hookPatterns.map((h, i) => (<li key={i} className="text-[11px] text-muted-foreground">“{h.pattern}”</li>))}</ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="backlog" className="flex flex-col gap-4">
      {/* Content backlog — the MERGED pool across every niche's plans, best first.
          Briefs live HERE only; they become drafts in Social Studio just one at a
          time, when generated (manually or by Tess's daily run). */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Calendar className="size-4" /> Content backlog <span className="text-xs font-normal text-muted-foreground">{sitePlan.length ? `· ${plannedCount} to make${doneCount ? ` · ${doneCount} done` : ""} · ${new Set(sitePlan.map((p) => p.niche ?? "")).size} niche(s)` : ""}</span></CardTitle>
          {sitePlan.length > 0 && (
            <div className="flex shrink-0 items-center gap-2">
              {doneCount > 0 && <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowDone((v) => !v)} className="h-7 gap-1">{showDone ? "Hide completed" : `Show completed (${doneCount})`}</Button>}
              {selected.size > 0 && <Button size="sm" variant="ghost" disabled={pending} onClick={deleteSelected} className="h-7 gap-1 text-rose-500"><Trash2 className="size-3.5" /> Delete {selected.size}</Button>}
              <Button size="sm" variant="outline" disabled={pending} onClick={clearAll} className="h-7 gap-1 text-rose-500"><Trash2 className="size-3.5" /> Clear all</Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <p className="mb-3 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">These are briefs, not posts. They stay in Content Director. A brief only becomes a draft in Social Studio when it is generated, one at a time when you click Generate, or automatically as part of Tess's daily run (5 images + 1 video/day). Completed briefs are hidden by default; use “Show completed”.</p>
          {sitePlan.length > 0 && plannedCount <= LOW_BACKLOG && (
            <p className={cn("mb-3 rounded-md p-2 text-[11px]", plannedCount === 0 ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400")}>
              {plannedCount === 0
                ? "⚠ Backlog empty — Tess will fall back to the generic content pillars. Research a niche and Build a plan to refill it."
                : `⚠ Backlog running low — only ${plannedCount} briefs left to make (about ${Math.max(1, Math.round(plannedCount / 6))} day${Math.round(plannedCount / 6) === 1 ? "" : "s"} at 6/day). Build another plan soon so Tess keeps posting on-strategy.`}
            </p>
          )}
          {sitePlan.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No briefs yet. Open Research &amp; Strategy, pick a niche, then Build 30-day plan.</p>
          ) : (
            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2 px-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={visibleBriefs.length > 0 && selected.size === visibleBriefs.length} onChange={toggleSelectAll} className="size-3.5 accent-primary" />
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </label>
              {visibleBriefs.map((it) => (
                <div key={it.id} className={cn("flex items-center gap-2 rounded-md border p-2 text-xs", selected.has(it.id) && "border-primary/50 bg-primary/5")}>
                  <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleSel(it.id)} className="size-3.5 shrink-0 accent-primary" aria-label="Select brief" />
                  <Badge className={cn("shrink-0 gap-1 px-1.5 text-[10px] capitalize", it.kind === "video" ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : it.kind === "carousel" ? "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400" : "bg-sky-500/15 text-sky-600 dark:text-sky-400")}>
                    {it.kind === "video" ? <Clapperboard className="size-3" /> : it.kind === "carousel" ? <Images className="size-3" /> : <ImageIcon className="size-3" />} {it.kind}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{it.subtopic}</div>
                    <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                      {it.sourceVideo?.kind === "gsc" ? (
                        <Badge variant="outline" className="shrink-0 gap-0.5 px-1 py-0 text-[9px] font-normal text-sky-600 dark:text-sky-400" title={it.sourceVideo?.query ? `Google search: "${it.sourceVideo.query}"${it.sourceVideo.position ? ` (position ~${Math.round(it.sourceVideo.position)})` : ""}` : undefined}><Search className="size-2.5" /> Search</Badge>
                      ) : it.sourceVideo?.title ? (
                        <Badge variant="outline" className="shrink-0 gap-0.5 px-1 py-0 text-[9px] font-normal text-rose-600 dark:text-rose-400" title={`YouTube outlier: ${it.sourceVideo.title}`}><TrendingUp className="size-2.5" /> YouTube</Badge>
                      ) : null}
                      {it.niche ? <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal">{it.niche}</Badge> : null}
                      <span className="truncate">{it.formatName}{it.platform ? ` · ${it.platform}` : ""}</span>
                    </div>
                  </div>
                  {it.status === "generated" ? (
                    <Link href="/social" className="flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-400">✓ {it.postRef ? `#${it.postRef}` : "done"} <ExternalLink className="size-3" /></Link>
                  ) : it.status === "queued" ? (
                    <span className="flex shrink-0 items-center gap-1 text-violet-600 dark:text-violet-400"><Clapperboard className="size-3" /> rendering…</span>
                  ) : it.status === "failed" ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => generateItem(it)} className="h-7 shrink-0 text-rose-500">Retry</Button>
                  ) : (
                    <Button size="sm" disabled={pending} onClick={() => generateItem(it)} className="h-7 shrink-0 gap-1">
                      {genId === it.id && pending ? <Loader2 className="size-3 animate-spin" /> : null} Generate Post
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent plans */}
      {site.plans.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Calendar className="size-4" /> Content plans</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {site.plans.map((p) => {
                const img = (p.summary?.imageCount as number) ?? 0;
                const vid = (p.summary?.videoCount as number) ?? 0;
                const total = img + vid || (p.summary?.days as number) || 0;
                return (
                  <div key={p.ref} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                    <Badge variant="outline" className="font-mono">{p.ref}</Badge>
                    <span className="text-muted-foreground">{total} briefs{img || vid ? ` (${img} image · ${vid} video)` : ""} · {new Date(p.createdAt).toLocaleDateString()}</span>
                    <span className="flex-1" />
                    <Link href="/social" className="flex items-center gap-1 text-primary underline">Social Studio <ExternalLink className="size-3" /></Link>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
