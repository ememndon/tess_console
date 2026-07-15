"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Telescope, Search, Plus, X, Mail, ExternalLink, ShieldCheck } from "lucide-react";
import { CATEGORY_LABEL, type ProspectLite } from "@/lib/inbox-types";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runProspecting, addProspectAsContact, dismissProspect } from "./prospecting-actions";

// The admin-initiated search bar. Tess only searches when this button is clicked.
export function ProspectFinder({ defaultSite }: { defaultSite: string }) {
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "calculatry");
  const [focus, setFocus] = useState("");
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      const r = await runProspecting(site, focus.trim() || undefined);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Telescope className="size-4 text-primary" />
        <span className="text-sm font-medium">Find prospects</span>
        <span className="text-xs text-muted-foreground">Tess searches the web only when you click — never on her own.</span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="grid gap-1.5">
          <label className="text-xs text-muted-foreground">Site</label>
          <Select value={site} onValueChange={(v) => v && setSite(v)}>
            <SelectTrigger size="sm" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SITE_KEYS.map((k) => (
                <SelectItem key={k} value={k}>{SITE_META[k].name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid flex-1 gap-1.5">
          <label className="text-xs text-muted-foreground">Focus (optional)</label>
          <Input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="e.g. Nigerian crypto blogs, university career centers…"
            className="h-9"
            onKeyDown={(e) => e.key === "Enter" && !pending && run()}
          />
        </div>
        <Button onClick={run} disabled={pending} className="gap-1.5">
          <Search className="size-3.5" />
          {pending ? "Searching…" : "Find prospects"}
        </Button>
      </div>
    </div>
  );
}

export function ProspectsList({ prospects, scope }: { prospects: ProspectLite[]; scope: string }) {
  const [busy, start] = useTransition();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = prospects.filter((p) => !hidden.has(p.id));

  function add(p: ProspectLite) {
    start(async () => {
      const r = await addProspectAsContact(p.id);
      if (r.ok) {
        toast.success(r.message);
        setHidden((h) => new Set(h).add(p.id));
      } else toast.error(r.message);
    });
  }
  function dismiss(p: ProspectLite) {
    setHidden((h) => new Set(h).add(p.id));
    start(async () => {
      await dismissProspect(p.id);
    });
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
        No prospects in the queue. Pick a site above and click{" "}
        <span className="font-medium text-foreground">Find prospects</span> — Tess will research candidates for you to review.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {visible.map((p) => (
        <div key={p.id} className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {scope === "all" && <span className={cn("size-2 shrink-0 rounded-full", SITE_META[p.site as SiteKey]?.dot)} />}
                <span className="redact truncate font-medium">{p.name || p.domain}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">{CATEGORY_LABEL[p.category] ?? p.category}</Badge>
                {typeof p.score === "number" && p.score > 0 && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{p.score}% match</span>
                )}
              </div>
              <a
                href={p.url ?? `https://${p.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="redact mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {p.domain}
                <ExternalLink className="size-3" />
              </a>
              {p.fitReason && <p className="redact mt-1.5 text-sm text-muted-foreground">{p.fitReason}</p>}
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs">
                <Mail className="size-3.5 text-muted-foreground" />
                {p.email ? (
                  <span className="redact font-medium">{p.email}</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">No public email found — open the site to get one</span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <Button size="sm" className="gap-1.5" disabled={busy || !p.email} onClick={() => add(p)}>
                <Plus className="size-3.5" /> Add
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" disabled={busy} onClick={() => dismiss(p)}>
                <X className="size-3.5" /> Dismiss
              </Button>
            </div>
          </div>
        </div>
      ))}
      <p className="inline-flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5 text-emerald-500" />
        Adding a prospect creates a deliberately-added contact (provenance recorded). Nothing here is emailed until you draft and approve a message.
      </p>
    </div>
  );
}
