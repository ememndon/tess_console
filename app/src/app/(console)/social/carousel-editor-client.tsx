"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Trash2, Plus, Save, Images, Wand2 } from "lucide-react";
import type { QueuePost } from "@/lib/social-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { updateCarouselAction, regenerateSlideAction } from "./carousel-edit-actions";

type Def = { kind: "cover" | "point" | "cta"; title: string; body: string };

// Per-slide carousel editor. The slide list is canonical by position: index 0 is the
// cover, the last is the CTA, everything between is a numbered tip. Editing text,
// reordering tips, adding/removing tips, changing the shape or swapping the backdrop
// all re-render the whole set on the server (positions drive the counter + tip numbers).
export function CarouselEditor({ post }: { post: QueuePost }) {
  const router = useRouter();
  const [defs, setDefs] = useState<Def[]>(
    (post.carousel?.slides ?? []).map((s) => ({ kind: s.kind, title: s.title, body: s.body ?? "" })),
  );
  const [aspect, setAspect] = useState<"portrait" | "square">(post.carousel?.aspect ?? "portrait");
  const [style, setStyle] = useState<"bold" | "minimal" | "editorial">(post.carousel?.style ?? "bold");
  const [bgMode, setBgMode] = useState<"keep" | "stock" | "ai">("keep");
  const [bgPrompt, setBgPrompt] = useState("");
  const [redoing, setRedoing] = useState<number | null>(null); // slide being rewritten
  const [busy, start] = useTransition();

  if (!post.carousel || defs.length < 3) return null;
  const lastIdx = defs.length - 1;

  const setField = (i: number, k: "title" | "body", v: string) =>
    setDefs((d) => d.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (i <= 0 || i >= lastIdx || j <= 0 || j >= lastIdx) return; // tips stay between cover + CTA
    setDefs((d) => { const c = [...d]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  };
  const del = (i: number) => {
    if (i <= 0 || i >= lastIdx) return; // never remove the cover or CTA
    if (defs.length <= 3) { toast.error("Keep at least one tip between the cover and the CTA."); return; }
    setDefs((d) => d.filter((_, j) => j !== i));
  };
  const addTip = () =>
    setDefs((d) => { const c = [...d]; c.splice(c.length - 1, 0, { kind: "point", title: "", body: "" }); return c; });

  // The cleaned, positional slide list the server expects (cover first, CTA last).
  function payload(): Def[] | null {
    const cleaned = defs.map((d) => ({ title: d.title.trim(), body: d.body.trim() }));
    if (cleaned.some((d) => !d.title)) { toast.error("Every slide needs a title."); return null; }
    if (cleaned.length < 3) { toast.error("A carousel needs a cover, a tip, and a CTA."); return null; }
    return cleaned.map((d, i) => ({
      kind: i === 0 ? "cover" : i === cleaned.length - 1 ? "cta" : "point",
      title: d.title,
      body: d.body,
    }));
  }
  // Resync the fields with what the server actually rendered (titles trimmed, bodies
  // sentence-clamped, a rewritten slide's new copy).
  const syncDefs = (next?: { kind: "cover" | "point" | "cta"; title: string; body?: string }[]) => {
    if (next?.length) setDefs(next.map((d) => ({ kind: d.kind, title: d.title, body: d.body ?? "" })));
  };
  const wire = (p: Def[]) => p.map((d) => ({ kind: d.kind, title: d.title, body: d.body || undefined }));

  function save() {
    const p = payload();
    if (!p) return;
    start(async () => {
      const r = await updateCarouselAction({
        postId: post.id,
        defs: wire(p),
        aspect,
        style,
        background: bgMode === "keep" ? undefined : { mode: bgMode, prompt: bgPrompt.trim() || undefined },
      });
      if (!r.ok) { toast.error(r.message ?? "Couldn't update the carousel."); return; }
      syncDefs(r.defs);
      toast.success(`Carousel re-rendered — ${r.slides} slides.`);
      setBgMode("keep"); setBgPrompt("");
      router.refresh(); // pull the re-rendered slides (new media ids bust the cache)
    });
  }

  // Rewrite ONE slide's copy with the model. Sends the current (possibly unsaved)
  // slides so an in-progress edit is never thrown away.
  function rewrite(i: number) {
    const p = payload();
    if (!p) return;
    setRedoing(i);
    start(async () => {
      const r = await regenerateSlideAction(post.id, i, wire(p));
      setRedoing(null);
      if (!r.ok) { toast.error(r.message ?? "Couldn't rewrite that slide."); return; }
      syncDefs(r.defs);
      toast.success("Slide rewritten and re-rendered.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium"><Images className="size-4 text-muted-foreground" /> Edit carousel slides</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["bold", "minimal", "editorial"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              title={s === "bold" ? "Accent rail, number chips, left aligned" : s === "minimal" ? "Airy, centred type, no rail" : "Accent bar, oversized numerals, pill counter"}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors",
                style === s ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              {s}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {(["portrait", "square"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAspect(a)}
              title={a === "portrait" ? "Portrait 4:5" : "Square 1:1"}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                aspect === a ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40",
              )}
            >
              {a === "portrait" ? "4:5" : "1:1"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {defs.map((d, i) => {
          const isPoint = i > 0 && i < lastIdx;
          const label = i === 0 ? "Cover" : i === lastIdx ? "Call to action" : `Tip ${i}`;
          return (
            <div key={i} className="rounded-md border bg-muted/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">{label}{redoing === i && <span className="ml-2 font-normal text-primary">rewriting…</span>}</span>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => rewrite(i)} disabled={busy} title="Rewrite this slide's copy with AI" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30">
                    <Wand2 className={cn("size-3.5", redoing === i && "animate-pulse text-primary")} />
                  </button>
                  {isPoint && (
                    <>
                      <button type="button" onClick={() => move(i, -1)} disabled={i <= 1} title="Move up" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i >= lastIdx - 1} title="Move down" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                      <button type="button" onClick={() => del(i)} title="Delete tip" className="rounded p-1 text-destructive transition-colors hover:bg-destructive/10"><Trash2 className="size-3.5" /></button>
                    </>
                  )}
                </div>
              </div>
              <Input value={d.title} onChange={(e) => setField(i, "title", e.target.value)} placeholder={i === 0 ? "The hook" : "Slide title"} className="mb-2 text-sm" />
              <Textarea
                value={d.body}
                onChange={(e) => setField(i, "body", e.target.value)}
                rows={2}
                placeholder={i === 0 ? "Optional subhead" : i === lastIdx ? "Optional supporting line" : "One or two short sentences"}
                className="text-sm"
              />
            </div>
          );
        })}
        <Button variant="outline" size="sm" onClick={addTip} className="gap-1.5 self-start"><Plus className="size-3.5" /> Add tip slide</Button>
      </div>

      <div className="border-t p-4">
        <span className="text-xs font-semibold">Shared backdrop</span>
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
              placeholder={bgMode === "stock" ? "Optional photo search (blank = auto)" : "Optional scene (blank = auto)"}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {bgMode === "ai"
                ? "Generates a fresh, text-free backdrop with FLUX (uses a paid image credit) and re-composites every slide on top."
                : "Pulls a new royalty-free photo and re-composites every slide on top."}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button size="sm" onClick={save} disabled={busy} className="gap-1.5"><Save className="size-3.5" /> {busy ? "Re-rendering…" : "Save & re-render"}</Button>
        <span className="text-[11px] text-muted-foreground">Re-renders every slide in the chosen style over the shared backdrop, and refreshes the posting bundle.</span>
      </div>
    </div>
  );
}
