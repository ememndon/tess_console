"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus, Sparkles, Send, Trash2, ShieldCheck, Ban, RotateCcw, Mail } from "lucide-react";
import {
  STAGE_META,
  CATEGORY_LABEL,
  OUTREACH_STAGES,
  OUTREACH_CATEGORIES,
  type ContactLite,
  type OutreachMessageLite,
  type OutreachStage,
} from "@/lib/inbox-types";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addContact,
  updateStage,
  setOptOut,
  deleteContact,
  loadContact,
  draftOutreach,
  saveOutreachMessage,
  discardOutreachMessage,
  approveAndSendOutreach,
} from "./outreach-actions";

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function AddContactButton({ defaultSite }: { defaultSite: string }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(SITE_KEYS.includes(defaultSite as SiteKey) ? defaultSite : "calculatry");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [category, setCategory] = useState("partner");
  const [source, setSource] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const r = await addContact({ site, name, email, org, category, source });
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setName("");
        setEmail("");
        setOrg("");
        setSource("");
      } else toast.error(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" className="gap-1.5"><UserPlus className="size-3.5" /> Add contact</Button>} />
      <DialogContent className="gap-5 p-6 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a contact</DialogTitle>
          <DialogDescription>
            Deliberately-added contacts only — never scraped. Record how/why you added them for compliance.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-5">
            <div className="grid gap-2">
              <Label>Site</Label>
              <Select value={site} onValueChange={(v) => v && setSite(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SITE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>{SITE_META[k].name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTREACH_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <div className="grid gap-2">
              <Label htmlFor="c-name">Name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="c-org">Org / site</Label>
              <Input id="c-org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="example.com" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-email">Email</Label>
            <Input id="c-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-source">How/why added (provenance)</Label>
            <Input id="c-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. embeds our calculator; emailed to discuss a partnership" />
          </div>
        </div>
        <DialogFooter className="-mx-6 -mb-6 p-6">
          <Button onClick={submit} disabled={pending}>{pending ? "Adding…" : "Add contact"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsTable({ contacts, scope }: { contacts: ContactLite[]; scope: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (contacts.length === 0) {
    return (
      <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
        No contacts yet. Add finance journalists, career bloggers, embed prospects or directory partners — one at a time.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium">Last contacted</th>
              <th className="px-3 py-2 font-medium">Msgs</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => {
              const meta = STAGE_META[c.stage];
              return (
                <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {scope === "all" && <span className={cn("size-2 shrink-0 rounded-full", SITE_META[c.site as SiteKey]?.dot)} />}
                      <div className="min-w-0">
                        <div className="redact truncate font-medium">{c.name || c.email}</div>
                        <div className="redact truncate text-[11px] text-muted-foreground">{c.org ? `${c.org} · ` : ""}{c.email}</div>
                      </div>
                      {c.optedOut && <Ban className="size-3.5 shrink-0 text-rose-500" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{CATEGORY_LABEL[c.category] ?? c.category}</td>
                  <td className="px-3 py-2"><Badge variant="outline" className={cn("border-0", meta.chip)}>{meta.label}</Badge></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmt(c.lastContactedAt)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">{c.messageCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ContactSheet contactId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ContactSheet({ contactId, onClose }: { contactId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<{ contact: ContactLite; messages: OutreachMessageLite[] } | null>(null);
  const [angle, setAngle] = useState("");
  const [composer, setComposer] = useState<{ messageId: string | null; subject: string; body: string } | null>(null);
  const [busy, start] = useTransition();

  function load(id: string) {
    loadContact(id).then((d) => {
      setDetail(d);
      const draft = d?.messages.find((m) => m.status === "draft");
      setComposer(draft ? { messageId: draft.id, subject: draft.subject, body: draft.bodyText } : null);
    });
  }

  // Load detail whenever the drawer opens for a new contact.
  useEffect(() => {
    if (contactId) load(contactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  function refresh() {
    if (detail) load(detail.contact.id);
  }

  function onDraft() {
    if (!detail) return;
    start(async () => {
      const r = await draftOutreach(detail.contact.id, angle || undefined);
      if (!r.ok) {
        toast.error(r.message ?? "Drafting failed");
        return;
      }
      const d = await loadContact(detail.contact.id);
      setDetail(d);
      const draft = d?.messages.find((m) => m.status === "draft");
      if (draft) setComposer({ messageId: draft.id, subject: draft.subject, body: draft.bodyText });
      toast.success("Draft ready — review before sending");
    });
  }

  function onSend() {
    if (!detail || !composer) return;
    start(async () => {
      const saved = await saveOutreachMessage({ messageId: composer.messageId ?? undefined, contactId: detail.contact.id, subject: composer.subject, body: composer.body });
      if (!saved.ok || !saved.messageId) {
        toast.error(saved.message ?? "Couldn't save");
        return;
      }
      const r = await approveAndSendOutreach(saved.messageId);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      setComposer(null);
      refresh();
    });
  }

  function onSave() {
    if (!detail || !composer) return;
    start(async () => {
      const r = await saveOutreachMessage({ messageId: composer.messageId ?? undefined, contactId: detail.contact.id, subject: composer.subject, body: composer.body });
      if (!r.ok) {
        toast.error(r.message ?? "Couldn't save");
        return;
      }
      setComposer((c) => (c ? { ...c, messageId: r.messageId ?? c.messageId } : c));
      toast.success("Draft saved");
      refresh();
    });
  }

  const c = detail?.contact;

  return (
    <Sheet
      open={!!contactId}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setDetail(null);
          setComposer(null);
          setAngle("");
        }
      }}
    >
      <SheetContent className="w-full !max-w-2xl">
        <SheetHeader>
          <SheetTitle className="redact">{c ? c.name || c.email : "Contact"}</SheetTitle>
          {c && (
            <p className="text-xs text-muted-foreground">
              <span className="redact">{c.org ? `${c.org} · ` : ""}{c.email}</span> · {CATEGORY_LABEL[c.category] ?? c.category} · {SITE_META[c.site as SiteKey]?.name}
            </p>
          )}
        </SheetHeader>

        {!c ? (
          <p className="px-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {/* Stage + controls */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={c.stage} onValueChange={(v) => v && start(async () => { await updateStage(c.id, v); refresh(); })}>
                <SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTREACH_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_META[s as OutreachStage].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {c.optedOut ? (
                <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => start(async () => { await setOptOut(c.id, false); refresh(); })}>
                  <RotateCcw className="size-3.5" /> Clear opt-out
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => start(async () => { await setOptOut(c.id, true); refresh(); })}>
                  <Ban className="size-3.5" /> Mark opted-out
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto gap-1.5 text-destructive"
                disabled={busy}
                onClick={() => start(async () => { await deleteContact(c.id); onClose(); setDetail(null); })}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </div>

            {c.source && <p className="rounded-md border bg-muted/20 p-2 text-[11px] text-muted-foreground"><span className="font-medium">Provenance:</span> {c.source}</p>}

            {/* Composer */}
            {c.optedOut ? (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600 dark:text-rose-400">
                This contact opted out — outreach is disabled.
              </div>
            ) : composer ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="size-3.5 text-emerald-500" /> Outreach draft — approval-gated</span>
                <Input value={composer.subject} onChange={(e) => setComposer({ ...composer, subject: e.target.value })} placeholder="Subject" className="h-8 text-sm" />
                <Textarea value={composer.body} onChange={(e) => setComposer({ ...composer, body: e.target.value })} rows={8} className="text-sm" />
                <div className="flex items-center gap-2">
                  <Button onClick={onSend} disabled={busy} className="gap-1.5"><Send className="size-3.5" /> Approve &amp; send</Button>
                  <Button variant="outline" onClick={onSave} disabled={busy}>Save draft</Button>
                  <Button variant="ghost" className="ml-auto gap-1.5" disabled={busy} onClick={onDraft}><Sparkles className="size-3.5" /> Redraft</Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Daily cap + per-contact cooldown enforced; opt-out honored.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <Label htmlFor="angle" className="text-xs">Angle / reason (optional)</Label>
                <Input id="angle" value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="e.g. our live FX rate data could support your markets coverage" className="h-8 text-sm" />
                <div className="flex gap-2">
                  <Button onClick={onDraft} disabled={busy} className="gap-1.5"><Sparkles className="size-3.5" /> Draft with Tess</Button>
                  <Button variant="outline" onClick={() => setComposer({ messageId: null, subject: "", body: "" })} disabled={busy}>Write manually</Button>
                </div>
              </div>
            )}

            {/* History */}
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">History</p>
              {detail!.messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">No messages yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {detail!.messages.map((m) => (
                    <div key={m.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Mail className="size-3 text-muted-foreground" />
                        <span className="font-medium">{m.subject}</span>
                        <Badge variant="outline" className={cn("ml-auto border-0 text-[10px]",
                          m.status === "sent" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                          m.status === "failed" ? "bg-rose-500/15 text-rose-500" :
                          m.status === "draft" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground")}>
                          {m.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-muted-foreground">{m.bodyText}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {m.status === "sent" ? `sent ${fmt(m.sentAt)}${m.approvedBy ? ` · approved by ${m.approvedBy}` : ""}` : `${m.generatedBy} · ${fmt(m.createdAt)}`}
                        {m.error ? ` · ${m.error}` : ""}
                      </p>
                      {m.status === "draft" && composer?.messageId !== m.id && (
                        <button className="mt-1 text-[10px] text-muted-foreground underline" onClick={() => discardOutreachMessage(m.id).then(refresh)}>discard</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
