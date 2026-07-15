"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, Hand, Plug, Pause, Plug2, PlugZap, RefreshCw } from "lucide-react";
import { updateBrandProfile, setPlatformConfig } from "./actions";
import { connectXAccount, connectTelegramAccount, testAccount, disconnectAccount } from "./account-actions";
import { PLATFORM_META, type BrandProfile, type PlatformConfig } from "@/lib/social-types";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function BrandEditor({ brand }: { brand: BrandProfile }) {
  const meta = SITE_META[brand.site as SiteKey];
  const [voice, setVoice] = useState(brand.voice ?? "");
  const [audience, setAudience] = useState(brand.audience ?? "");
  const [hashtags, setHashtags] = useState(brand.hashtags.join(" "));
  const [ctaUrl, setCtaUrl] = useState(brand.ctaUrl ?? "");
  const [nfa, setNfa] = useState(brand.notFinancialAdvice);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const r = await updateBrandProfile(brand.site, { voice, audience, hashtags, ctaUrl, notFinancialAdvice: nfa });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <span className={`size-2.5 rounded-full ${meta?.dot ?? "bg-muted"}`} />
        <CardTitle className="text-sm">{meta?.name ?? brand.site}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`voice-${brand.site}`}>Brand voice</Label>
          <Textarea id={`voice-${brand.site}`} value={voice} onChange={(e) => setVoice(e.target.value)} rows={2} className="text-sm" />
          <p className="text-[11px] text-muted-foreground">Fed to the generator as the tone for every post.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`aud-${brand.site}`}>Audience</Label>
          <Input id={`aud-${brand.site}`} value={audience} onChange={(e) => setAudience(e.target.value)} className="text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`tags-${brand.site}`}>Hashtags</Label>
            <Input id={`tags-${brand.site}`} value={hashtags} onChange={(e) => setHashtags(e.target.value)} className="text-sm" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`cta-${brand.site}`}>CTA link</Label>
            <Input id={`cta-${brand.site}`} value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} className="text-sm" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-2.5">
          <div>
            <p className="text-sm font-medium">&quot;Not financial advice&quot; framing</p>
            <p className="text-[11px] text-muted-foreground">Auto-appended to every post (required for CheckInvestNg).</p>
          </div>
          <Switch checked={nfa} onCheckedChange={setNfa} />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save brand"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PlatformConfigRow({ cfg, telegramTokenSet = false }: { cfg: PlatformConfig; telegramTokenSet?: boolean }) {
  const [pending, start] = useTransition();
  const [perDay, setPerDay] = useState(String(cfg.perDay));
  const [times, setTimes] = useState(cfg.times.join(", "));
  const m = PLATFORM_META[cfg.platform];

  const upd = (patch: Parameters<typeof setPlatformConfig>[2]) =>
    start(async () => {
      await setPlatformConfig(cfg.site, cfg.platform, patch);
      toast.message(`${m.label} updated`);
    });

  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <Switch checked={cfg.enabled} onCheckedChange={(v) => upd({ enabled: v })} disabled={pending} />
      <span className="w-20 text-sm font-medium">{m.label}</span>

      <Select value={cfg.mode} onValueChange={(v) => upd({ mode: v as "autonomous" | "handoff" })} disabled={pending}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="autonomous">
            <Bot className="size-3.5" /> Autonomous
          </SelectItem>
          <SelectItem value="handoff">
            <Hand className="size-3.5" /> Manual handoff
          </SelectItem>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <Input
          value={perDay}
          onChange={(e) => setPerDay(e.target.value)}
          onBlur={() => Number(perDay) !== cfg.perDay && upd({ perDay: Number(perDay) || 0 })}
          className="h-8 w-14 text-center text-sm"
          aria-label="Posts per day"
        />
        <span className="text-xs text-muted-foreground">/day at</span>
        <Input
          value={times}
          onChange={(e) => setTimes(e.target.value)}
          onBlur={() => upd({ times: times.split(",") })}
          placeholder="09:00, 17:00"
          className="h-8 w-32 text-sm"
          aria-label="Posting times"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        {cfg.paused && (
          <Badge variant="destructive" className="gap-1">
            <Pause className="size-3" /> paused
          </Badge>
        )}
        {m.needsAccount ? (
          <ConnectAccountDialog
            site={cfg.site}
            platform={cfg.platform as "x" | "telegram"}
            connected={cfg.connected}
            handle={cfg.handle}
            telegramTokenSet={telegramTokenSet}
          />
        ) : (
          <Badge variant="outline" className="text-muted-foreground">manual posting</Badge>
        )}
      </div>
    </div>
  );
}

// Connect / manage an autonomous-posting account (X or Telegram). Stores the
// credentials encrypted in social_accounts — the same shape the publisher reads.
function ConnectAccountDialog({
  site, platform, connected, handle, telegramTokenSet,
}: {
  site: string;
  platform: "x" | "telegram";
  connected: boolean;
  handle: string | null;
  telegramTokenSet: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const label = PLATFORM_META[platform].label;

  // X fields
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [accessSecret, setAccessSecret] = useState("");
  // Telegram field
  const [chatId, setChatId] = useState(platform === "telegram" ? handle ?? "" : "");

  function connect() {
    start(async () => {
      const r = platform === "x"
        ? await connectXAccount(site, { apiKey, apiSecret, accessToken, accessSecret })
        : await connectTelegramAccount(site, chatId);
      if (!r.ok) { toast.error(r.message); return; }
      toast.success(r.message);
      setApiKey(""); setApiSecret(""); setAccessToken(""); setAccessSecret("");
      setOpen(false);
    });
  }
  function test() {
    start(async () => {
      const r = await testAccount(site, platform);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    });
  }
  function disconnect() {
    start(async () => {
      const r = await disconnectAccount(site, platform);
      r.ok ? toast.success(r.message) : toast.error(r.message);
      setOpen(false);
    });
  }

  return (
    <>
      {connected ? (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400" title="Manage connection">
          <Plug className="size-3" /> {handle ?? "connected"}
        </button>
      ) : (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <Plug2 className="size-3.5" /> Connect
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PlugZap className="size-4" /> {connected ? `Manage ${label}` : `Connect ${label}`}</DialogTitle>
            <DialogDescription>
              {platform === "x"
                ? "Paste the four keys from your brand's X developer app (OAuth 1.0a, with Read + Write). Stored encrypted; used to post autonomously."
                : "Add the bot to your channel as an admin, then enter the channel @username or numeric chat id. The bot token is the shared one in Settings → Secrets Vault."}
            </DialogDescription>
          </DialogHeader>

          {connected ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">Connected as <span className="font-medium">{handle}</span>.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="gap-1.5" onClick={test} disabled={pending}><RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> Test connection</Button>
                <Button variant="ghost" className="gap-1.5 text-destructive" onClick={disconnect} disabled={pending}>Disconnect</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">Re-connect below to replace the credentials.</p>
              {platform === "x" ? <XFields {...{ apiKey, setApiKey, apiSecret, setApiSecret, accessToken, setAccessToken, accessSecret, setAccessSecret }} /> : <TelegramFields chatId={chatId} setChatId={setChatId} tokenSet={telegramTokenSet} />}
            </div>
          ) : platform === "x" ? (
            <XFields {...{ apiKey, setApiKey, apiSecret, setApiSecret, accessToken, setAccessToken, accessSecret, setAccessSecret }} />
          ) : (
            <TelegramFields chatId={chatId} setChatId={setChatId} tokenSet={telegramTokenSet} />
          )}

          <DialogFooter>
            <Button onClick={connect} disabled={pending} className="gap-1.5"><Plug2 className="size-3.5" /> {pending ? "Verifying…" : connected ? "Re-connect" : "Connect"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function XFields(p: {
  apiKey: string; setApiKey: (v: string) => void;
  apiSecret: string; setApiSecret: (v: string) => void;
  accessToken: string; setAccessToken: (v: string) => void;
  accessSecret: string; setAccessSecret: (v: string) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <div className="grid gap-1.5"><Label>API key</Label><Input value={p.apiKey} onChange={(e) => p.setApiKey(e.target.value)} autoComplete="off" /></div>
      <div className="grid gap-1.5"><Label>API secret</Label><Input type="password" value={p.apiSecret} onChange={(e) => p.setApiSecret(e.target.value)} autoComplete="off" /></div>
      <div className="grid gap-1.5"><Label>Access token</Label><Input value={p.accessToken} onChange={(e) => p.setAccessToken(e.target.value)} autoComplete="off" /></div>
      <div className="grid gap-1.5"><Label>Access token secret</Label><Input type="password" value={p.accessSecret} onChange={(e) => p.setAccessSecret(e.target.value)} autoComplete="off" /></div>
    </div>
  );
}

function TelegramFields({ chatId, setChatId, tokenSet }: { chatId: string; setChatId: (v: string) => void; tokenSet: boolean }) {
  return (
    <div className="grid gap-2.5">
      {!tokenSet && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          No Telegram bot token yet. Add <code>telegram_bot_token</code> in Settings → Secrets Vault first, then connect each brand&apos;s channel here.
        </p>
      )}
      <div className="grid gap-1.5">
        <Label>Channel id or @username</Label>
        <Input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="@mybrandchannel  or  -1001234567890" autoComplete="off" />
      </div>
    </div>
  );
}
