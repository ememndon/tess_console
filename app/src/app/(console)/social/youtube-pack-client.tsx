"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Copy, Check, Loader2, RefreshCw, Download, Gauge, AlertTriangle, Hash, Sparkles, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TITLE_MAX, TITLE_IDEAL, DESC_MAX, type YouTubePack, type YouTubeThumb } from "@/lib/youtube/types";
import type { CaptionSource } from "@/lib/caption/studio";
import { runYouTubePack, regenerateThumbAction, getSavedPack } from "./youtube-actions";
import { resolveCaptionPost } from "./caption-actions";
import { ThumbEditor } from "./thumb-editor";
import type { ThumbLayers } from "@/lib/youtube/types";

type Mode = "post" | "text";
type SiteOpt = { key: string; name: string };
type PostInfo = { site: string; siteName: string; kind: string; label: string };

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {done ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />} {label ?? "Copy"}
    </button>
  );
}

export function YouTubePackPanel({ sites, defaultSite, initialPostRef }: { sites: SiteOpt[]; defaultSite: string; initialPostRef?: string }) {
  const [mode, setMode] = useState<Mode>(initialPostRef ? "post" : "post");
  const [postRef, setPostRef] = useState(initialPostRef ?? "");
  const [postInfo, setPostInfo] = useState<PostInfo | null>(null);
  const [postErr, setPostErr] = useState<string | null>(null);
  const [site, setSite] = useState(defaultSite);
  const [text, setText] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pack, setPack] = useState<YouTubePack | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [desc, setDesc] = useState("");
  const [busyThumb, setBusyThumb] = useState<number | null>(null);
  // Optional per-thumbnail free-text steer for a regenerate ("make her furious",
  // "money-themed background"), keyed by thumbnail index.
  const [regenNote, setRegenNote] = useState<Record<number, string>>({});
  const [loadedSaved, setLoadedSaved] = useState(false);
  const [editThumb, setEditThumb] = useState<YouTubeThumb | null>(null);
  // The post ref whose pack is currently on screen — so the auto-loader doesn't
  // clobber a pack the user just generated/edited, and only swaps when the ref changes.
  const shownRef = useRef<string | null>(initialPostRef ? initialPostRef.replace(/\D/g, "") : null);

  // If we arrived for a specific post, show its already-built pack (auto-built on
  // render, or built earlier) straight away — no need to regenerate.
  useEffect(() => {
    const clean = (initialPostRef ?? "").replace(/\D/g, "");
    if (!clean) return;
    let live = true;
    (async () => {
      const saved = await getSavedPack(clean);
      if (live && saved?.ok && (saved.thumbnails.length || saved.titles.length)) {
        applyPack(saved);
        setLoadedSaved(true);
        shownRef.current = clean;
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPostRef]);

  // Standalone YouTube tab: when a Post ID with a saved pack is entered, auto-load
  // it (so generated packs survive leaving the page). Won't clobber a pack already
  // shown for that same ref (preserves fresh generations + edits).
  useEffect(() => {
    if (mode !== "post") return;
    const clean = postRef.replace(/\D/g, "");
    if (!clean || shownRef.current === clean) return;
    let live = true;
    const t = setTimeout(async () => {
      const saved = await getSavedPack(clean);
      if (!live || !saved?.ok || (!saved.thumbnails.length && !saved.titles.length)) return;
      if (shownRef.current === clean) return;
      applyPack(saved);
      setLoadedSaved(true);
      shownRef.current = clean;
    }, 500);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postRef, mode]);

  // Resolve a Post ID into a preview (debounced).
  useEffect(() => {
    if (mode !== "post") return;
    const clean = postRef.replace(/\D/g, "");
    if (!clean) { setPostInfo(null); setPostErr(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const r = await resolveCaptionPost(clean);
      if (!live) return;
      if (r.ok && r.site) { setPostInfo({ site: r.site, siteName: r.siteName ?? r.site, kind: r.kind ?? "", label: r.label ?? `#${clean}` }); setPostErr(null); }
      else { setPostInfo(null); setPostErr(r.error ?? "Post not found."); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [postRef, mode]);

  function applyPack(p: YouTubePack) {
    setPack(p);
    setTitles(p.titles);
    setDesc(p.description);
  }

  async function onGenerate() {
    setError(null);
    if (mode === "post" && !postRef.replace(/\D/g, "")) { setError("Enter a Post ID."); return; }
    if (mode === "text" && !text.trim()) { setError("Enter a description."); return; }
    setLoading(true);
    setPack(null);
    setLoadedSaved(false);
    try {
      const source: CaptionSource = mode === "post" ? { kind: "post", ref: postRef } : { kind: "text", site, text };
      const p = await runYouTubePack({ source });
      if (!p.ok) setError(p.error ?? "Could not build the pack.");
      else { applyPack(p); shownRef.current = mode === "post" ? postRef.replace(/\D/g, "") : null; }
    } catch {
      setError("Something went wrong building the YouTube pack.");
    } finally {
      setLoading(false);
    }
  }

  async function regen(thumb: YouTubeThumb) {
    if (!pack?.site) return;
    setBusyThumb(thumb.index);
    try {
      const direction = (regenNote[thumb.index] ?? "").trim() || undefined;
      const fresh = await regenerateThumbAction({ site: pack.site, concept: thumb.concept, paletteIndex: thumb.index, direction });
      setPack((prev) => prev ? { ...prev, thumbnails: prev.thumbnails.map((t) => (t.index === thumb.index ? { ...fresh, index: thumb.index } : t)) } : prev);
    } finally {
      setBusyThumb(null);
    }
  }

  const score = pack?.clickability ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* Input */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-2">
          <Clapperboard className="size-4 text-red-500" />
          <CardTitle className="text-sm">YouTube Pack</CardTitle>
          <span className="text-[11px] text-muted-foreground">— title options, an SEO description, and 3 click-ready thumbnails</span>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-lg border p-1 text-sm w-fit">
            {(["post", "text"] as Mode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1.5 capitalize transition-colors", mode === m ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
                {m === "post" ? "From Post ID" : "From a description"}
              </button>
            ))}
          </div>

          {mode === "post" ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Post ID</label>
              <Input value={postRef} onChange={(e) => setPostRef(e.target.value)} placeholder="e.g. 1042" className="text-sm max-w-xs" />
              {postInfo && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{postInfo.siteName} · {postInfo.kind} post · {postInfo.label}</p>}
              {postErr && <p className="text-[11px] text-rose-500">{postErr}</p>}
              <p className="text-[11px] text-muted-foreground">Best for your video posts — Tess reads the video on the server (samples frames) for context. No re-upload.</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">Brand</label>
                <Select value={site} onValueChange={(v) => v && setSite(v)}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{sites.map((s) => <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium">What is the video about?</label>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Describe the video — the topic, the hook, the payoff." className="text-sm" />
              </div>
            </div>
          )}

          <div>
            <Button onClick={onGenerate} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {loading ? "Building pack…" : "Generate YouTube Pack"}
            </Button>
            {loading && <p className="mt-2 text-[11px] text-muted-foreground">Generating a cinematic image per thumbnail, restoring the face, scoring for click-through and composing the text — this can take up to a minute.</p>}
          </div>
          {error && <p className="flex items-center gap-1.5 text-sm text-rose-500"><AlertTriangle className="size-4" /> {error}</p>}
        </CardContent>
      </Card>

      {pack?.ok && (
        <>
          {loadedSaved && (
            <p className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
              <Check className="size-3.5" /> Showing the pack you generated earlier. Tweak it, or hit “Generate YouTube Pack” for fresh options.
            </p>
          )}
          {/* Titles */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <CardTitle className="text-sm">Title options</CardTitle>
              {score !== null && <Badge variant="outline" className="ml-auto gap-1 text-[10px]"><Gauge className="size-3" /> Clickability {score}/100</Badge>}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {titles.map((t, i) => {
                const len = t.length;
                const tone = len > TITLE_MAX ? "text-rose-500" : len > TITLE_IDEAL ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";
                return (
                  <div key={i} className="flex flex-col gap-1 rounded-lg border p-3">
                    <Textarea value={t} onChange={(e) => setTitles((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))} rows={1} className="text-sm font-medium" />
                    <div className="flex items-center gap-3">
                      <span className={cn("text-[11px]", tone)}>{len}/{TITLE_MAX}{len <= TITLE_IDEAL ? " · ideal" : len <= TITLE_MAX ? " · ok, may truncate" : " · too long"}</span>
                      <CopyBtn text={t} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Thumbnails */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <CardTitle className="text-sm">Thumbnails</CardTitle>
              <span className="text-[11px] text-muted-foreground">— 1280×720, pick one, download and upload to YouTube</span>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pack.thumbnails.map((t) => (
                <div key={t.index} className="flex flex-col gap-2 rounded-lg border p-2">
                  {t.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.url} alt={t.text} className="w-full rounded-md border object-cover" style={{ aspectRatio: "16/9" }} />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-md border bg-muted/20 text-[11px] text-rose-500">{t.error ?? "render failed"}</div>
                  )}
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px] capitalize">{t.layout}</Badge>
                    {typeof t.score?.score === "number" && (
                      <span
                        title={t.score.critique ? `CTR read: ${t.score.critique}` : undefined}
                        className={cn(
                          "inline-flex items-center gap-0.5 text-[10px] font-medium",
                          t.score.score >= 80 ? "text-emerald-600 dark:text-emerald-400" : t.score.score >= 65 ? "text-amber-600 dark:text-amber-400" : "text-rose-500",
                        )}
                      >
                        <Gauge className="size-3" /> {t.score.score}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      {t.editBase && (t.layers || t.editState) && (
                        <button type="button" onClick={() => setEditThumb(t)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><Pencil className="size-3" /> Edit</button>
                      )}
                      {t.url && <a href={t.url} download className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><Download className="size-3" /> Download</a>}
                      <button type="button" onClick={() => regen(t)} disabled={busyThumb === t.index} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50">
                        {busyThumb === t.index ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Regenerate
                      </button>
                    </div>
                  </div>
                  <Input
                    value={regenNote[t.index] ?? ""}
                    onChange={(e) => setRegenNote((m) => ({ ...m, [t.index]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter" && busyThumb !== t.index) { e.preventDefault(); regen(t); } }}
                    disabled={busyThumb === t.index}
                    maxLength={400}
                    placeholder="Describe the new image, then Regenerate (optional)…"
                    className="h-7 text-[11px]"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Description */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <CardTitle className="text-sm">SEO description</CardTitle>
              <span className={cn("ml-auto text-[11px]", desc.length > DESC_MAX ? "text-rose-500" : "text-muted-foreground")}>{desc.length}/{DESC_MAX}</span>
              <CopyBtn text={desc} />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={12} className="text-sm leading-relaxed" />
              {pack.hashtags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Hash className="size-3 text-muted-foreground" />
                  {pack.hashtags.map((h) => <Badge key={h} variant="secondary" className="text-[10px]">{h}</Badge>)}
                  <CopyBtn text={pack.hashtags.join(" ")} label="Copy tags" />
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {editThumb && (
        <ThumbEditor
          thumb={editThumb}
          postRef={mode === "post" ? postRef.replace(/\D/g, "") : undefined}
          onClose={() => setEditThumb(null)}
          onSaved={(url, state: ThumbLayers) =>
            setPack((prev) => (prev ? { ...prev, thumbnails: prev.thumbnails.map((t) => (t.index === editThumb.index ? { ...t, url, editState: state } : t)) } : prev))
          }
        />
      )}
    </div>
  );
}
