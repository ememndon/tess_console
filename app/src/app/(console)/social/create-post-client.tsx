"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Type, Image as ImageIcon, Wand2, Sparkles, Upload, Palette, Link2, Hash, MessageSquare, Loader2, X, Eye } from "lucide-react";
import { createManualPost, suggestCaptions, type ManualImageSource, type ManualPostInput } from "./composer-actions";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social-types";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { brandDesignFor, layoutForSite } from "@/lib/design";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const IMAGE_SOURCES: { id: ManualImageSource; label: string; hint: string; icon: typeof Palette }[] = [
  { id: "design", label: "Tess designs it", hint: "Branded gradient banner", icon: Palette },
  { id: "ai", label: "AI image", hint: "Generated backdrop + text", icon: Wand2 },
  { id: "stock", label: "Stock photo", hint: "Real photo + text", icon: ImageIcon },
  { id: "upload", label: "Upload my own", hint: "Your image + text", icon: Upload },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h3>;
}

export function CreatePost({ defaultSite }: { defaultSite: string }) {
  const router = useRouter();
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "calculatry");
  const [type, setType] = useState<"text" | "image">("image");
  const [imageSource, setImageSource] = useState<ManualImageSource>("design");
  const [overlayText, setOverlayText] = useState(true);
  const [headline, setHeadline] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [genCaption, setGenCaption] = useState(false);
  const [comments, setComments] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [variants, setVariants] = useState<string[]>([]);
  const [suggesting, startSuggest] = useTransition();
  const [platforms, setPlatforms] = useState<Platform[]>(["x", "facebook"]);
  const [scheduleAt, setScheduleAt] = useState("");

  // upload state
  const [uploadFileId, setUploadFileId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pending, start] = useTransition();

  const togglePlatform = (p: Platform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  function suggest() {
    startSuggest(async () => {
      const r = await suggestCaptions({ site, headline: headline.trim() || undefined, targetUrl: targetUrl.trim() || undefined, comments: comments.trim() || undefined });
      if (r.ok && r.options) { setVariants(r.options); setGenCaption(false); }
      else toast.error(r.message || "Couldn't suggest options.");
    });
  }

  function clearUpload() {
    if (uploadPreview) URL.revokeObjectURL(uploadPreview);
    setUploadFileId(null);
    setUploadName(null);
    setUploadPreview(null);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/tess-files", { method: "POST", body: fd });
      const j = await res.json();
      if (res.ok) {
        if (uploadPreview) URL.revokeObjectURL(uploadPreview);
        setUploadFileId(j.id);
        setUploadName(j.name);
        setUploadPreview(URL.createObjectURL(file));
        toast.success("Image uploaded.");
      } else toast.error(j.error || "Upload failed.");
    } catch { toast.error("Upload failed."); }
    setUploading(false);
  }

  function submit() {
    if (type === "image" && imageSource === "upload" && !uploadFileId) { toast.error("Upload an image, or pick another image source."); return; }
    if (type === "text" && !caption.trim() && !genCaption) { toast.error("Write a caption, or tick “Let Tess write the caption”."); return; }
    if (platforms.length === 0) { toast.error("Pick at least one channel."); return; }

    const input: ManualPostInput = {
      site,
      type,
      imageSource: type === "image" ? imageSource : undefined,
      uploadFileId: type === "image" && imageSource === "upload" ? uploadFileId ?? undefined : undefined,
      overlayText,
      caption: caption.trim() || undefined,
      generateCaption: genCaption,
      headline: headline.trim() || undefined,
      subtitle: subtitle.trim() || undefined,
      targetUrl: targetUrl.trim() || undefined,
      comments: comments.trim() || undefined,
      hashtags: hashtags.trim() || undefined,
      platforms,
      scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
    };
    start(async () => {
      const r = await createManualPost(input);
      if (r.ok) { toast.success(r.message); router.push("/social?tab=queue"); router.refresh(); }
      else toast.error(r.message);
    });
  }

  const showImageFields = type === "image";
  const willOverlay = showImageFields && (imageSource !== "upload" || overlayText);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Create a post</h2>
        <p className="text-sm text-muted-foreground">Fill in what you want and Tess builds it — no chat needed. Posts land in the Queue as drafts for you to review.</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* ── Form ── */}
        <div className="flex flex-col gap-6 rounded-xl border bg-card/40 p-6 lg:col-span-7 xl:col-span-8">
          {/* Basics */}
          <section className="grid gap-4">
            <SectionLabel>Basics</SectionLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Brand / site</Label>
                <Select value={site} onValueChange={(v) => v && setSite(v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SITE_KEYS.map((k) => (
                      <SelectItem key={k} value={k}><span className={cn("mr-1.5 inline-block size-2 rounded-full align-middle", SITE_META[k].dot)} />{SITE_META[k].name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Sets the design pattern, colors and voice.</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Post type</Label>
                <div className="flex gap-2">
                  {([["image", "Image post", ImageIcon], ["text", "Text only", Type]] as const).map(([k, label, Icon]) => (
                    <button key={k} type="button" onClick={() => setType(k)}
                      className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm transition-colors", type === k ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                      <Icon className="size-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-url" className="flex items-center gap-1.5"><Link2 className="size-3.5" /> Target page URL</Label>
              <Input id="cp-url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://calculatry.com/loan-payoff-calculator/" />
              <p className="text-[11px] text-muted-foreground">The page this post promotes. Added to the caption and used as context.</p>
            </div>
          </section>

          {/* Image */}
          {showImageFields && (
            <section className="grid gap-4 border-t pt-6">
              <SectionLabel>Image</SectionLabel>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {IMAGE_SOURCES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setImageSource(s.id)}
                    className={cn("flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors", imageSource === s.id ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/40")}>
                    <s.icon className="size-4" />
                    <span className="text-xs font-medium">{s.label}</span>
                    <span className="text-[10px] leading-tight text-muted-foreground">{s.hint}</span>
                  </button>
                ))}
              </div>

              {imageSource === "upload" && (
                <div className="grid gap-2.5 rounded-lg border bg-muted/20 p-3.5">
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()} className="gap-1.5">
                      {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} {uploadName ? "Replace image" : "Choose image"}
                    </Button>
                    {uploadName && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {uploadName}
                        <button type="button" onClick={clearUpload} className="hover:text-foreground"><X className="size-3" /></button>
                      </span>
                    )}
                  </div>
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={overlayText} onChange={(e) => setOverlayText(e.target.checked)} className="mt-0.5 size-3.5" />
                    Overlay my headline / subheading onto the image (uncheck to use the image exactly as uploaded)
                  </label>
                </div>
              )}

              {willOverlay && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="cp-headline">Header text</Label>
                    <Input id="cp-headline" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Loan Payoff Calculator" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cp-sub">Subheading text</Label>
                    <Input id="cp-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Plan your payoff in minutes" />
                  </div>
                  <p className="text-[11px] text-muted-foreground sm:col-span-2">Leave blank and Tess writes short, on-brand text for you.</p>
                </div>
              )}
            </section>
          )}

          {/* Caption & details */}
          <section className="grid gap-4 border-t pt-6">
            <SectionLabel>Caption &amp; details</SectionLabel>
            <div className="grid gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="cp-caption">Caption</Label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={suggest} disabled={suggesting} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
                    {suggesting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />} Suggest options
                  </button>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input type="checkbox" checked={genCaption} onChange={(e) => setGenCaption(e.target.checked)} className="size-3.5" />
                    Let Tess write it
                  </label>
                </div>
              </div>
              <Textarea id="cp-caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} disabled={genCaption}
                placeholder={genCaption ? "Tess will write this from the page and your notes." : "Write your caption, tick “Let Tess write it”, or hit “Suggest options”."} />
              {variants.length > 0 && (
                <div className="grid gap-1.5 rounded-lg border bg-muted/20 p-2.5">
                  <p className="text-[11px] font-medium text-muted-foreground">Tap one to use it:</p>
                  {variants.map((v, i) => (
                    <button key={i} type="button" onClick={() => { setCaption(v); setVariants([]); }} className="rounded-md border bg-background p-2 text-left text-xs leading-relaxed transition-colors hover:border-foreground">
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cp-comments" className="flex items-center gap-1.5"><MessageSquare className="size-3.5" /> Instructions for Tess</Label>
                <Textarea id="cp-comments" value={comments} onChange={(e) => setComments(e.target.value)} rows={2} placeholder="e.g. Scam-aware, friendly tone, aimed at first-time savers." />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cp-tags" className="flex items-center gap-1.5"><Hash className="size-3.5" /> Hashtags</Label>
                <Input id="cp-tags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="Blank = brand default set" />
                <p className="text-[11px] text-muted-foreground">Shown in their own field on the draft for copy-and-use.</p>
              </div>
            </div>
          </section>

          {/* Publishing */}
          <section className="grid gap-4 border-t pt-6">
            <SectionLabel>Publishing</SectionLabel>
            <div className="grid gap-1.5">
              <Label>Channels</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => (
                  <button key={p} type="button" onClick={() => togglePlatform(p)}
                    className={cn("rounded-full border px-3 py-1 text-xs transition-colors", platforms.includes(p) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                    {PLATFORM_META[p].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-sched">Schedule (optional)</Label>
              <Input id="cp-sched" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="w-full sm:w-64" />
              <p className="text-[11px] text-muted-foreground">UTC. Leave empty to save as a draft you post manually.</p>
            </div>
          </section>

          <div className="flex items-center gap-3 border-t pt-5">
            <Button onClick={submit} disabled={pending || uploading} size="lg" className="gap-1.5">
              {pending ? <><Loader2 className="size-4 animate-spin" /> Building…</> : <>Create post</>}
            </Button>
            <span className="text-[11px] text-muted-foreground">Tess builds it and drops it in the Queue for review.</span>
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className="lg:col-span-5 lg:sticky lg:top-6 xl:col-span-4">
          <Preview
            site={site}
            type={type}
            imageSource={imageSource}
            willOverlay={willOverlay}
            headline={headline}
            subtitle={subtitle}
            caption={caption}
            genCaption={genCaption}
            hashtags={hashtags}
            targetUrl={targetUrl}
            platforms={platforms}
            uploadPreview={uploadPreview}
          />
        </div>
      </div>
    </div>
  );
}

function Preview(props: {
  site: string;
  type: "text" | "image";
  imageSource: ManualImageSource;
  willOverlay: boolean;
  headline: string;
  subtitle: string;
  caption: string;
  genCaption: boolean;
  hashtags: string;
  targetUrl: string;
  platforms: Platform[];
  uploadPreview: string | null;
}) {
  const { site, type, imageSource, willOverlay, headline, subtitle, caption, genCaption, hashtags, targetUrl, platforms, uploadPreview } = props;
  const bd = brandDesignFor(site);
  const meta = SITE_META[site as SiteKey];
  const layout = layoutForSite(site);
  const gradient = `linear-gradient(135deg, ${bd.base} 0%, ${bd.mid} 58%, ${bd.bright} 100%)`;
  const isUploadBg = type === "image" && imageSource === "upload" && !!uploadPreview;
  const aiOrStock = type === "image" && (imageSource === "ai" || imageSource === "stock");
  const showDocs = type === "image" && layout === "resume" && imageSource === "design"; // CV docs only on the solid banner
  const bgStyle = aiOrStock ? `linear-gradient(135deg, ${bd.base}, ${bd.mid})` : isUploadBg ? undefined : gradient;
  const captionText = caption.trim() || (genCaption ? "Tess will write the caption from the page and your notes." : "Your caption will appear here.");
  const captionMuted = !caption.trim();
  const tags = hashtags.trim();

  const hl = willOverlay ? headline.trim() || "Your headline" : "";
  const subShown = willOverlay && (subtitle.trim() !== "" || headline.trim() === "");
  const subText = subtitle.trim() || "Tess writes a short subheading";
  const word = (
    <span className="text-[clamp(11px,2.2vw,15px)] font-extrabold" style={{ color: bd.ink }}>
      {bd.wordmark[0]}<span style={{ color: bd.accent }}>{bd.wordmark[1]}</span>
    </span>
  );
  const domainEl = <div className="text-[clamp(9px,1.6vw,13px)] font-bold" style={{ color: bd.accent }}>{bd.domain}</div>;
  const headlineEl = <div className="line-clamp-3 text-[clamp(16px,4vw,32px)] font-extrabold leading-[1.06]" style={{ color: bd.ink }}>{hl}</div>;
  const subEl = subShown ? <div className="mt-1.5 line-clamp-2 text-[clamp(10px,1.8vw,15px)] opacity-85" style={{ color: bd.ink }}>{subText}</div> : null;

  // Layout-specific composition, mirroring the server banner designs.
  const art =
    layout === "calc" ? (
      <div className="relative flex h-full flex-col items-center p-[6%] text-center">
        <div className="flex justify-center">{word}</div>
        <div className="flex flex-1 flex-col items-center justify-center">
          {headlineEl}
          <div className="mt-[3.5%] h-[3px] w-[16%] rounded-full" style={{ background: bd.accent }} />
          {subShown && <div className="mt-[3%] line-clamp-2 text-[clamp(10px,1.8vw,15px)] opacity-85" style={{ color: bd.ink }}>{subText}</div>}
        </div>
        {domainEl}
      </div>
    ) : layout === "resume" ? (
      <>
        {showDocs && <CvDocsPreview bd={bd} />}
        <div className="relative flex h-full flex-col p-[6%]">
          <div>
            {word}
            <div className="mt-[2.5%] h-px w-full" style={{ background: "rgba(255,255,255,0.25)" }} />
          </div>
          <div className={cn("flex flex-1 flex-col justify-center", showDocs && "max-w-[60%]")}>
            <div className="mb-[5%] flex flex-col gap-[3px]">
              <div className="h-[3px] w-[16%] rounded" style={{ background: bd.accent }} />
              <div className="h-[3px] w-[10%] rounded" style={{ background: `${bd.accent}99` }} />
              <div className="h-[3px] w-[6%] rounded" style={{ background: `${bd.accent}55` }} />
            </div>
            {headlineEl}
            {subEl}
          </div>
          {domainEl}
        </div>
      </>
    ) : (
      <>
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: bd.accent }} />
        <div className="relative flex h-full flex-col p-[6%]">
          <div className="flex">{word}</div>
          <div className="flex flex-1 flex-col justify-center">
            {headlineEl}
            {subEl}
          </div>
          {domainEl}
        </div>
      </>
    );

  return (
    <div className="overflow-hidden rounded-xl border bg-card/40">
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Eye className="size-3.5" /> Live preview
      </div>
      <div className="flex flex-col gap-3 p-4">
        {type === "image" ? (
          <div className="relative w-full overflow-hidden rounded-lg ring-1 ring-border" style={{ aspectRatio: "1200 / 630", backgroundImage: bgStyle }}>
            {isUploadBg && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={uploadPreview!} alt="" className="absolute inset-0 size-full object-cover" />
                <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(115deg, rgba(7,8,18,0.88) 0%, rgba(7,8,18,0.5) 55%, rgba(7,8,18,0.28) 100%)" }} />
              </>
            )}
            {aiOrStock && (
              <span className="absolute right-[4%] top-[5%] z-10 rounded-full border px-2 py-0.5 text-[9px] font-medium" style={{ borderColor: `${bd.accent}66`, color: bd.accent, background: "rgba(7,8,18,0.4)" }}>
                {imageSource === "ai" ? "AI backdrop" : "Stock photo"}
              </span>
            )}
            {art}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Type className="size-3.5" /> Text-only post (no image)
          </div>
        )}

        {/* caption + meta */}
        <div className="flex items-center gap-2 pt-0.5">
          <span className={cn("flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white", meta?.dot ?? "bg-muted")}>
            {(meta?.name ?? site).slice(0, 1)}
          </span>
          <span className="text-sm font-medium">{meta?.name ?? site}</span>
        </div>
        <p className={cn("whitespace-pre-line text-sm leading-relaxed", captionMuted && "text-muted-foreground")}>{captionText}</p>
        {tags && <p className="text-xs text-sky-600 dark:text-sky-400">{tags}</p>}
        {targetUrl.trim() && <p className="truncate text-xs text-muted-foreground">{targetUrl.trim()}</p>}

        <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
          {platforms.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No channels selected</span>
          ) : (
            platforms.map((p) => {
              const len = caption.trim().length;
              const over = p === "x" && len > 280;
              return (
                <span key={p} className={cn("rounded-full border px-2 py-0.5 text-[10px]", over ? "border-rose-500 text-rose-500" : "text-muted-foreground")}>
                  {PLATFORM_META[p].label}{p === "x" && len > 0 ? ` · ${len}/280` : ""}
                </span>
              );
            })
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">Approximate preview. Tess renders the final image (and any AI/stock backdrop) when you create the post.</p>
      </div>
    </div>
  );
}

// Two overlapping CV documents — the ResumeHub motif (preview approximation of
// the server-rendered version). Scales with the preview box.
function CvDocsPreview({ bd }: { bd: ReturnType<typeof brandDesignFor> }) {
  const gray = "#d7dbe4";
  return (
    <div className="absolute z-0" style={{ right: "6%", top: "26%", width: "32%", aspectRatio: "3 / 4" }}>
      <div className="absolute inset-0 rounded-md" style={{ background: "#e7eaf1", transform: "rotate(-7deg) translateX(-14%)", boxShadow: "0 6px 16px rgba(0,0,0,0.30)" }} />
      <div className="absolute inset-0 overflow-hidden rounded-md bg-white" style={{ transform: "rotate(4deg)", boxShadow: "0 8px 20px rgba(0,0,0,0.40)" }}>
        <div className="flex items-center gap-[8%] px-[10%]" style={{ height: "24%", background: bd.mid }}>
          <div className="rounded-full" style={{ width: "24%", aspectRatio: "1", background: bd.accent }} />
          <div className="flex flex-col gap-[3px]">
            <div className="h-[3px] w-[30px] rounded" style={{ background: "#fff" }} />
            <div className="h-[3px] w-[20px] rounded" style={{ background: "rgba(255,255,255,0.55)" }} />
          </div>
        </div>
        <div className="flex flex-col gap-[7px] p-[10%]">
          <div className="h-[4px] w-[40%] rounded" style={{ background: bd.accent }} />
          <div className="h-[3px] w-full rounded" style={{ background: gray }} />
          <div className="h-[3px] w-[85%] rounded" style={{ background: gray }} />
          <div className="h-[4px] w-[40%] rounded" style={{ background: bd.accent }} />
          <div className="h-[3px] w-full rounded" style={{ background: gray }} />
          <div className="h-[3px] w-[68%] rounded" style={{ background: gray }} />
        </div>
      </div>
    </div>
  );
}
