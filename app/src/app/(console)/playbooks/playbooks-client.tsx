"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  BookOpen, Plus, Search, Pencil, Trash2, Copy, GripVertical, ShieldCheck, X,
} from "lucide-react";
import { PB_CATEGORIES, PB_CATEGORY_META, PB_STATUSES, type PlaybookLite, type Step } from "@/lib/playbooks-types";
import type { DesignMode } from "@/lib/design-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { savePlaybook, deletePlaybook, duplicatePlaybook, type PlaybookInput } from "./playbook-actions";

function catChip(cat: string) {
  return PB_CATEGORY_META[cat]?.chip ?? PB_CATEGORY_META.general.chip;
}
function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PlaybooksClient({ playbooks, design = "pulse" }: { playbooks: PlaybookLite[]; design?: DesignMode }) {
  const fil = design === "filament";
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<PlaybookLite | "new" | null>(null);
  const [viewing, setViewing] = useState<PlaybookLite | null>(null);
  const [, start] = useTransition();

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of playbooks) c[p.category] = (c[p.category] ?? 0) + 1;
    return c;
  }, [playbooks]);

  const filtered = playbooks.filter((p) => {
    if (cat !== "all" && p.category !== cat) return false;
    if (q.trim()) {
      const hay = `${p.title} ${p.trigger ?? ""} ${p.tags.join(" ")} ${p.steps.map((s) => s.text).join(" ")}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div data-section="playbooks" className="flex flex-1 flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className={cn("text-xl font-semibold tracking-tight", fil && "text-white")}>Playbooks</h1>
            {fil && <span className="rounded-full border px-2.5 py-1 text-[9.5px] font-medium uppercase tracking-[0.16em]" style={{ borderColor: "rgba(39,240,212,0.3)", color: "#27f0d4" }}>SURFACE</span>}
          </div>
          <p className={cn("text-sm", fil ? "text-[#9398a3]" : "text-muted-foreground")}>
            The ops runbook library — Tess&rsquo;s brain. Humans write the procedures; each step is flagged
            whether it needs approval. Tess follows them.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setEditing("new")}><Plus className="size-3.5" /> New playbook</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          <FilterChip active={cat === "all"} onClick={() => setCat("all")} label="All" count={playbooks.length} />
          {PB_CATEGORIES.filter((c) => counts[c]).map((c) => (
            <FilterChip key={c} active={cat === c} onClick={() => setCat(c)} label={PB_CATEGORY_META[c].label} count={counts[c]} />
          ))}
        </div>
        <div className="relative ml-auto w-56">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search playbooks…" className="h-8 pl-7 text-xs" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-sm text-muted-foreground">
          <BookOpen className="mx-auto mb-2 size-6 opacity-40" />
          No playbooks here yet. Create one to capture a procedure.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const approvals = p.steps.filter((s) => s.needsApproval).length;
            return (
              <button key={p.id} onClick={() => setViewing(p)} className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("border-0", catChip(p.category))}>{PB_CATEGORY_META[p.category]?.label ?? p.category}</Badge>
                  {p.status !== "active" && <Badge variant="outline" className="text-[10px] text-muted-foreground">{p.status}</Badge>}
                  <span className="ml-auto text-[10px] text-muted-foreground">{p.steps.length} step{p.steps.length !== 1 ? "s" : ""}</span>
                </div>
                <h3 className="font-medium leading-tight">{p.title}</h3>
                {p.trigger && <p className="line-clamp-2 text-xs text-muted-foreground"><span className="font-medium">When:</span> {p.trigger}</p>}
                <div className="mt-auto flex items-center gap-2 pt-1 text-[10px] text-muted-foreground">
                  {approvals > 0 && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><ShieldCheck className="size-3" /> {approvals} approval{approvals !== 1 ? "s" : ""}</span>}
                  <span className="ml-auto">updated {fmt(p.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* View drawer */}
      <Sheet open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <SheetContent className="w-full !max-w-2xl">
          {viewing && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("border-0", catChip(viewing.category))}>{PB_CATEGORY_META[viewing.category]?.label}</Badge>
                  {viewing.status !== "active" && <Badge variant="outline" className="text-[10px] text-muted-foreground">{viewing.status}</Badge>}
                </div>
                <SheetTitle>{viewing.title}</SheetTitle>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
                {viewing.trigger && (
                  <div className="rounded-lg border bg-muted/20 p-3 text-sm"><span className="font-medium">Trigger:</span> {viewing.trigger}</div>
                )}
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Steps</p>
                  <ol className="flex flex-col gap-1.5">
                    {viewing.steps.map((s, i) => (
                      <li key={i} className="flex gap-2.5 rounded-lg border p-2.5 text-sm">
                        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{i + 1}</span>
                        <span className="flex-1">{s.text}</span>
                        {s.needsApproval && <Badge variant="outline" className="h-fit shrink-0 gap-1 border-0 bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400"><ShieldCheck className="size-3" /> approval</Badge>}
                      </li>
                    ))}
                  </ol>
                </div>
                {viewing.body && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notes</p>
                    <p className="whitespace-pre-line text-sm text-muted-foreground">{viewing.body}</p>
                  </div>
                )}
                {viewing.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">{viewing.tags.map((t) => <span key={t} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">#{t}</span>)}</div>
                )}
                <p className="text-[10px] text-muted-foreground">By {viewing.createdBy}{viewing.updatedBy && viewing.updatedBy !== viewing.createdBy ? `, last edited by ${viewing.updatedBy}` : ""} · {fmt(viewing.updatedAt)}</p>
              </div>
              <div className="flex items-center gap-2 border-t p-4">
                <Button size="sm" className="gap-1.5" onClick={() => { setEditing(viewing); setViewing(null); }}><Pencil className="size-3.5" /> Edit</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => start(async () => { await duplicatePlaybook(viewing.id); toast.success("Duplicated as draft"); setViewing(null); })}><Copy className="size-3.5" /> Duplicate</Button>
                <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-destructive" onClick={() => { if (confirm(`Delete “${viewing.title}”?`)) start(async () => { await deletePlaybook(viewing.id); toast.success("Deleted"); setViewing(null); }); }}><Trash2 className="size-3.5" /> Delete</Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {editing && <PlaybookEditor playbook={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button onClick={onClick} className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
      {label} <span className={cn("ml-0.5", active ? "opacity-70" : "text-muted-foreground/60")}>{count}</span>
    </button>
  );
}

function PlaybookEditor({ playbook, onClose }: { playbook: PlaybookLite | null; onClose: () => void }) {
  const [title, setTitle] = useState(playbook?.title ?? "");
  const [category, setCategory] = useState(playbook?.category ?? "general");
  const [trigger, setTrigger] = useState(playbook?.trigger ?? "");
  const [steps, setSteps] = useState<Step[]>(playbook?.steps?.length ? playbook.steps : [{ text: "", needsApproval: false }]);
  const [body, setBody] = useState(playbook?.body ?? "");
  const [tags, setTags] = useState((playbook?.tags ?? []).join(", "));
  const [status, setStatus] = useState(playbook?.status ?? "active");
  const [pending, start] = useTransition();

  function setStep(i: number, patch: Partial<Step>) { setSteps((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s))); }
  function addStep() { setSteps((cur) => [...cur, { text: "", needsApproval: false }]); }
  function removeStep(i: number) { setSteps((cur) => cur.filter((_, j) => j !== i)); }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function submit() {
    const input: PlaybookInput = { id: playbook?.id, title, category, trigger, steps, body, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), status };
    start(async () => {
      const r = await savePlaybook(input);
      if (r.ok) { toast.success(r.message); onClose(); } else toast.error(r.message);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 p-6 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{playbook ? "Edit playbook" : "New playbook"}</DialogTitle>
          <DialogDescription>A procedure Tess can follow. Mark the steps that require human approval.</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[64vh] gap-6 overflow-y-auto pr-2">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-[1fr_auto_auto]">
            <div className="grid gap-2">
              <Label htmlFor="pb-title">Title</Label>
              <Input id="pb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Respond to a traffic drop" />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{PB_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{PB_CATEGORY_META[c].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger size="sm" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{PB_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pb-trigger">Trigger <span className="text-muted-foreground">— when does this apply?</span></Label>
            <Input id="pb-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Organic traffic drops >20% week-over-week" />
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <span className="text-[11px] text-muted-foreground">Toggle the shield on steps that need approval</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="flex flex-col items-center pt-1.5">
                    <button type="button" onClick={() => moveStep(i, -1)} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={i === 0}><GripVertical className="size-3.5" /></button>
                    <span className="text-[10px] font-semibold text-muted-foreground">{i + 1}</span>
                  </div>
                  <Textarea value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} rows={2} placeholder={`Step ${i + 1}`} className="flex-1 text-sm" />
                  <button type="button" title={s.needsApproval ? "Needs approval" : "Autonomous"} onClick={() => setStep(i, { needsApproval: !s.needsApproval })}
                    className={cn("mt-1 rounded-md border p-1.5", s.needsApproval ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "text-muted-foreground hover:text-foreground")}>
                    <ShieldCheck className="size-4" />
                  </button>
                  <button type="button" onClick={() => removeStep(i)} className="mt-1 rounded-md p-1.5 text-muted-foreground hover:text-destructive" disabled={steps.length === 1}><X className="size-4" /></button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5" onClick={addStep}><Plus className="size-3.5" /> Add step</Button>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pb-body">Notes (optional)</Label>
            <Textarea id="pb-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Context, gotchas, links to docs…" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pb-tags">Tags (comma-separated)</Label>
            <Input id="pb-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="seo, incident" />
          </div>
        </div>

        <DialogFooter className="-mx-6 -mb-6 p-6">
          <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : playbook ? "Save changes" : "Create playbook"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
