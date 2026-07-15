"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, Upload, Trash2 } from "lucide-react";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import type { SubscriberLite } from "@/lib/inbox-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addSubscriber, importSubscribers, setSubscriberStatus, deleteSubscriber } from "./outreach-actions";

const statusChip: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  unsubscribed: "bg-zinc-500/15 text-zinc-500",
  bounced: "bg-rose-500/15 text-rose-500",
};

export function SubscriberActions({ defaultSite }: { defaultSite: string }) {
  return (
    <div className="flex gap-2">
      <AddSubscriber defaultSite={defaultSite} />
      <ImportSubscribers defaultSite={defaultSite} />
    </div>
  );
}

function AddSubscriber({ defaultSite }: { defaultSite: string }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "checkinvest");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  function submit() {
    start(async () => {
      const r = await addSubscriber({ site, email, name });
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setEmail("");
        setName("");
      } else toast.error(r.message);
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5"><UserPlus className="size-3.5" /> Add</Button>} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add subscriber</DialogTitle>
          <DialogDescription>Rate-alert / newsletter list. Add only people who asked to be on it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Site</Label>
            <Select value={site} onValueChange={(v) => v && setSite(v)}>
              <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SITE_KEYS.map((k) => <SelectItem key={k} value={k}>{SITE_META[k].name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="s-email">Email</Label><Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="s-name">Name (optional)</Label><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? "Adding…" : "Add"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportSubscribers({ defaultSite }: { defaultSite: string }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "checkinvest");
  const [blob, setBlob] = useState("");
  const [pending, start] = useTransition();
  function submit() {
    start(async () => {
      const r = await importSubscribers(site, blob);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setBlob("");
      } else toast.error(r.message);
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1.5"><Upload className="size-3.5" /> Import</Button>} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import subscribers</DialogTitle>
          <DialogDescription>Paste emails (comma, space or newline separated). Duplicates are skipped.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Site</Label>
            <Select value={site} onValueChange={(v) => v && setSite(v)}>
              <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SITE_KEYS.map((k) => <SelectItem key={k} value={k}>{SITE_META[k].name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Textarea value={blob} onChange={(e) => setBlob(e.target.value)} rows={8} placeholder={"a@example.com\nb@example.com"} />
        </div>
        <DialogFooter><Button onClick={submit} disabled={pending}>{pending ? "Importing…" : "Import"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SubscribersTable({ subscribers, scope }: { subscribers: SubscriberLite[]; scope: string }) {
  const [, start] = useTransition();
  if (subscribers.length === 0) {
    return <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">No subscribers yet. Add them manually or import a list.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Email</th>
            {scope === "all" && <th className="px-3 py-2 font-medium">Site</th>}
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {subscribers.map((s) => (
            <tr key={s.id} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2">
                <div className="redact font-medium">{s.email}</div>
                {s.name && <div className="redact text-[11px] text-muted-foreground">{s.name}</div>}
              </td>
              {scope === "all" && (
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={cn("size-2 rounded-full", SITE_META[s.site as SiteKey]?.dot)} />
                    {SITE_META[s.site as SiteKey]?.name ?? s.site}
                  </span>
                </td>
              )}
              <td className="px-3 py-2 text-xs text-muted-foreground">{s.source ?? "—"}</td>
              <td className="px-3 py-2"><Badge variant="outline" className={cn("border-0", statusChip[s.status])}>{s.status}</Badge></td>
              <td className="px-3 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {s.status === "active" ? (
                    <Button variant="ghost" size="xs" onClick={() => start(() => { setSubscriberStatus(s.id, "unsubscribed"); })}>Unsubscribe</Button>
                  ) : (
                    <Button variant="ghost" size="xs" onClick={() => start(() => { setSubscriberStatus(s.id, "active"); })}>Reactivate</Button>
                  )}
                  <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => start(() => { deleteSubscriber(s.id); })}><Trash2 className="size-3.5" /></Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
