"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { LayoutGrid } from "lucide-react";
import { generateCarouselAction } from "./carousel-actions";
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
import { cn } from "@/lib/utils";

export function CarouselDialog({ defaultSite }: { defaultSite: string }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "calculatry");
  const [topic, setTopic] = useState("");
  const [guidance, setGuidance] = useState("");
  const [aspect, setAspect] = useState<"portrait" | "square">("portrait");
  const [style, setStyle] = useState<"bold" | "minimal" | "editorial">("bold");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const r = await generateCarouselAction({ site, topic, guidance: guidance.trim() || undefined, aspect, style });
      if (r.ok) {
        toast.success(`Carousel drafted — ${r.slides} slides. It's in the Queue, ready for manual posting.`);
        setOpen(false);
        setTopic("");
        setGuidance("");
      } else toast.error(r.message ?? "Could not generate the carousel.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <LayoutGrid className="size-3.5" /> New carousel
          </Button>
        }
      />
      <DialogContent className="gap-5 p-6 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Instagram carousel</DialogTitle>
          <DialogDescription>
            Tess writes a swipeable set (a cover, 3 to 8 tips, and a call to action), renders 4:5 slides over one shared
            backdrop, and drops them into the manual posting queue.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
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
          <div className="grid gap-2">
            <Label htmlFor="c-topic">Topic</Label>
            <Input
              id="c-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. 5 resume mistakes that cost you interviews"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-guide">Extra direction (optional)</Label>
            <Textarea
              id="c-guide"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              rows={2}
              placeholder="Angle, audience, tone, or a page to point to…"
            />
          </div>
          <div className="grid gap-2">
            <Label>Shape</Label>
            <div className="flex flex-wrap items-center gap-2">
              {([
                { v: "portrait", label: "Portrait 4:5", hint: "Fills more of the feed" },
                { v: "square", label: "Square 1:1", hint: "Classic grid look" },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setAspect(o.v)}
                  title={o.hint}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    aspect === o.v ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Style</Label>
            <div className="flex flex-wrap items-center gap-2">
              {([
                { v: "bold", label: "Bold", hint: "Accent rail, big number chips, left aligned" },
                { v: "minimal", label: "Minimal", hint: "Airy, centred type, no rail" },
                { v: "editorial", label: "Editorial", hint: "Accent bar, oversized numerals, pill counter" },
              ] as const).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setStyle(o.v)}
                  title={o.hint}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    style === o.v ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">All three keep the brand palette and the shared backdrop. You can switch style later in the editor.</p>
          </div>
        </div>

        <DialogFooter className="-mx-6 -mb-6 p-6">
          <Button onClick={submit} disabled={pending || !topic.trim()}>
            {pending ? "Generating…" : "Generate carousel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
