"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Send, Save, ExternalLink, CalendarClock, AlertTriangle, Copy, Pencil, ChevronDown, Sparkles, Clapperboard, Download } from "lucide-react";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { PLATFORM_META, type QueuePost } from "@/lib/social-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { brandDesignFor, type BannerTextStyle } from "@/lib/design";
import { updatePost, preparePostNow, deletePost, updateBannerText } from "./composer-actions";
import { CarouselEditor } from "./carousel-editor-client";
import { downloadCarouselZipAction } from "./carousel-edit-actions";

type BannerFont = "Archivo Black" | "Poppins";

// UTC <-> datetime-local helpers (the rest of Social Studio treats times as UTC).
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  return new Date(v + ":00Z").toISOString();
}

// Short, friendly post-type labels. (AI images are stored as "banner" → "Image Post".)
const TYPE_LABEL: Record<string, string> = { text: "Text Post", banner: "Image Post", video: "Video Post" };

const STATUS_COLOR: Record<string, string> = {
  published: "text-emerald-600 dark:text-emerald-400",
  posted: "text-emerald-600 dark:text-emerald-400",
  done: "text-emerald-600 dark:text-emerald-400",
  failed: "text-rose-500",
  handoff: "text-amber-600 dark:text-amber-400",
  scheduled: "text-sky-600 dark:text-sky-400",
};

export function PostDetailRow({ post }: { post: QueuePost }) {
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState(post.caption ?? "");
  const [schedule, setSchedule] = useState(toLocalInput(post.scheduledAt));
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [headline, setHeadline] = useState(post.headline ?? "");
  const [subhead, setSubhead] = useState(post.subhead ?? "");
  const [showHeaderEdit, setShowHeaderEdit] = useState(false);
  // Banner text styling (font / size / colour). 0 size = auto-fit. Defaults pull the
  // brand ink so the colour picker opens on the current colour.
  const brand = brandDesignFor(post.site);
  const bs = post.bannerStyle ?? {};
  const [hFont, setHFont] = useState<BannerFont>(bs.headlineFont ?? "Archivo Black");
  const [hSize, setHSize] = useState<number>(bs.headlineSizePx ?? 0);
  const [hColor, setHColor] = useState<string>(bs.headlineColor ?? brand.ink);
  const [sFont, setSFont] = useState<BannerFont>(bs.subheadFont ?? "Poppins");
  const [sSize, setSSize] = useState<number>(bs.subheadSizePx ?? 0);
  const [sColor, setSColor] = useState<string>(bs.subheadColor ?? brand.ink);
  // Background swap (the picture behind the text). Default keeps the current backdrop.
  const [bgMode, setBgMode] = useState<"keep" | "stock" | "ai">("keep");
  const [bgPrompt, setBgPrompt] = useState("");
  const [busy, start] = useTransition();
  const router = useRouter();
  const locked = ["published", "done"].includes(post.status);
  const meta = SITE_META[post.site as SiteKey];
  const media = post.media[0];

  function saveBanner() {
    const style: BannerTextStyle = {
      headlineFont: hFont,
      headlineSizePx: hSize || undefined,
      headlineColor: hColor,
      subheadFont: sFont,
      subheadSizePx: sSize || undefined,
      subheadColor: sColor,
    };
    const background =
      bgMode === "stock" ? { mode: "stock" as const, query: bgPrompt.trim() || undefined }
      : bgMode === "ai" ? { mode: "ai" as const, scene: bgPrompt.trim() || undefined }
      : undefined;
    start(async () => {
      const r = await updateBannerText(post.ref ?? "", headline, subhead, style, background);
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(bgMode === "keep" ? "Banner re-rendered." : "Banner re-rendered with a new background.");
      setBgMode("keep"); setBgPrompt("");
      router.refresh(); // pull the new image (its URL is cache-busted) — no manual refresh
    });
  }

  function save() {
    start(async () => {
      const r = await updatePost(post.id, { caption, scheduledAt: fromLocalInput(schedule), hashtags });
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      setOpen(false);
    });
  }
  function copyHashtags() {
    navigator.clipboard?.writeText(hashtags.trim())
      .then(() => toast.success("Hashtags copied."))
      .catch(() => toast.error("Couldn't copy."));
  }
  function downloadZip() {
    start(async () => {
      const r = await downloadCarouselZipAction(post.id);
      if (!r.ok || !r.url) { toast.error(r.message ?? "Couldn't build the ZIP."); return; }
      const a = document.createElement("a");
      a.href = r.url;
      a.download = r.filename ?? "carousel.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }
  function postNow() {
    start(async () => {
      const r = await preparePostNow(post.id);
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      setOpen(false);
    });
  }
  function remove() {
    if (!confirm("Delete this post? This can't be undone.")) return;
    start(async () => {
      await deletePost(post.id);
      toast.success("Post deleted.");
      setOpen(false);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-muted/30"
      >
        {post.ref && <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title="Post ID">#{post.ref}</span>}
        <span className={cn("size-2 shrink-0 rounded-full", meta?.dot ?? "bg-muted")} />
        <span className="text-sm font-medium">{TYPE_LABEL[post.kind] ?? "Post"} | {meta?.name ?? post.site}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-right text-[11px]">
          {post.review && post.review.flags.length > 0 && (
            <span title={post.review.flags.join("; ")} className={cn("inline-flex items-center gap-1", post.review.ok ? "text-amber-600 dark:text-amber-400" : "text-rose-500")}>
              <AlertTriangle className="size-3" /> review
            </span>
          )}
          <span className={cn(STATUS_COLOR[post.status] ?? "text-muted-foreground")}>{post.status}</span>
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", meta?.dot ?? "bg-muted")} />
              {meta?.name ?? post.site}
              <Badge variant="outline" className="text-[10px] capitalize">{post.kind}</Badge>
              <span className={cn("text-xs font-normal", STATUS_COLOR[post.status] ?? "text-muted-foreground")}>{post.status}</span>
            </DialogTitle>
            <DialogDescription>
              {post.ref && <><span className="font-mono font-medium text-foreground">Post ID #{post.ref}</span> · </>}
              Created by {post.createdBy} · {new Date(post.createdAt).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto px-0.5 py-1">
            {post.review && post.review.flags.length > 0 && (
              <div className={cn("flex flex-col gap-1 rounded-lg border p-3 text-xs", post.review.ok ? "border-amber-500/40 bg-amber-500/[0.06]" : "border-rose-500/40 bg-rose-500/[0.06]")}>
                <div className={cn("flex items-center gap-1.5 font-medium", post.review.ok ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400")}>
                  <AlertTriangle className="size-3.5" /> {post.review.ok ? "Worth a look before publishing" : "Held from publishing — fix before scheduling"}
                </div>
                <ul className="ml-5 list-disc text-muted-foreground">
                  {post.review.flags.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}

            <div className="grid gap-8 sm:grid-cols-2">
              {/* Left — preview + per-channel delivery */}
              <div className="flex flex-col gap-5">
                {post.media.length > 1 ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {post.media.map((m, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={m.url} alt={`Slide ${i + 1}`} className="h-64 w-auto shrink-0 rounded-lg border object-contain" />
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">{post.media.length}-slide carousel — swipe order left to right.</p>
                      <Button size="sm" variant="outline" onClick={downloadZip} disabled={busy} className="shrink-0 gap-1.5">
                        <Download className="size-3.5" /> Download all (ZIP)
                      </Button>
                    </div>
                  </div>
                ) : media ? (
                  media.type === "video" ? (
                    <video src={media.url} controls className="w-full rounded-lg border object-contain" />
                  ) : (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={media.url} alt="" className="w-full rounded-lg border object-contain" />
                    </>
                  )
                ) : (
                  <div className="flex aspect-[1200/630] items-center justify-center rounded-lg border bg-muted/20 text-xs text-muted-foreground">No media</div>
                )}

                <div className="grid gap-2">
                  <Label>Channels</Label>
                  <div className="flex flex-col divide-y rounded-lg border">
                    {post.targets.length === 0 && <p className="px-3 py-2.5 text-xs text-muted-foreground">No channels on this post.</p>}
                    {post.targets.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <span className="font-medium">{PLATFORM_META[t.platform]?.label ?? t.platform}</span>
                        <Badge variant="outline" className="text-[9px] capitalize">{t.mode}</Badge>
                        <span className={cn("ml-auto", STATUS_COLOR[t.status] ?? "text-muted-foreground")}>{t.status}</span>
                        {t.externalUrl && (
                          <a href={t.externalUrl} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline dark:text-sky-400"><ExternalLink className="size-3.5" /></a>
                        )}
                        {t.error && <span className="max-w-40 truncate text-rose-500" title={t.error}>{t.error}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pd-hashtags">Hashtags</Label>
                    <button type="button" onClick={copyHashtags} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
                      <Copy className="size-3" /> Copy
                    </button>
                  </div>
                  <Input id="pd-hashtags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} disabled={locked} placeholder="#example #tags" className="text-sm" />
                  <p className="text-[11px] text-muted-foreground">Copy these into your post. Edit and Save to change them for this post.</p>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="pd-sched" className="flex items-center gap-1.5"><CalendarClock className="size-3.5" /> Scheduled (UTC)</Label>
                  <Input id="pd-sched" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} disabled={locked} className="text-sm" />
                  <p className="text-[11px] text-muted-foreground">Leave empty to publish on the next publisher run.</p>
                </div>
              </div>

              {/* Right — the caption (the long field) */}
              <div className="flex flex-col gap-5">
                <div className="grid gap-1.5">
                  <Label htmlFor="pd-caption">Caption</Label>
                  <Textarea id="pd-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={14} disabled={locked} className="text-sm leading-relaxed" />
                </div>
              </div>
            </div>

            {/* Image text editor — full width so the type controls have room.
                Carousels (multi-slide) use their own editor below, not this one. */}
            {post.kind === "banner" && post.media.length <= 1 && !locked && (
              <div className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setShowHeaderEdit((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/30"
                >
                  <span className="flex items-center gap-2"><Pencil className="size-4 text-muted-foreground" /> Edit the text on the image</span>
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showHeaderEdit && "rotate-180")} />
                </button>
                {showHeaderEdit && (
                  <div className="border-t p-4">
                    <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">The words baked ON the picture, separate from the caption. Tune the type, then re-render. Refresh the page to see the new image.</p>
                    <div className="grid gap-6 md:grid-cols-2">
                      {/* Headline */}
                      <div className="flex flex-col gap-2.5">
                        <span className="text-xs font-semibold">Headline <span className="font-normal text-muted-foreground">— Enter for a new line</span></span>
                        <Textarea value={headline} onChange={(e) => setHeadline(e.target.value)} rows={2} className="text-sm" placeholder="Big headline shown on the image" />
                        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Font
                            <select value={hFont} onChange={(e) => setHFont(e.target.value as BannerFont)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"><option>Archivo Black</option><option>Poppins</option></select>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Size {hSize ? `${hSize}px` : "(auto)"}
                            <span className="flex h-8 items-center gap-2">
                              <input type="checkbox" checked={hSize === 0} onChange={(e) => setHSize(e.target.checked ? 0 : 90)} title="Auto-fit" /> auto
                              <input type="range" min={48} max={140} value={hSize || 90} disabled={hSize === 0} onChange={(e) => setHSize(Number(e.target.value))} className="w-24" />
                            </span>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Color
                            <input type="color" value={hColor} onChange={(e) => setHColor(e.target.value)} className="h-8 w-12 rounded-md border bg-transparent p-0.5" />
                          </label>
                        </div>
                      </div>
                      {/* Subhead */}
                      <div className="flex flex-col gap-2.5">
                        <span className="text-xs font-semibold">Subhead</span>
                        <Textarea value={subhead} onChange={(e) => setSubhead(e.target.value)} rows={2} className="text-sm" placeholder="Smaller line under the headline" />
                        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Font
                            <select value={sFont} onChange={(e) => setSFont(e.target.value as BannerFont)} className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"><option>Poppins</option><option>Archivo Black</option></select>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Size {sSize ? `${sSize}px` : "(auto)"}
                            <span className="flex h-8 items-center gap-2">
                              <input type="checkbox" checked={sSize === 0} onChange={(e) => setSSize(e.target.checked ? 0 : 30)} title="Auto" /> auto
                              <input type="range" min={18} max={64} value={sSize || 30} disabled={sSize === 0} onChange={(e) => setSSize(Number(e.target.value))} className="w-24" />
                            </span>
                          </label>
                          <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Color
                            <input type="color" value={sColor} onChange={(e) => setSColor(e.target.value)} className="h-8 w-12 rounded-md border bg-transparent p-0.5" />
                          </label>
                        </div>
                      </div>
                    </div>
                    {/* Background — keep the current backdrop, or swap in a fresh stock photo / AI scene */}
                    <div className="mt-5 border-t pt-4">
                      <span className="text-xs font-semibold">Background</span>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {([
                          { v: "keep", label: "Keep current" },
                          { v: "stock", label: "New stock photo" },
                          { v: "ai", label: "New AI backdrop" },
                        ] as const).map((o) => (
                          <button
                            key={o.v}
                            type="button"
                            onClick={() => setBgMode(o.v)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              bgMode === o.v ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40",
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                      {bgMode !== "keep" && (
                        <div className="mt-2.5">
                          <Input
                            value={bgPrompt}
                            onChange={(e) => setBgPrompt(e.target.value)}
                            className="text-sm"
                            placeholder={bgMode === "stock" ? "Optional photo search, e.g. 'Lagos skyline at sunrise' (blank = auto)" : "Optional scene, e.g. 'calm minimalist desk, warm light' (blank = auto)"}
                          />
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            {bgMode === "ai"
                              ? "Generates a fresh, text-free backdrop with FLUX (uses a paid image credit). The headline is composited on top."
                              : "Pulls a new royalty-free photo and composites the headline on top."}
                          </p>
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="outline" disabled={busy || !headline.trim()} onClick={saveBanner} className="mt-4 gap-1.5"><Save className="size-3.5" /> {bgMode === "keep" ? "Re-render image" : "Re-render with new background"}</Button>
                  </div>
                )}
              </div>
            )}

            {/* Carousel per-slide editor (edit text, reorder tips, add/remove, shape, backdrop) */}
            {post.carousel && !locked && <CarouselEditor post={post} />}
          </div>

          <DialogFooter className="flex-row items-center gap-2 sm:justify-start">
            {!locked && <Button onClick={save} disabled={busy} className="gap-1.5"><Save className="size-3.5" /> Save</Button>}
            {!locked && <Button variant="outline" onClick={postNow} disabled={busy} className="gap-1.5"><Send className="size-3.5" /> Post now</Button>}
            {post.ref && (
              <Button variant="outline" onClick={() => { setOpen(false); router.push(`/social?tab=captions&post=${post.ref}`); }} className="gap-1.5">
                <Sparkles className="size-3.5" /> Generate platform captions
              </Button>
            )}
            {post.ref && (
              <Button variant="outline" onClick={() => { setOpen(false); router.push(`/social?tab=youtube&post=${post.ref}`); }} className="gap-1.5">
                <Clapperboard className="size-3.5" /> YouTube Pack
              </Button>
            )}
            <Button variant="ghost" onClick={remove} disabled={busy} className="ml-auto gap-1.5 text-destructive"><Trash2 className="size-3.5" /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
