"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { addCompetitor, removeCompetitor } from "./actions";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Per-site competitor list editor (competitor lists configurable).
export function CompetitorEditor({ site, competitors }: { site: string; competitors: string[] }) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const meta = SITE_META[site as SiteKey];

  function add() {
    const v = value.trim();
    if (!v) return;
    start(async () => {
      const r = await addCompetitor(site, v);
      if (r.error) toast.error(r.error);
      else {
        toast.success(`Tracking ${v}`);
        setValue("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${meta?.dot ?? "bg-muted"}`} />
        <span className="text-sm font-medium">{meta?.name ?? site}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {competitors.length === 0 && (
          <span className="text-xs text-muted-foreground">No competitors yet — add a domain below.</span>
        )}
        {competitors.map((host) => (
          <span key={host} className="inline-flex items-center gap-1 rounded-full border bg-card py-0.5 pl-2.5 pr-1 text-xs">
            {host}
            <button
              type="button"
              aria-label={`Remove ${host}`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await removeCompetitor(site, host);
                  toast.message(`Removed ${host}`);
                })
              }
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder="competitor-domain.com"
          className="h-8 max-w-xs text-sm"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={pending || !value.trim()}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}
