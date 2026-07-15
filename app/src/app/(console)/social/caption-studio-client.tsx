"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles, Copy, RefreshCw, Check, Loader2, Hash, Image as ImageIcon,
  Video, FileText, Link2, AlertTriangle, Gauge, ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE_META } from "@/lib/site-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CAPTION_PLATFORMS, PLATFORM_LIMITS, CAPTION_TONES, countChars,
  type CaptionPlatform, type CaptionResult, type CaptionTone,
} from "@/lib/caption-platforms";
import type { CaptionSource, CaptionStudioOutput } from "@/lib/caption/studio";
import { runCaptions, regenerateOne, resolveCaptionPost, getSavedCaptions, saveCaptions } from "./caption-actions";

type Mode = "post" | "text" | "image" | "video";
type SiteOpt = { key: string; name: string };
type PostInfo = { site: string; siteName: string; kind: string; label: string; previewUrl?: string; previewType?: "image" | "video" };

// Countries ResumeHub localizes for (display names). Other sites get a free-text region.
const RESUMEHUB_LOCALES = [
  "Germany", "United Kingdom", "Canada", "United States", "Australia",
  "Japan", "France", "India", "Netherlands", "Ireland",
];

export function CaptionStudio({
  sites,
  defaultSite,
  initialPostRef,
}: {
  sites: SiteOpt[];
  defaultSite: string;
  initialPostRef?: string;
}) {
  const [mode, setMode] = useState<Mode>("post");
  const [postRef, setPostRef] = useState(initialPostRef ?? "");
  const [postInfo, setPostInfo] = useState<PostInfo | null>(null);
  const [postErr, setPostErr] = useState<string | null>(null);
  const [site, setSite] = useState(defaultSite);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<CaptionPlatform>>(new Set(CAPTION_PLATFORMS));
  const [tone, setTone] = useState<CaptionTone>("auto");
  const [locale, setLocale] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CaptionResult[] | null>(null);
  const [busyPlatform, setBusyPlatform] = useState<CaptionPlatform | null>(null);
  const [copied, setCopied] = useState<CaptionPlatform | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // The post ref whose captions are currently shown — so we auto-load saved
  // results, persist edits, and don't clobber a fresh generation. Starts null so
  // the load effect picks up an initial deep-linked post.
  const shownRef = useRef<string | null>(null);

  // The site that drives the localization control (resolved post, or the picker).
  const effSite = mode === "post" ? postInfo?.site ?? "" : site;
  const localeValue = locale.trim() || undefined;

  // Resolve a Post ID into a preview (debounced on the value).
  useEffect(() => {
    if (mode !== "post") return;
    const clean = postRef.replace(/\D/g, "");
    if (!clean) { setPostInfo(null); setPostErr(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const r = await resolveCaptionPost(clean);
      if (!live) return;
      if (r.ok && r.site) { setPostInfo({ site: r.site, siteName: r.siteName ?? r.site, kind: r.kind ?? "", label: r.label ?? `#${clean}`, previewUrl: r.previewUrl, previewType: r.previewType }); setPostErr(null); }
      else { setPostInfo(null); setPostErr(r.error ?? "Post not found."); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [postRef, mode]);

  function pickFile(f: File | null) {
    setFile(f);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(f ? URL.createObjectURL(f) : null);
  }

  function toggle(p: CaptionPlatform) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function generateFor(platforms: CaptionPlatform[]): Promise<CaptionStudioOutput> {
    if (mode === "post") return runCaptions({ source: { kind: "post", ref: postRef }, platforms, tone, locale: localeValue });
    if (mode === "text") return runCaptions({ source: { kind: "text", site, text }, platforms, tone, locale: localeValue });
    const fd = new FormData();
    fd.append("payload", JSON.stringify({ kind: mode, site, note: text || undefined, platforms, tone, locale: localeValue }));
    if (file) fd.append("file", file);
    const r = await fetch("/api/console/caption-upload", { method: "POST", body: fd });
    return (await r.json()) as CaptionStudioOutput;
  }

  async function onGenerate() {
    setError(null);
    const platforms = CAPTION_PLATFORMS.filter((p) => selected.has(p));
    if (!platforms.length) { setError("Pick at least one platform."); return; }
    if (mode === "post" && !postRef.replace(/\D/g, "")) { setError("Enter a Post ID."); return; }
    if (mode === "text" && !text.trim()) { setError("Enter a description."); return; }
    if ((mode === "image" || mode === "video") && !file) { setError("Choose a file to upload first."); return; }
    setLoading(true);
    setResults(null);
    try {
      const out = await generateFor(platforms);
      if (!out.ok) setError(out.error ?? "Could not generate captions.");
      else { setResults(out.results); shownRef.current = mode === "post" ? postRef.replace(/\D/g, "") : null; }
    } catch {
      setError("Something went wrong generating captions.");
    } finally {
      setLoading(false);
    }
  }

  async function regen(platform: CaptionPlatform) {
    setBusyPlatform(platform);
    try {
      let res: CaptionResult;
      if (mode === "post" || mode === "text") {
        const source: CaptionSource = mode === "post" ? { kind: "post", ref: postRef } : { kind: "text", site, text };
        res = await regenerateOne(source, platform, { tone, locale: localeValue });
      } else {
        const out = await generateFor([platform]);
        res = out.results[0] ?? { platform, caption: "", hashtags: [], hookScore: null, hookReason: "", error: out.error ?? "failed" };
      }
      setResults((rs) => (rs ? rs.map((r) => (r.platform === platform ? res : r)) : rs));
    } finally {
      setBusyPlatform(null);
    }
  }

  function patch(platform: CaptionPlatform, delta: Partial<CaptionResult>) {
    setResults((rs) => (rs ? rs.map((r) => (r.platform === platform ? { ...r, ...delta } : r)) : rs));
  }

  function copyCard(r: CaptionResult) {
    const tagLine = r.hashtags.length ? `\n\n${r.hashtags.join(" ")}` : "";
    navigator.clipboard.writeText((r.caption + tagLine).trim());
    setCopied(r.platform);
    setTimeout(() => setCopied((c) => (c === r.platform ? null : c)), 1500);
  }

  // Load saved captions when a post is opened/entered, so results survive leaving
  // the page. Skips when this post's captions are already on screen.
  useEffect(() => {
    if (mode !== "post") return;
    const clean = postRef.replace(/\D/g, "");
    if (!clean || (results && shownRef.current === clean)) return;
    let live = true;
    const t = setTimeout(async () => {
      const saved = await getSavedCaptions(clean);
      if (!live) return;
      if (saved && saved.length) { setResults(saved); shownRef.current = clean; }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [postRef, mode, results]);

  // Persist edits/regenerations back to the post (debounced; post source only).
  useEffect(() => {
    if (mode !== "post" || !results) return;
    const clean = postRef.replace(/\D/g, "");
    if (!clean || shownRef.current !== clean) return;
    const t = setTimeout(() => { void saveCaptions(clean, results); }, 800);
    return () => clearTimeout(t);
  }, [results, mode, postRef]);

  const MODES: { id: Mode; label: string; icon: typeof FileText }[] = [
    { id: "post", label: "Post ID", icon: Hash },
    { id: "text", label: "Description", icon: FileText },
    { id: "image", label: "Image", icon: ImageIcon },
    { id: "video", label: "Video", icon: Video },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      {/* ── Input panel ───────────────────────────────────────────── */}
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="size-4 text-violet-500" /> Caption Studio</CardTitle>
          <p className="text-xs text-muted-foreground">Per-platform captions, each tuned to that network&apos;s length, tone and hashtag norms.</p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* source mode */}
          <div className="grid grid-cols-4 gap-1 rounded-lg border p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => { setMode(m.id); setResults(null); setError(null); }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md px-2 py-2 text-[11px] transition-colors",
                  mode === m.id ? "bg-violet-500/15 text-violet-600 dark:text-violet-300" : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <m.icon className="size-4" />
                {m.label}
              </button>
            ))}
          </div>

          {/* per-mode input */}
          {mode === "post" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Post ID</label>
              <Input value={postRef} onChange={(e) => setPostRef(e.target.value)} placeholder="e.g. 363909" inputMode="numeric" className="font-mono" />
              {postInfo && (
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("size-2 rounded-full", SITE_META[postInfo.site]?.dot)} />
                  {postInfo.siteName} · {postInfo.kind} post · “{postInfo.label}”
                  {postInfo.kind === "video" && <Badge variant="outline" className="ml-1 text-[9px]">reads keyframes</Badge>}
                </p>
              )}
              {postInfo?.previewUrl && (
                <button
                  type="button"
                  onClick={() => setLightbox(true)}
                  title="Click to enlarge"
                  className="group relative mt-1 block w-full overflow-hidden rounded-md border bg-muted/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  {postInfo.previewType === "video" ? (
                    <video src={postInfo.previewUrl} muted playsInline preload="metadata" className="max-h-44 w-full object-contain" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={postInfo.previewUrl} alt={`Post ${postInfo.label}`} className="max-h-44 w-full object-contain" />
                  )}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/30 group-hover:opacity-100">
                    <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white"><ZoomIn className="size-3" /> Enlarge</span>
                  </span>
                </button>
              )}
              {postErr && <p className="text-[11px] text-destructive">{postErr}</p>}
              <p className="text-[11px] text-muted-foreground">Reads the post already in your queue — no upload. Image posts run text-only; video posts sample frames.</p>
            </div>
          )}

          {mode === "text" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">What is the post about?</label>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Describe the post, the angle, any key point or offer…" />
            </div>
          )}

          {(mode === "image" || mode === "video") && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium">Upload {mode === "image" ? "an image" : "a video"} <span className="font-normal text-muted-foreground">(for content not in your queue)</span></label>
              <input
                ref={fileInput}
                type="file"
                accept={mode === "image" ? "image/*" : "video/*"}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs file:mr-3 file:rounded-md file:border file:bg-muted/50 file:px-3 file:py-1.5 file:text-xs hover:file:bg-muted"
              />
              {filePreview && mode === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={filePreview} alt="" className="max-h-40 w-full rounded-md border object-contain" />
              )}
              {filePreview && mode === "video" && <video src={filePreview} controls muted className="max-h-40 w-full rounded-md border" />}
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add any context (optional)…" />
            </div>
          )}

          {/* site (non-post modes) */}
          {mode !== "post" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Brand</label>
              <Select value={site} onValueChange={(v) => v && setSite(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.key} value={s.key}><span className={cn("mr-1.5 inline-block size-2 rounded-full align-middle", SITE_META[s.key]?.dot)} />{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* platforms */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium">Platforms</label>
            <div className="grid grid-cols-2 gap-1.5">
              {CAPTION_PLATFORMS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-[:checked]:border-violet-400 has-[:checked]:bg-violet-500/10">
                  <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} className="size-3.5 accent-violet-500" />
                  {PLATFORM_LIMITS[p].name}
                </label>
              ))}
            </div>
          </div>

          {/* tone + localization */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Tone</label>
              <Select value={tone} onValueChange={(v) => v && setTone(v as CaptionTone)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CAPTION_TONES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium">Localize <span className="font-normal text-muted-foreground">(optional)</span></label>
              {effSite === "resumehub" ? (
                <Select value={locale || "none"} onValueChange={(v) => setLocale(!v || v === "none" ? "" : v)}>
                  <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No localization</SelectItem>
                    {RESUMEHUB_LOCALES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="e.g. Nigeria, Lagos" />
              )}
            </div>
          </div>

          <Button onClick={onGenerate} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {loading ? "Generating…" : "Generate captions"}
          </Button>
          {error && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertTriangle className="size-3.5" /> {error}</p>}
        </CardContent>
      </Card>

      {/* ── Results ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {!results && !loading && (
          <Card className="flex h-full min-h-64 items-center justify-center border-dashed">
            <div className="flex max-w-sm flex-col items-center gap-2 p-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-full border bg-card"><Sparkles className="size-5 text-muted-foreground" /></div>
              <p className="text-sm font-medium">Captions appear here</p>
              <p className="text-xs text-muted-foreground">Enter a Post ID (or upload), choose platforms, then generate. Each card is tailored to that platform and ready to copy.</p>
            </div>
          </Card>
        )}
        {loading && (
          <Card className="flex h-full min-h-64 items-center justify-center border-dashed">
            <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-xs">Writing for each platform…</p>
            </div>
          </Card>
        )}
        {results && CAPTION_PLATFORMS.filter((p) => results.some((r) => r.platform === p)).map((p) => {
          const r = results.find((x) => x.platform === p)!;
          const lim = PLATFORM_LIMITS[p];
          const count = countChars(r.caption, r.hashtags);
          const over = count > lim.hardLimit;
          const visible = r.caption.length > lim.fold ? r.caption.slice(0, lim.fold) : r.caption;
          const hidden = r.caption.length > lim.fold;
          return (
            <Card key={p}>
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <CardTitle className="text-sm">{lim.name}</CardTitle>
                {r.hookScore != null && (
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium" title={r.hookReason || "Scroll-stop score"}>
                    <Gauge className="size-3" /> {r.hookScore}
                  </span>
                )}
                <span className={cn("ml-auto font-mono text-[11px]", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  {count}/{lim.hardLimit}{over && " · over limit"}
                </span>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5">
                {r.error ? (
                  <p className="text-xs text-destructive">{r.error}</p>
                ) : (
                  <>
                    {/* above-the-fold preview */}
                    <div className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed">
                      <span className="mr-1 font-medium uppercase tracking-wide text-muted-foreground">Above the fold</span>
                      <span className="text-foreground">{visible}</span>
                      {hidden ? <span className="text-amber-600 dark:text-amber-400"> ⋯ more</span> : <span className="text-emerald-600 dark:text-emerald-400"> ✓ fully visible</span>}
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">{lim.foldNote}</span>
                    </div>

                    {/* editable caption */}
                    <Textarea value={r.caption} onChange={(e) => patch(p, { caption: e.target.value })} rows={Math.min(8, Math.max(3, Math.ceil(r.caption.length / 60)))} className="text-sm" />

                    {/* hashtags */}
                    <div className="flex items-center gap-1.5">
                      <Hash className="size-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        value={r.hashtags.join(" ")}
                        onChange={(e) => patch(p, { hashtags: e.target.value.split(/\s+/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`)) })}
                        placeholder="hashtags…"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Link2 className="size-3" /> {lim.link}</span>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" disabled={busyPlatform === p} onClick={() => regen(p)} className="h-7 gap-1 px-2 text-xs">
                          {busyPlatform === p ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Regenerate
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => copyCard(r)} className="h-7 gap-1 px-2 text-xs">
                          {copied === p ? <><Check className="size-3.5 text-emerald-500" /> Copied</> : <><Copy className="size-3.5" /> Copy</>}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full-size preview of the post's image/video (click-to-enlarge). */}
      <Dialog open={lightbox} onOpenChange={setLightbox}>
        <DialogContent className="max-w-[92vw] p-3 sm:max-w-3xl">
          <DialogTitle className="text-sm">
            {postInfo ? `${postInfo.siteName} · ${postInfo.label}` : "Post preview"}
          </DialogTitle>
          {postInfo?.previewUrl && (
            postInfo.previewType === "video" ? (
              <video src={postInfo.previewUrl} controls autoPlay className="max-h-[80dvh] w-full rounded-md object-contain" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={postInfo.previewUrl} alt={`Post ${postInfo.label}`} className="max-h-[80dvh] w-full rounded-md object-contain" />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
