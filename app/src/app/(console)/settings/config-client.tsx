"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Globe, Save, Bell, DollarSign, Database, BrainCircuit, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { SITE_META, SITE_ACCENTS, ACCENT_NAMES, type SiteKey, type AccentName } from "@/lib/site-scope";
import type { NotificationRouting } from "@/lib/notifications";
import { NOTIF_MODULES, type NotificationPrefs, type NotifSeverity } from "@/lib/notification-prefs";
import { cn } from "@/lib/utils";
import { saveNotificationRouting, saveNotificationPrefs } from "@/lib/notification-actions";
import { MODELS, TESS_TASKS, type ModelRouting } from "@/lib/agent/models";
import { updateSite, addSite, saveBudgets, saveDataRetention, saveModelRouting } from "./config-actions";

export type SiteRow = { key: string; name: string; domain: string; timezone: string; sitemaps: string[]; competitors: number; brief: string; accent: string };

// A row of accent swatches for picking a site's colour.
function AccentPicker({ value, onChange }: { value: string; onChange: (a: AccentName) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACCENT_NAMES.map((a) => (
        <button
          key={a}
          type="button"
          title={a}
          onClick={() => onChange(a)}
          className={cn("size-6 rounded-full ring-2 ring-offset-2 ring-offset-background transition", SITE_ACCENTS[a].dot, value === a ? "ring-foreground" : "ring-transparent hover:ring-border")}
        />
      ))}
    </div>
  );
}

function SectionHead({ icon: Icon, title, hint }: { icon: typeof Globe; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

// ── Sites registry ──
export function SitesEditor({ sites }: { sites: SiteRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionHead icon={Globe} title="Sites registry" hint="Domains, timezones, sitemaps, and the per-site knowledge brief Tess reads. Sitemaps feed the SEO crawlers; timezone drives scheduling." />
      <AddSiteForm />
      <div className="grid gap-3">
        {sites.map((s) => <SiteCard key={s.key} site={s} />)}
      </div>
    </div>
  );
}

// Onboard a new site. It adopts the same baseline as the others (default brand
// profile) and immediately appears across the console + in Tess's knowledge.
function AddSiteForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [accent, setAccent] = useState<AccentName>("amber");
  const [brief, setBrief] = useState("");
  const [pending, start] = useTransition();

  function reset() { setName(""); setDomain(""); setTimezone("UTC"); setAccent("amber"); setBrief(""); }
  function submit() {
    start(async () => {
      const r = await addSite({ name, domain, timezone, accent, brief });
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      reset(); setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Plus className="size-3.5" /> Add a site</Button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("size-2.5 rounded-full", SITE_ACCENTS[accent].dot)} />
        <span className="text-sm font-medium">Onboard a new site</span>
      </div>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
        <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My New Site" autoFocus /></div>
        <div className="grid gap-1.5"><Label>Domain</Label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" /></div>
        <div className="grid gap-1.5"><Label>Timezone</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Africa/Lagos" /></div>
        <div className="grid gap-1.5 sm:col-span-3"><Label>Accent colour</Label><AccentPicker value={accent} onChange={setAccent} /></div>
        <div className="grid gap-1.5 sm:col-span-3">
          <Label>Knowledge brief (optional) — what Tess should know about this site</Label>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} className="text-xs leading-relaxed" placeholder="Audience, brand voice, monetization, key pages & keywords… Markdown welcome. You can fill this in later." />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" className="gap-1.5" onClick={submit} disabled={pending}><Plus className="size-3.5" /> {pending ? "Adding…" : "Add site"}</Button>
        <Button size="sm" variant="ghost" onClick={() => { reset(); setOpen(false); }} disabled={pending}>Cancel</Button>
        <span className="text-[11px] text-muted-foreground">Mailbox, analytics &amp; social keys are configured separately, per site.</span>
      </div>
    </div>
  );
}

function SiteCard({ site }: { site: SiteRow }) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [domain, setDomain] = useState(site.domain);
  const [timezone, setTimezone] = useState(site.timezone);
  const [sitemaps, setSitemaps] = useState(site.sitemaps.join("\n"));
  const [brief, setBrief] = useState(site.brief);
  const isFounding = ["calculatry", "resumehub", "checkinvest"].includes(site.key);
  const [accent, setAccent] = useState<AccentName>((site.accent as AccentName) ?? "blue");
  const [pending, start] = useTransition();
  // Live preview from the current accent (founding sites keep their own token).
  const dot = isFounding ? (SITE_META[site.key as SiteKey]?.dot ?? "bg-muted") : (SITE_ACCENTS[accent]?.dot ?? "bg-muted");

  function save() {
    start(async () => {
      const r = await updateSite({ key: site.key, name, domain, timezone, sitemaps: sitemaps.split("\n"), brief, accent });
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("size-2.5 rounded-full", dot)} />
        <span className="text-sm font-medium">{site.name}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{site.competitors} competitors tracked</span>
      </div>
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
        <div className="grid gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Domain</Label><Input value={domain} onChange={(e) => setDomain(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Timezone</Label><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Africa/Lagos" /></div>
        {!isFounding && <div className="grid gap-1.5 sm:col-span-3"><Label>Accent colour</Label><AccentPicker value={accent} onChange={setAccent} /></div>}
        <div className="grid gap-1.5 sm:col-span-3"><Label>Sitemaps (one URL per line)</Label><Textarea value={sitemaps} onChange={(e) => setSitemaps(e.target.value)} rows={2} className="font-mono text-xs" /></div>
        <div className="grid gap-1.5 sm:col-span-3">
          <Label>Knowledge brief — what Tess knows about this site</Label>
          <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={10} className="text-xs leading-relaxed" placeholder="Audience, brand voice, monetization, key pages & keywords, competitors, do's & don'ts… Markdown welcome." />
          <p className="text-[11px] text-muted-foreground">Fed straight into Tess&apos;s system prompt. Add detail any time — the more she knows, the more on-brand her support replies, outreach, social copy and recommendations.</p>
        </div>
      </div>
      <div className="mt-3"><Button size="sm" className="gap-1.5" onClick={save} disabled={pending}><Save className="size-3.5" /> {pending ? "Saving…" : "Save"}</Button></div>
    </div>
  );
}

// ── Notification routing ──
export function NotificationRoutingForm({ initial }: { initial: NotificationRouting }) {
  const [r, setR] = useState<NotificationRouting>(initial);
  const [pending, start] = useTransition();
  const set = (sev: "info" | "warning" | "critical", ch: "telegram" | "email", v: boolean) => setR((cur) => ({ ...cur, [sev]: { ...cur[sev], [ch]: v } }));

  function save() {
    start(async () => {
      const res = await saveNotificationRouting(r);
      res.ok ? toast.success(res.message) : toast.error(res.message);
    });
  }

  const SEV = [
    { key: "critical" as const, label: "Critical", desc: "Site down, rate stale, posting failures" },
    { key: "warning" as const, label: "Warning", desc: "Disk filling, sync issues, error spikes" },
    { key: "info" as const, label: "Info", desc: "New mail, routine completions" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SectionHead icon={Bell} title="Notification routing" hint="Where each severity is delivered. Console bell always gets everything; Telegram/email delivery joins via the agent (Phase 7)." />
      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Severity</span><span className="w-16 text-center">Telegram</span><span className="w-16 text-center">Email</span>
        </div>
        {SEV.map((s) => (
          <div key={s.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b px-4 py-3 last:border-0">
            <div><div className="text-sm font-medium">{s.label}</div><div className="text-[11px] text-muted-foreground">{s.desc}</div></div>
            <div className="flex w-16 justify-center"><Switch checked={r[s.key].telegram} onCheckedChange={(v) => set(s.key, "telegram", v)} /></div>
            <div className="flex w-16 justify-center"><Switch checked={r[s.key].email} onCheckedChange={(v) => set(s.key, "email", v)} /></div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border p-4">
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={r.quietHours.enabled} onCheckedChange={(v) => setR((c) => ({ ...c, quietHours: { ...c.quietHours, enabled: v } }))} />
          <span><span className="font-medium">Quiet hours</span> <span className="text-[11px] text-muted-foreground">— mute Telegram/email except criticals</span></span>
        </label>
        {r.quietHours.enabled && (
          <div className="mt-3 flex items-center gap-3">
            <div className="grid gap-1.5"><Label>From (UTC)</Label><Input type="time" value={r.quietHours.start} onChange={(e) => setR((c) => ({ ...c, quietHours: { ...c.quietHours, start: e.target.value } }))} className="w-32" /></div>
            <div className="grid gap-1.5"><Label>To (UTC)</Label><Input type="time" value={r.quietHours.end} onChange={(e) => setR((c) => ({ ...c, quietHours: { ...c.quietHours, end: e.target.value } }))} className="w-32" /></div>
          </div>
        )}
      </div>
      <div><Button size="sm" className="gap-1.5" onClick={save} disabled={pending}><Save className="size-3.5" /> {pending ? "Saving…" : "Save routing"}</Button></div>
    </div>
  );
}

// ── In-app notification list (what shows in the bell + Notifications) ──
export function InAppNotificationsForm({ initial }: { initial: NotificationPrefs }) {
  const [p, setP] = useState<NotificationPrefs>({ ...initial, modules: { ...initial.modules } });
  const [pending, start] = useTransition();
  const toggleModule = (key: string, v: boolean) => setP((c) => ({ ...c, modules: { ...c.modules, [key]: v } }));

  const SEV: { key: NotifSeverity; label: string; desc: string }[] = [
    { key: "info", label: "Everything", desc: "Info, warnings and criticals" },
    { key: "warning", label: "Warnings & up", desc: "Hide routine info messages" },
    { key: "critical", label: "Criticals only", desc: "Just the urgent ones" },
  ];

  function save() {
    start(async () => {
      const res = await saveNotificationPrefs(p);
      res.ok ? toast.success(res.message) : toast.error(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHead icon={Bell} title="In-app notification list" hint="Decide what lands in the bell and the Notifications list — it shouldn't be every single activity. Telegram/email delivery is set above; pending approvals always appear." />

      <div className="rounded-xl border p-4">
        <Label className="text-xs">Minimum level to list</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {SEV.map((s) => (
            <button
              key={s.key}
              onClick={() => setP((c) => ({ ...c, minSeverity: s.key }))}
              className={cn("flex flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors", p.minSeverity === s.key ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              <span className="text-sm font-medium">{s.label}</span>
              <span className={cn("text-[11px]", p.minSeverity === s.key ? "text-background/80" : "text-muted-foreground")}>{s.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sources to list</div>
        {NOTIF_MODULES.map((m) => (
          <div key={m.key} className="flex items-center justify-between gap-4 border-b px-4 py-2.5 last:border-0">
            <div><div className="text-sm font-medium">{m.label}</div><div className="text-[11px] text-muted-foreground">{m.help}</div></div>
            <Switch checked={p.modules[m.key] ?? true} onCheckedChange={(v) => toggleModule(m.key, v)} />
          </div>
        ))}
      </div>
      <div><Button size="sm" className="gap-1.5" onClick={save} disabled={pending}><Save className="size-3.5" /> {pending ? "Saving…" : "Save list preferences"}</Button></div>
    </div>
  );
}

// ── Budgets ──
export function BudgetsForm({ initial }: { initial: { monthlyCapUsd: number; degradeAtPct: number } }) {
  const [cap, setCap] = useState(initial.monthlyCapUsd);
  const [pct, setPct] = useState(initial.degradeAtPct);
  const [pending, start] = useTransition();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <SectionHead icon={DollarSign} title="Budgets" hint="Monthly paid-API cap (excludes the Claude subscription + Hostinger). At the degrade threshold Tess drops to essentials and alerts you." />
      <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Monthly cap (USD)</Label><Input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} /></div>
        <div className="grid gap-1.5"><Label>Degrade at (% of cap)</Label><Input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value))} /></div>
      </div>
      <div><Button size="sm" className="gap-1.5" disabled={pending} onClick={() => start(async () => { const r = await saveBudgets({ monthlyCapUsd: cap, degradeAtPct: pct }); r.ok ? toast.success(r.message) : toast.error(r.message); })}><Save className="size-3.5" /> {pending ? "Saving…" : "Save budget"}</Button></div>
    </div>
  );
}

// ── Models / per-task AI routing ──
const tierChip: Record<string, string> = {
  light: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  standard: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  heavy: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

export function ModelRoutingForm({ initial, availableIds }: { initial: ModelRouting; availableIds: string[] }) {
  const [r, setR] = useState<ModelRouting>({ ...initial, tasks: { ...initial.tasks } });
  const [pending, start] = useTransition();
  const avail = new Set(availableIds);
  const usableModels = MODELS.filter((m) => avail.has(m.id));

  function opts(requireTools: boolean) {
    return MODELS.filter((m) => (requireTools ? m.tools && m.kind !== "gemini" : true));
  }

  function save() {
    start(async () => {
      const res = await saveModelRouting(r);
      res.ok ? toast.success(res.message) : toast.error(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHead icon={BrainCircuit} title="AI models" hint="Pick which model runs each job, or let Tess auto-route by difficulty (light → cheap, heavy → capable). Only providers with a key in the Secrets Vault are selectable." />

      {usableModels.length === 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
          No model keys yet. Add at least an Anthropic API key in the Secrets Vault to bring Tess online.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <span className="text-sm font-medium">Routing mode</span>
        <div className="flex rounded-lg border p-0.5 text-xs">
          {(["auto", "manual"] as const).map((m) => (
            <button key={m} onClick={() => setR({ ...r, mode: m })} className={cn("rounded-md px-3 py-1 capitalize transition-colors", r.mode === m ? "bg-foreground text-background" : "text-muted-foreground")}>{m}</button>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">{r.mode === "auto" ? "Tess picks the best available model per task by difficulty; per-task overrides below still win." : "Each task uses your explicit pick, falling back to the default model."}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Default</span>
          <select value={r.defaultModel} onChange={(e) => setR({ ...r, defaultModel: e.target.value })} className="h-8 rounded-md border bg-background px-2 text-xs">
            {opts(true).map((m) => <option key={m.id} value={m.id} disabled={!avail.has(m.id)}>{m.label}{avail.has(m.id) ? "" : " (no key)"}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Task</span><span>Model</span>
        </div>
        {TESS_TASKS.map((t) => (
          <div key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b px-4 py-2.5 last:border-0">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">{t.label}<Badge variant="outline" className={cn("border-0 text-[10px] capitalize", tierChip[t.tier])}>{t.tier}</Badge></div>
              <div className="text-[11px] text-muted-foreground">{t.help}</div>
            </div>
            <select
              value={r.tasks[t.id] ?? "auto"}
              onChange={(e) => setR({ ...r, tasks: { ...r.tasks, [t.id]: e.target.value } })}
              className="h-8 w-56 rounded-md border bg-background px-2 text-xs"
            >
              <option value="auto">Auto (by difficulty)</option>
              {opts(t.toolsNeeded).map((m) => (
                <option key={m.id} value={m.id} disabled={!avail.has(m.id)}>{m.provider}: {m.label}{avail.has(m.id) ? "" : " — no key"}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">Connected providers: {usableModels.length ? [...new Set(usableModels.map((m) => m.provider))].join(", ") : "none yet"}. The agent chat needs a tool-capable model (Anthropic, OpenAI, DeepSeek, Qwen, GLM, Kimi, MiniMax or Groq — not Gemini).</p>
      <div><Button size="sm" className="gap-1.5" onClick={save} disabled={pending}><Save className="size-3.5" /> {pending ? "Saving…" : "Save model routing"}</Button></div>
    </div>
  );
}

// ── Data / retention ──
export function DataForm({ analyticsDays }: { analyticsDays: number }) {
  const [days, setDays] = useState(analyticsDays);
  const [pending, start] = useTransition();
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <SectionHead icon={Database} title="Data retention" hint="How long raw analytics events are kept before the nightly rollup prunes them. Email retention lives in the Mailboxes tab." />
      <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Analytics raw events (days)</Label><Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
      </div>
      <div><Button size="sm" className="gap-1.5" disabled={pending} onClick={() => start(async () => { const r = await saveDataRetention({ analyticsDays: days }); r.ok ? toast.success(r.message) : toast.error(r.message); })}><Save className="size-3.5" /> {pending ? "Saving…" : "Save retention"}</Button></div>
    </div>
  );
}
