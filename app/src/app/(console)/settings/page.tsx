import { SECRET_CATALOG, SECRET_CATEGORIES } from "@/lib/secrets-catalog";
import { listSecretState } from "@/lib/secrets";
import { listUsers, listPendingInvites } from "@/lib/team";
import { getCurrentUser, requireSectionView } from "@/lib/auth";
import { utcStamp, relativeTime } from "@/lib/format";
import { db } from "@/lib/db";
import { sites as sitesTable, settings as settingsTable, brandProfiles as brandProfilesTable } from "@/lib/db/schema";
import { listMailboxes } from "@/lib/mail/mailboxes";
import { availableProviders } from "@/lib/llm";
import { getNotificationRouting, getNotificationPrefs } from "@/lib/notifications";
import { getRouting, availableModelIds } from "@/lib/agent/routing";
import type { MailboxConfigLite, EmailSettings } from "@/lib/inbox-types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SecretsVault, type VaultRow } from "./settings-client";
import { TeamManager } from "./team-client";
import { MailboxManager } from "./mailboxes-client";
import { SitesEditor, NotificationRoutingForm, InAppNotificationsForm, BudgetsForm, DataForm, ModelRoutingForm, type SiteRow } from "./config-client";
import { getDesignMode } from "@/lib/design-mode";
import { AppearanceSettings } from "./appearance-settings";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

async function loadEmailSettings(): Promise<EmailSettings> {
  const rows = await db.select().from(settingsTable);
  const map = new Map(rows.map((r) => [r.key, r.value as Record<string, unknown>]));
  const ret = (map.get("email_retention") ?? {}) as { supportDays?: number; outreachDays?: number; autoPurge?: boolean };
  const caps = (map.get("outreach_caps") ?? {}) as { dailyCap?: number; perContactCooldownDays?: number };
  const prov = (map.get("email_providers") ?? {}) as { supportDraft?: string; allowDeepSeekSupport?: boolean };
  return {
    supportDays: ret.supportDays ?? 365,
    outreachDays: ret.outreachDays ?? 730,
    autoPurge: ret.autoPurge ?? true,
    dailyCap: caps.dailyCap ?? 10,
    perContactCooldownDays: caps.perContactCooldownDays ?? 7,
    supportDraft: prov.supportDraft ?? "auto",
    allowDeepSeekSupport: prov.allowDeepSeekSupport ?? false,
  };
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionView("/settings");
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "vault";
  const [state, currentUser, userRows, invites, boxes, emailSettings, providers, siteRows, routing, settingsRows, brandRows] = await Promise.all([
    listSecretState(),
    getCurrentUser(),
    listUsers(),
    listPendingInvites(),
    listMailboxes(),
    loadEmailSettings(),
    availableProviders(),
    db.select().from(sitesTable),
    getNotificationRouting(),
    db.select().from(settingsTable),
    db.select().from(brandProfilesTable),
  ]);
  const briefByKey = new Map(brandRows.map((b) => [b.site, b.brief ?? ""]));
  const [modelRouting, modelAvail, notifPrefs] = await Promise.all([getRouting(), availableModelIds(), getNotificationPrefs()]);
  const design = await getDesignMode();

  const settingsMap = new Map(settingsRows.map((r) => [r.key, r.value]));
  const sitesData: SiteRow[] = siteRows.map((s) => ({
    key: s.key,
    name: s.name,
    domain: s.domain,
    timezone: s.timezone,
    sitemaps: (s.sitemaps as string[]) ?? [],
    competitors: ((s.competitors as unknown[]) ?? []).length,
    brief: briefByKey.get(s.key) ?? "",
    accent: s.accent,
  }));
  const budgets = (settingsMap.get("budgets") as { monthlyCapUsd?: number; degradeAtPct?: number }) ?? {};
  const analyticsDays = Number(settingsMap.get("analytics_retention_days") ?? 90);

  const mailboxConfigs: MailboxConfigLite[] = boxes.map((b) => ({
    id: b.id,
    site: b.site,
    address: b.address,
    displayName: b.displayName,
    purpose: b.purpose,
    imapHost: b.imapHost,
    imapPort: b.imapPort,
    imapSecure: b.imapSecure,
    smtpHost: b.smtpHost,
    smtpPort: b.smtpPort,
    smtpSecure: b.smtpSecure,
    username: b.username,
    signature: b.signature,
    enabled: b.enabled,
    autoReply: b.autoReply,
    status: b.status,
    lastError: b.lastError,
    lastSyncAt: b.lastSyncAt ? b.lastSyncAt.toISOString() : null,
  }));

  const members = userRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    lastLogin: u.lastLoginAt ? relativeTime(u.lastLoginAt) : "never",
  }));
  const pendingInvites = invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invitedBy,
    expires: utcStamp(i.expiresAt),
  }));

  const rows: VaultRow[] = SECRET_CATALOG.map((def) => {
    const s = state[def.key];
    return {
      key: def.key,
      label: def.label,
      category: def.category,
      help: def.help,
      placeholder: def.placeholder,
      testable: def.testable,
      configured: !!s,
      status: s ? s.status : "unset",
      lastTested: s?.lastTestedAt ? utcStamp(s.lastTestedAt) : null,
      updatedInfo: s ? `${utcStamp(s.updatedAt)} by ${s.updatedBy}` : null,
    };
  });

  const groups = SECRET_CATEGORIES.map((category) => ({
    category,
    items: rows.filter((r) => r.category === category),
  }));

  return (
    <div data-section="settings" className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Connections, team, and preferences. Secrets are encrypted (AES-256-GCM) and never
          leave the server in plaintext.
        </p>
      </div>

      <AppearanceSettings current={design} />

      <Tabs defaultValue={tab} className="gap-5">
        <TabsList>
          <TabsTrigger value="vault">Secrets Vault</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="mailboxes">Mailboxes</TabsTrigger>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="vault">
          <SecretsVault groups={groups} />
        </TabsContent>

        <TabsContent value="models">
          <ModelRoutingForm initial={modelRouting} availableIds={[...modelAvail]} />
        </TabsContent>

        <TabsContent value="mailboxes">
          <MailboxManager mailboxes={mailboxConfigs} emailSettings={emailSettings} providers={providers} />
        </TabsContent>

        <TabsContent value="sites">
          <SitesEditor sites={sitesData} />
        </TabsContent>

        <TabsContent value="notifications">
          <div className="flex flex-col gap-8">
            <NotificationRoutingForm initial={routing} />
            <InAppNotificationsForm initial={notifPrefs} />
          </div>
        </TabsContent>

        <TabsContent value="budgets">
          <BudgetsForm initial={{ monthlyCapUsd: budgets.monthlyCapUsd ?? 20, degradeAtPct: budgets.degradeAtPct ?? 80 }} />
        </TabsContent>

        <TabsContent value="data">
          <DataForm analyticsDays={analyticsDays} />
        </TabsContent>

        <TabsContent value="team">
          <TeamManager
            members={members}
            pending={pendingInvites}
            isOwner={currentUser?.role === "admin"}
            currentUserId={currentUser?.id ?? ""}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
