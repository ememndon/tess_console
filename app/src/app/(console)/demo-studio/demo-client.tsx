"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Clapperboard, Film, Loader2, ExternalLink, CheckCircle2, XCircle, Clock, Globe, Music, Mic, Trash2, ShieldCheck, Play, Pause } from "lucide-react";
import { createDemoAction, createUrlDemoAction, checkDemoUrlAction, deleteRenderAction, demoJobStates } from "./actions";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatTile } from "@/components/stat-tile";
import { VoicePicker } from "./voice-picker";

export type RecipeView = { id: string; site: SiteKey; feature: string; summary: string; url: string };
export type MediaView = { type: string; path: string; width: number | null; height: number | null };
export type JobView = {
  id: string;
  site: string;
  recipeId: string;
  feature: string;
  status: string;
  createdBy: string;
  result: string | null;
  postId: string | null;
  ref: string | null; // 6-digit Post ID (once the render completes and a draft exists)
  createdAt: string;
  media: MediaView[];
};
export type Brand = { key: string; name: string };
export type VoiceOption = { value: string; label: string };

function aspectLabel(w?: number | null, h?: number | null): string {
  if (!w || !h) return "video";
  const r = w / h;
  if (r < 0.85) return "9:16";
  if (r > 1.15) return "16:9";
  return "1:1";
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const STATUS: Record<string, { label: string; cls: string; Icon: typeof Clock }> = {
  pending: { label: "Queued", cls: "bg-muted text-muted-foreground", Icon: Clock },
  running: { label: "Rendering", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400", Icon: Loader2 },
  done: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", Icon: CheckCircle2 },
  failed: { label: "Failed", cls: "bg-destructive/15 text-destructive", Icon: XCircle },
};

const musicLabel = (m: string) => (m === "auto" ? "Auto (ambient bed)" : m === "none" ? "No music" : m);

export function DemoStudio({
  recipes,
  jobs,
  brands,
  musicTracks,
  voices,
  defaultVoice,
}: {
  recipes: RecipeView[];
  jobs: JobView[];
  brands: Brand[];
  musicTracks: string[];
  voices: VoiceOption[];
  defaultVoice: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(recipes[0]?.id ?? "");
  const [music, setMusic] = useState<string>("auto");
  const [voice, setVoice] = useState<string>(defaultVoice);
  const [notes, setNotes] = useState<string>("");
  const [url, setUrl] = useState<string>("");
  const [urlSite, setUrlSite] = useState<string>(brands[0]?.key ?? "calculatry");
  const [pending, startTransition] = useTransition();
  const [urlPending, startUrlTransition] = useTransition();
  const [removing, startRemove] = useTransition();
  const [checking, setChecking] = useState(false);
  const [urlCheck, setUrlCheck] = useState<{ ok: boolean | null; message: string }>({ ok: null, message: "" });
  const audioRef = useRef<HTMLAudioElement>(null);
  const [previewing, setPreviewing] = useState(false);

  const musicOptions = useMemo(() => ["auto", "none", ...musicTracks], [musicTracks]);
  const previewable = music !== "auto" && music !== "none";

  function stopPreview() {
    audioRef.current?.pause();
    setPreviewing(false);
  }
  function togglePreview() {
    const el = audioRef.current;
    if (!el || !previewable) return;
    if (previewing) {
      el.pause();
      setPreviewing(false);
      return;
    }
    el.src = `/api/media/assets/music/${encodeURIComponent(music)}`;
    el.play().then(() => setPreviewing(true)).catch(() => { toast.error("Couldn't play that track."); setPreviewing(false); });
  }
  const active = recipes.find((r) => r.id === selected);
  // Only treat RECENT pending/running jobs as "live" — a job stuck for ages won't
  // make the page poll forever.
  const hasLive = useMemo(
    () => jobs.some((j) => (j.status === "pending" || j.status === "running") && Date.now() - new Date(j.createdAt).getTime() < 20 * 60_000),
    [jobs],
  );

  // Live status: while a render is in flight, poll a CHEAP id+status endpoint and
  // only do a full router.refresh() when a status actually CHANGES (queued →
  // rendering → ready). This replaced an unconditional 5s whole-page refresh that
  // re-ran the force-dynamic server render every tick and dragged the whole app.
  // Pauses when the tab is hidden; gives up after 15 min so it can never loop.
  useEffect(() => {
    if (!hasLive) return;
    const sig = (s: { id: string; status: string }[]) => s.map((x) => `${x.id}:${x.status}`).sort().join(",");
    let last = sig(jobs.map((j) => ({ id: j.id, status: j.status })));
    const startedAt = Date.now();
    let stopped = false;
    const t = setInterval(async () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (Date.now() - startedAt > 15 * 60_000) { stopped = true; clearInterval(t); return; }
      try {
        const states = await demoJobStates();
        const now = sig(states);
        if (now !== last) { last = now; router.refresh(); }
        if (!states.some((x) => x.status === "pending" || x.status === "running")) { stopped = true; clearInterval(t); }
      } catch { /* transient — try again next tick */ }
    }, 5000);
    return () => { stopped = true; clearInterval(t); };
  }, [hasLive, jobs, router]);

  function generate() {
    if (!selected) return;
    startTransition(async () => {
      const res = await createDemoAction(selected, music, voice, notes);
      res.ok ? toast.success(res.message) : toast.error(res.message);
      router.refresh();
    });
  }

  async function runUrlCheck(): Promise<boolean> {
    if (!url.trim()) return false;
    setChecking(true);
    setUrlCheck({ ok: null, message: "Checking the page…" });
    const r = await checkDemoUrlAction(url.trim());
    setUrlCheck({ ok: r.ok, message: r.message });
    setChecking(false);
    return r.ok;
  }

  function generateUrl() {
    if (!url.trim()) return;
    startUrlTransition(async () => {
      // Never spend script/voice tokens on a dead URL — verify it's reachable first.
      if (urlCheck.ok !== true) {
        const ok = await runUrlCheck();
        if (!ok) return;
      }
      const res = await createUrlDemoAction(url.trim(), urlSite, music, voice, notes);
      if (res.ok) {
        toast.success(res.message);
        setUrl("");
        setUrlCheck({ ok: null, message: "" });
      } else toast.error(res.message);
      router.refresh();
    });
  }

  function removeRender(id: string) {
    if (!confirm("Delete this render? Its video files and the Social Studio draft will be removed.")) return;
    startRemove(async () => {
      const r = await deleteRenderAction(id);
      r.ok ? toast.success(r.message) : toast.error(r.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Create */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a demo video</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Shared controls: voice + music + extra guidance (apply to both options) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Mic className="size-3.5" /> Voice
              </label>
              <VoicePicker voices={voices} value={voice} onChange={setVoice} />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Music className="size-3.5" /> Background music
              </label>
              <div className="flex gap-2">
                <Select value={music} onValueChange={(v) => { setMusic(v ?? "auto"); stopPreview(); }}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {musicOptions.map((m) => (
                      <SelectItem key={m} value={m}>
                        {musicLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={togglePreview}
                  disabled={!previewable}
                  title={previewable ? (previewing ? "Stop preview" : "Preview track") : "Pick a track to preview"}
                  aria-label={previewing ? "Stop preview" : "Preview track"}
                >
                  {previewing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
              </div>
              <audio ref={audioRef} onEnded={() => setPreviewing(false)} className="hidden" />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Preview the selected track with ▶. Drop royalty-free tracks into <code>media/assets/music/</code> to add more
                options. Auto-ducked under the voiceover.
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Additional info for Tess (optional)
            </label>
            <Textarea
              rows={2}
              placeholder="e.g. Emphasise it's 100% free, keep it playful, mention it works on mobile…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Tess weaves this into the script for both options below.</p>
          </div>

          {/* Option A: saved feature recipe */}
          <div className="rounded-lg border p-4">
            <p className="mb-3 text-sm font-medium">Showcase a saved feature</p>
            {recipes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No demo recipes configured yet.</p>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Feature</label>
                    <Select value={selected} onValueChange={(v) => setSelected(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pick a feature" />
                      </SelectTrigger>
                      <SelectContent>
                        {recipes.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {SITE_META[r.site]?.name ?? r.site} · {r.feature}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={generate} disabled={pending || !selected} className="gap-2">
                    {pending ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />}
                    Generate demo video
                  </Button>
                </div>
                {active && <p className="mt-2 text-sm text-muted-foreground">{active.summary}</p>}
              </>
            )}
          </div>

          {/* Option B: any URL */}
          <div className="rounded-lg border p-4">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
              <Globe className="size-4" /> Or make a demo from any URL
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              Tess visits the page, reads its real content, and narrates a guided tour of it.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Page URL</label>
                <div className="flex gap-2">
                  <Input
                    type="url"
                    placeholder="https://example.com/page"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setUrlCheck({ ok: null, message: "" }); }}
                    onBlur={() => { if (url.trim() && urlCheck.ok === null && !checking) runUrlCheck(); }}
                    onKeyDown={(e) => e.key === "Enter" && generateUrl()}
                  />
                  <Button type="button" variant="outline" onClick={runUrlCheck} disabled={checking || !url.trim()} className="shrink-0 gap-1.5">
                    {checking ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Check
                  </Button>
                </div>
              </div>
              <div className="sm:w-40">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Brand voice</label>
                <Select value={urlSite} onValueChange={(v) => setUrlSite(v ?? brands[0]?.key)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.key} value={b.key}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={generateUrl} disabled={urlPending || checking || !url.trim() || urlCheck.ok === false} variant="secondary" className="gap-2">
                {urlPending ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}
                Generate from URL
              </Button>
            </div>
            {urlCheck.message && (
              <p className={`mt-2 flex items-center gap-1.5 text-xs ${urlCheck.ok === true ? "text-emerald-600 dark:text-emerald-400" : urlCheck.ok === false ? "text-destructive" : "text-muted-foreground"}`}>
                {urlCheck.ok === true ? <CheckCircle2 className="size-3.5" /> : urlCheck.ok === false ? <XCircle className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
                {urlCheck.message}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Render summary stat strip */}
      {jobs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={Film} label="Total renders" value={jobs.length} color="violet" />
          <StatTile icon={CheckCircle2} label="Ready" value={jobs.filter((j) => j.status === "done").length} color="emerald" />
          <StatTile icon={Loader2} label="In progress" value={jobs.filter((j) => j.status === "pending" || j.status === "running").length} color="cyan" />
          <StatTile icon={XCircle} label="Failed" value={jobs.filter((j) => j.status === "failed").length} color="rose" />
        </div>
      )}

      {/* Renders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Film className="size-4" /> Recent renders
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No demos yet — create one above.</p>
          ) : (
            jobs.map((j) => {
              const st = STATUS[j.status] ?? STATUS.pending;
              const videos = j.media.filter((m) => m.type !== "image");
              const shots = j.media.filter((m) => m.type === "image");
              return (
                <div key={j.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SITE_META[j.site as SiteKey]?.chip}>{SITE_META[j.site as SiteKey]?.name ?? j.site}</Badge>
                    {j.ref && <span className="font-mono text-xs text-muted-foreground" title="Post ID (shared by all 3 formats)">#{j.ref}</span>}
                    <span className="font-medium">{j.feature}</span>
                    <Badge variant="outline" className={`gap-1 border-0 ${st.cls}`}>
                      <st.Icon className={`size-3 ${j.status === "running" ? "animate-spin" : ""}`} />
                      {st.label}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {j.createdBy} · {timeAgo(j.createdAt)}
                    </span>
                    {j.status !== "running" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        title="Delete render"
                        disabled={removing}
                        onClick={() => removeRender(j.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>

                  {j.status === "failed" && j.result && <p className="mt-2 text-sm text-destructive">{j.result}</p>}

                  {videos.length > 0 && (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {videos
                        .slice()
                        .sort((a, b) => aspectLabel(a.width, a.height).localeCompare(aspectLabel(b.width, b.height)))
                        .map((m) => (
                          <div key={m.path} className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">{aspectLabel(m.width, m.height)}</span>
                              <a href={`/api/media/${m.path}`} download className="text-xs text-muted-foreground hover:underline">
                                download
                              </a>
                            </div>
                            <LazyVideo src={`/api/media/${m.path}`} w={m.width} h={m.height} />
                          </div>
                        ))}
                    </div>
                  )}

                  {shots.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {shots.map((m) => (
                        <a key={m.path} href={`/api/media/${m.path}`} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/media/${m.path}`} alt="demo screenshot" loading="lazy" className="h-16 rounded border" />
                        </a>
                      ))}
                    </div>
                  )}

                  {j.status === "done" && (
                    <div className="mt-3">
                      <Link href="/social?tab=queue" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        Review &amp; post the draft in Social Studio <ExternalLink className="size-3" />
                      </Link>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Click-to-load video: shows a lightweight black placeholder (sized to the clip's
// aspect ratio) with a play button and fetches NOTHING until the user clicks. Only
// then is a <video autoPlay> mounted — so opening Demo Studio no longer pulls every
// render's metadata at once and drags the app.
function LazyVideo({ src, w, h }: { src: string; w: number | null; h: number | null }) {
  const [active, setActive] = useState(false);
  const ratio = w && h ? `${w} / ${h}` : "16 / 9";
  return (
    <div className="relative w-full overflow-hidden rounded-md border bg-black" style={{ aspectRatio: ratio }}>
      {active ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={src} controls autoPlay preload="metadata" className="absolute inset-0 size-full" />
      ) : (
        <button
          type="button"
          onClick={() => setActive(true)}
          className="group absolute inset-0 flex items-center justify-center"
          aria-label="Play video"
          title="Play (loads on click)"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition group-hover:bg-white/25">
            <Play className="size-5 translate-x-0.5 text-white" />
          </span>
        </button>
      )}
    </div>
  );
}
