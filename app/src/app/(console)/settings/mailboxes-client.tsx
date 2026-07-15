"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail, Plus, Pencil, Trash2, PlugZap, CheckCircle2, XCircle, CircleDashed } from "lucide-react";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { PURPOSE_LABEL, MAILBOX_PURPOSES, type MailboxConfigLite, type EmailSettings } from "@/lib/inbox-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { saveMailbox, testMailboxAction, deleteMailboxAction, saveEmailSettings, setMailboxAutoReplyAction } from "./mailbox-actions";

const HOSTINGER = { imapHost: "imap.hostinger.com", imapPort: 993, smtpHost: "smtp.hostinger.com", smtpPort: 465 };

const statusIcon: Record<string, React.ReactNode> = {
  ok: <CheckCircle2 className="size-4 text-emerald-500" />,
  failed: <XCircle className="size-4 text-rose-500" />,
  untested: <CircleDashed className="size-4 text-muted-foreground" />,
};

export function MailboxManager({
  mailboxes,
  emailSettings,
  providers,
}: {
  mailboxes: MailboxConfigLite[];
  emailSettings: EmailSettings;
  providers: string[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Connected mailboxes</h3>
            <p className="text-xs text-muted-foreground">Hostinger IMAP (read) + SMTP (send) per site address.</p>
          </div>
          <MailboxForm trigger={<Button size="sm" className="gap-1.5"><Plus className="size-3.5" /> Add mailbox</Button>} />
        </div>

        {mailboxes.length === 0 ? (
          <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
            <Mail className="mx-auto mb-2 size-6 opacity-40" />
            No mailboxes yet. Add one with your Hostinger email address + password.
          </div>
        ) : (
          <div className="grid gap-2">
            {mailboxes.map((m) => (
              <MailboxCard key={m.id} box={m} />
            ))}
          </div>
        )}
      </section>

      <EmailSettingsForm initial={emailSettings} providers={providers} />
    </div>
  );
}

function MailboxCard({ box }: { box: MailboxConfigLite }) {
  const [testing, startTest] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [savingAuto, startAuto] = useTransition();
  const [autoReply, setAutoReply] = useState(box.autoReply);
  const meta = SITE_META[box.site as SiteKey];

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <span className={cn("size-2.5 shrink-0 rounded-full", meta?.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{box.address}</span>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">{PURPOSE_LABEL[box.purpose] ?? box.purpose}</Badge>
          {!box.enabled && <Badge variant="outline" className="text-[10px] text-muted-foreground">disabled</Badge>}
          {!autoReply && <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">no auto-reply</Badge>}
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {box.displayName} · IMAP {box.imapHost}:{box.imapPort} · SMTP {box.smtpHost}:{box.smtpPort}
          {box.lastError ? ` · ${box.lastError}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="When on, Tess auto-drafts replies for new mail in this mailbox. Turn off to stop her drafting for it.">
          <Switch
            checked={autoReply}
            disabled={savingAuto}
            onCheckedChange={(v) => {
              setAutoReply(v);
              startAuto(async () => {
                const r = await setMailboxAutoReplyAction(box.id, v);
                if (r.ok) toast.success(r.message);
                else { toast.error(r.message); setAutoReply(!v); }
              });
            }}
          />
          Auto-reply
        </label>
        <span title={box.status}>{statusIcon[box.status] ?? statusIcon.untested}</span>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={testing}
          onClick={() => startTest(async () => {
            const r = await testMailboxAction(box.id);
            r.ok ? toast.success(r.message) : toast.error(r.message);
          })}
        >
          <PlugZap className="size-3.5" /> {testing ? "Testing…" : "Test"}
        </Button>
        <MailboxForm box={box} trigger={<Button variant="ghost" size="icon-sm"><Pencil className="size-3.5" /></Button>} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive"
          disabled={deleting}
          onClick={() => {
            if (confirm(`Delete mailbox ${box.address}? Cached mail for it is removed too.`))
              startDelete(async () => {
                await deleteMailboxAction(box.id);
                toast.success("Mailbox removed");
              });
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function MailboxForm({ box, trigger }: { box?: MailboxConfigLite; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(box?.site ?? "calculatry");
  const [address, setAddress] = useState(box?.address ?? "");
  const [displayName, setDisplayName] = useState(box?.displayName ?? "");
  const [purpose, setPurpose] = useState(box?.purpose ?? "support");
  const [username, setUsername] = useState(box?.username ?? "");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState(box?.imapHost ?? HOSTINGER.imapHost);
  const [imapPort, setImapPort] = useState(String(box?.imapPort ?? HOSTINGER.imapPort));
  const [smtpHost, setSmtpHost] = useState(box?.smtpHost ?? HOSTINGER.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(box?.smtpPort ?? HOSTINGER.smtpPort));
  const [signature, setSignature] = useState(box?.signature ?? "");
  const [enabled, setEnabled] = useState(box?.enabled ?? true);
  const [pending, start] = useTransition();

  // Default the username/displayName to the address as the admin types.
  function onAddress(v: string) {
    setAddress(v);
    if (!box && !username) setUsername(v);
  }

  function submit() {
    start(async () => {
      const r = await saveMailbox({
        id: box?.id,
        site,
        address,
        displayName: displayName || address,
        purpose,
        username: username || address,
        password: password || undefined,
        imapHost,
        imapPort: Number(imapPort) || 993,
        imapSecure: (Number(imapPort) || 993) !== 143, // 993 = implicit TLS, 143 = STARTTLS
        smtpHost,
        smtpPort: Number(smtpPort) || 465,
        smtpSecure: (Number(smtpPort) || 465) === 465, // 465 = implicit TLS, 587 = STARTTLS
        signature: signature || null,
        enabled,
      });
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        setPassword("");
      } else toast.error(r.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{box ? `Edit mailbox` : "Add a mailbox"}</DialogTitle>
          <DialogDescription>
            Hostinger stays the mail server — Tess just reads over IMAP and sends over SMTP. Defaults below are
            pre-filled for Hostinger; change them only for a non-Hostinger mailbox.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[64vh] gap-6 overflow-y-auto pr-1">
          {/* Identity */}
          <Section title="Mailbox" hint="Which brand this inbox belongs to and how replies are signed.">
            <Field label="Site">
              <Select value={site} onValueChange={(v) => v && setSite(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SITE_KEYS.map((k) => <SelectItem key={k} value={k}>{SITE_META[k].name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Purpose">
              <Select value={purpose} onValueChange={(v) => v && setPurpose(v)}>
                <SelectTrigger size="sm" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{MAILBOX_PURPOSES.map((p) => <SelectItem key={p} value={p}>{PURPOSE_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Email address" full htmlFor="mb-addr">
              <Input id="mb-addr" type="email" value={address} onChange={(e) => onAddress(e.target.value)} placeholder="support@calculatry.com" />
            </Field>
            <Field label="Display name" htmlFor="mb-dn" hint="Shown as the sender name on replies.">
              <Input id="mb-dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Calculatry Support" />
            </Field>
            <Field label="Username" htmlFor="mb-user" hint="Usually the full email address.">
              <Input id="mb-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={address || "support@calculatry.com"} />
            </Field>
          </Section>

          {/* Auth */}
          <Section title="Sign-in" hint="Stored encrypted (AES-256-GCM). The password never leaves the server in plaintext.">
            <Field label={`Password${box ? " — leave blank to keep current" : ""}`} full htmlFor="mb-pass">
              <Input id="mb-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={box ? "••••••••  (unchanged)" : "mailbox password"} />
            </Field>
          </Section>

          {/* Servers */}
          <Section title="Servers" hint="TLS is chosen automatically by port (993/465 = SSL, 143/587 = STARTTLS).">
            <Field label="IMAP host" htmlFor="mb-ih"><Input id="mb-ih" value={imapHost} onChange={(e) => setImapHost(e.target.value)} /></Field>
            <Field label="IMAP port" htmlFor="mb-ip"><Input id="mb-ip" inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value)} /></Field>
            <Field label="SMTP host" htmlFor="mb-sh"><Input id="mb-sh" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></Field>
            <Field label="SMTP port" htmlFor="mb-sp"><Input id="mb-sp" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></Field>
          </Section>

          {/* Signature + state */}
          <Section title="Reply signature" hint="Appended to the bottom of every reply you send from this mailbox.">
            <Field label="Signature" full htmlFor="mb-sig">
              <Textarea id="mb-sig" value={signature} onChange={(e) => setSignature(e.target.value)} rows={2} placeholder={"— The Calculatry team"} />
            </Field>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5 text-sm">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <span>
                  <span className="font-medium">Enabled</span>
                  <span className="block text-[11px] text-muted-foreground">Syncs new mail and can send. Turn off to pause without deleting.</span>
                </span>
              </label>
            </div>
          </Section>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : box ? "Save changes" : "Add mailbox"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Two-column section with a heading + hint; children are Fields.
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="border-b pb-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>}
      </div>
      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, hint, full, children }: { label: string; htmlFor?: string; hint?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("grid gap-1.5", full && "sm:col-span-2")}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EmailSettingsForm({ initial, providers }: { initial: EmailSettings; providers: string[] }) {
  const [s, setS] = useState<EmailSettings>(initial);
  const [pending, start] = useTransition();
  const compliant = providers.includes("gemini") || providers.includes("groq");

  function save() {
    start(async () => {
      const r = await saveEmailSettings(s);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Email policy</h3>
        <p className="text-xs text-muted-foreground">Retention, outreach caps, and which AI provider drafts support replies.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="es-sd">Support mail retention (days)</Label>
          <Input id="es-sd" type="number" value={s.supportDays} onChange={(e) => setS({ ...s, supportDays: Number(e.target.value) })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="es-od">Outreach retention (days)</Label>
          <Input id="es-od" type="number" value={s.outreachDays} onChange={(e) => setS({ ...s, outreachDays: Number(e.target.value) })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="es-cap">Outreach daily cap</Label>
          <Input id="es-cap" type="number" value={s.dailyCap} onChange={(e) => setS({ ...s, dailyCap: Number(e.target.value) })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="es-cd">Per-contact cooldown (days)</Label>
          <Input id="es-cd" type="number" value={s.perContactCooldownDays} onChange={(e) => setS({ ...s, perContactCooldownDays: Number(e.target.value) })} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch checked={s.autoPurge} onCheckedChange={(v) => setS({ ...s, autoPurge: v })} /> Auto-purge old mail past retention
      </label>

      <div className="grid gap-1.5">
        <Label>Support-reply drafting provider</Label>
        <Select value={s.supportDraft} onValueChange={(v) => v && setS({ ...s, supportDraft: v })}>
          <SelectTrigger size="sm" className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (prefer strong-data provider)</SelectItem>
            <SelectItem value="gemini">Gemini{providers.includes("gemini") ? "" : " (no key)"}</SelectItem>
            <SelectItem value="groq">Groq{providers.includes("groq") ? "" : " (no key)"}</SelectItem>
            <SelectItem value="deepseek">DeepSeek{providers.includes("deepseek") ? "" : " (no key)"}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Support replies shouldn&rsquo;t default to the cheapest provider (personal data).
          {compliant
            ? " A strong-data-handling provider is connected. ✓"
            : " No Gemini/Groq key yet — add one in the Secrets Vault, or allow DeepSeek below."}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch checked={s.allowDeepSeekSupport} onCheckedChange={(v) => setS({ ...s, allowDeepSeekSupport: v })} />
        Allow DeepSeek for support drafting (override the default)
      </label>

      <div>
        <Button onClick={save} disabled={pending} size="sm">{pending ? "Saving…" : "Save email policy"}</Button>
      </div>
    </section>
  );
}
