"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import { batchGenerate } from "./composer-actions";
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

// Batch pre-generation — write a topic per line; Tess drafts each in
// brand voice and schedules them across upcoming slots.
export function BatchDialog({ defaultSite }: { defaultSite: string }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "calculatry");
  const [topics, setTopics] = useState("");
  const [startAt, setStartAt] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    const list = topics.split("\n").map((t) => t.trim()).filter(Boolean);
    if (list.length === 0) {
      toast.error("Add at least one topic (one per line).");
      return;
    }
    start(async () => {
      const r = await batchGenerate({ site, topics: list, startAt: startAt ? new Date(startAt).toISOString() : undefined });
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setTopics("");
      } else toast.error(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <Layers className="size-3.5" /> Batch generate
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Batch pre-generate</DialogTitle>
          <DialogDescription>
            One topic per line. Tess drafts each in the brand voice and schedules them across the brand&apos;s upcoming
            posting slots — so publishing keeps running even when Tess is paused.
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
              <Label htmlFor="batch-start">Start (optional)</Label>
              <Input id="batch-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="topics">Topics (one per line, up to 14)</Label>
            <Textarea
              id="topics"
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              rows={6}
              placeholder={"How compound interest works\nBudgeting for first-time savers\nWhat a good emergency fund looks like"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Generating…" : "Generate & schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
