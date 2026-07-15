"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PenLine, Image as ImageIcon, Type, Sparkles, Clapperboard, Wand2 } from "lucide-react";
import { createPost, draftWithTess, type CreatePostInput } from "./composer-actions";
import { PLATFORMS, PLATFORM_META, type Platform } from "@/lib/social-types";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function Composer({ defaultSite }: { defaultSite: string }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "calculatry");
  const [kind, setKind] = useState<"text" | "banner" | "video" | "ai_image">("text");
  const [caption, setCaption] = useState("");
  const [headline, setHeadline] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [badge, setBadge] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(["x", "telegram", "facebook"]);
  const [scheduleAt, setScheduleAt] = useState("");
  const [pending, start] = useTransition();

  const [drafting, startDraft] = useTransition();
  const toggle = (p: Platform) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  function draft() {
    startDraft(async () => {
      const r = await draftWithTess(site, caption);
      if (r.ok && r.caption) {
        setCaption(r.caption);
        if (r.warning) toast.warning(r.warning);
        else toast.success("Drafted in brand voice");
      } else toast.error(r.message ?? "Couldn't draft");
    });
  }

  function submit() {
    const input: CreatePostInput = {
      site,
      kind,
      caption,
      headline,
      subtitle,
      badge,
      imagePrompt,
      platforms,
      scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
    };
    start(async () => {
      const r = await createPost(input);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setCaption("");
        setHeadline("");
        setSubtitle("");
      } else toast.error(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <PenLine className="size-3.5" /> New post
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose a post</DialogTitle>
          <DialogDescription>
            Autonomous channels publish on schedule; handoff channels drop into the manual posting queue.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Brand</Label>
              <Select value={site} onValueChange={(v) => v && setSite(v)}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SITE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {SITE_META[k].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => v && setKind(v as "text" | "banner" | "video" | "ai_image")}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    <Type className="size-3.5" /> Text
                  </SelectItem>
                  <SelectItem value="banner">
                    <ImageIcon className="size-3.5" /> Banner (branded template)
                  </SelectItem>
                  <SelectItem value="ai_image">
                    <Wand2 className="size-3.5" /> AI image (Nano Banana)
                  </SelectItem>
                  <SelectItem value="video">
                    <Clapperboard className="size-3.5" /> Video
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {kind === "ai_image" && (
            <div className="grid gap-1.5 rounded-lg border p-3">
              <Label htmlFor="img-prompt" className="flex items-center gap-1.5"><Wand2 className="size-3.5" /> Describe the image</Label>
              <Textarea id="img-prompt" value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} rows={3} placeholder="e.g. A warm, modern flat-lay of a laptop showing a resume, soft daylight, muted purple accents — no text." />
              <p className="text-[11px] text-muted-foreground">Generated by Gemini “Nano Banana”. For on-brand graphics with text, use Banner instead.</p>
            </div>
          )}

          {(kind === "banner" || kind === "video") && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="headline">{kind === "video" ? "Video" : "Banner"} headline</Label>
                <Input id="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Mortgage Calculator" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="subtitle">Subtitle</Label>
                  <Input id="subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="badge">Badge</Label>
                  <Input id="badge" value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="Calculator of the day" />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="caption">Caption</Label>
              <Button type="button" variant="outline" size="sm" onClick={draft} disabled={drafting} className="h-7 gap-1 text-xs">
                <Sparkles className="size-3" /> {drafting ? "Drafting…" : "Draft with Tess"}
              </Button>
            </div>
            <Textarea id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Type a topic or rough idea, then “Draft with Tess” to write it in brand voice. Hashtags + disclaimers are appended automatically." />
          </div>

          <div className="grid gap-1.5">
            <Label>Channels</Label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(p)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    platforms.includes(p) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {PLATFORM_META[p].label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="sched">Schedule (optional)</Label>
            <Input id="sched" type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="w-56" />
            <p className="text-[11px] text-muted-foreground">Leave empty to prepare now.</p>
          </div>

          {(caption.trim() || headline.trim()) && platforms.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Live preview</p>
              <div className="flex items-center gap-2">
                <span className={`flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${SITE_META[site as SiteKey]?.dot ?? "bg-muted"}`}>
                  {(SITE_META[site as SiteKey]?.name ?? site).slice(0, 1)}
                </span>
                <span className="text-sm font-medium">{SITE_META[site as SiteKey]?.name ?? site}</span>
                {kind !== "text" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">{kind} attached</span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">
                {kind === "text" ? caption : caption || headline}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {platforms.map((p) => {
                  const len = (kind === "text" ? caption : caption || headline).length;
                  const over = p === "x" && len > 280;
                  return (
                    <span key={p} className={`rounded-full border px-2 py-0.5 text-[10px] ${over ? "border-rose-500 text-rose-500" : "text-muted-foreground"}`}>
                      {PLATFORM_META[p].label}
                      {p === "x" ? ` · ${len}/280` : ""}
                    </span>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground">Hashtags and any disclaimer are appended automatically on publish.</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending || platforms.length === 0}>
            {pending ? "Preparing…" : scheduleAt ? "Schedule" : "Prepare now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
