import Link from "next/link";
import { Handshake, Users, ShieldCheck, UserSearch, Radio, MessageCircle, Banknote, Trophy, Telescope } from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { getContacts, getOutreachStats, getSubscribers, getSubscriberCounts, getDnsReport, getProspects } from "@/lib/outreach";
import { requireSectionView } from "@/lib/auth";
import { STAGE_META, DNS_KINDS, DNS_KIND_LABEL, DNS_STATUS_META, type OutreachStage } from "@/lib/inbox-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { StatTile, tileGradientClass, tileGlowShadow } from "@/components/stat-tile";
import { SectionHeader } from "@/components/filament/section-header";
import { AddContactButton, ContactsTable } from "./contacts-client";
import { SubscriberActions, SubscribersTable } from "./subscribers-client";
import { ProspectFinder, ProspectsList } from "./prospects-client";
import { RunDnsCheck } from "./dns-client";

export const metadata = { title: "Outreach CRM" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "contacts", label: "Contacts", icon: Handshake },
  { key: "prospects", label: "Prospects", icon: Telescope },
  { key: "subscribers", label: "Subscribers", icon: Users },
  { key: "deliverability", label: "Deliverability", icon: ShieldCheck },
] as const;

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionView("/outreach");
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" ? sp.tab : "contacts") as (typeof TABS)[number]["key"];
  const scope = await getSiteScope();
  const site = scope === "all" ? undefined : scope;
  const scopeName = scope === "all" ? "all sites" : SITE_META[scope as SiteKey].name;
  const defaultSite = scope === "all" ? "calculatry" : scope;

  return (
    <div data-section="outreach" className="flex flex-1 flex-col gap-5 p-6">
      <SectionHeader title="Outreach CRM" register="SURFACE">
        Compliant partnership outreach for {scopeName} — deliberately-added contacts, Tess-drafted, every send
        approval-gated. Not cold email.
      </SectionHeader>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/outreach?tab=${t.key}`}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.key ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" />
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "contacts" && <ContactsSection site={site} scope={scope} defaultSite={defaultSite} />}
      {tab === "prospects" && <ProspectsSection site={site} scope={scope} defaultSite={defaultSite} />}
      {tab === "subscribers" && <SubscribersSection site={site} scope={scope} defaultSite={defaultSite} />}
      {tab === "deliverability" && <DeliverabilitySection />}
    </div>
  );
}

async function ContactsSection({ site, scope, defaultSite }: { site?: string; scope: string; defaultSite: string }) {
  const [contacts, stats] = await Promise.all([getContacts(site), getOutreachStats()]);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        <StatTile icon={UserSearch} label="Prospect" value={stats.byStage.prospect ?? 0} color="violet" />
        <StatTile icon={Radio} label="Contacted" value={stats.byStage.contacted ?? 0} color="cyan" />
        <StatTile icon={MessageCircle} label="Replied" value={stats.byStage.replied ?? 0} color="pink" />
        <StatTile icon={Banknote} label="Negotiating" value={stats.byStage.negotiating ?? 0} color="amber" />
        <StatTile icon={Trophy} label="Won" value={stats.byStage.won ?? 0} color="emerald" />
        <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${tileGradientClass("orange")} p-4 text-white`} style={{ boxShadow: tileGlowShadow("orange") }}>
          <div aria-hidden className="pointer-events-none absolute -right-5 -top-7 size-24 rounded-full bg-white/15" />
          <span className="relative flex items-center gap-1.5 text-xs font-medium text-white/85">Sent today</span>
          <div className="relative mt-1.5 text-2xl font-bold tabular-nums">{stats.sentToday}</div>
          <div className="relative mt-0.5 text-[11px] font-medium text-white/80">cap: {stats.dailyCap}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <AddContactButton defaultSite={defaultSite} />
      </div>
      <ContactsTable contacts={contacts} scope={scope} />
    </div>
  );
}

async function ProspectsSection({ site, scope, defaultSite }: { site?: string; scope: string; defaultSite: string }) {
  const prospects = await getProspects(site);
  return (
    <div className="flex flex-col gap-4">
      <ProspectFinder defaultSite={defaultSite} />
      <ProspectsList prospects={prospects} scope={scope} />
    </div>
  );
}

async function SubscribersSection({ site, scope, defaultSite }: { site?: string; scope: string; defaultSite: string }) {
  const [subs, counts] = await Promise.all([getSubscribers(site), getSubscriberCounts()]);
  const siteColors = ["violet", "cyan", "emerald"] as const;
  const visibleSites = SITE_KEYS.filter((k) => scope === "all" || k === scope);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {visibleSites.map((k, i) => (
          <StatTile key={k} label={`${SITE_META[k].name} subscribers`} value={counts[k]?.active ?? 0} color={siteColors[i % siteColors.length]} />
        ))}
      </div>
      <div className="flex justify-end">
        <SubscriberActions defaultSite={defaultSite} />
      </div>
      <SubscribersTable subscribers={subs} scope={scope} />
    </div>
  );
}

async function DeliverabilitySection() {
  const rows = await getDnsReport();
  const byDomain = new Map<string, { site: string; domain: string; kinds: Map<string, (typeof rows)[number]> }>();
  for (const r of rows) {
    if (!byDomain.has(r.domain)) byDomain.set(r.domain, { site: r.site, domain: r.domain, kinds: new Map() });
    byDomain.get(r.domain)!.kinds.set(r.kind, r);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          SPF / DKIM / DMARC / MX pre-flight. You edit DNS in Hostinger; the console verifies. Fix any
          fails before running outreach so messages don&rsquo;t land in spam.
        </p>
        <RunDnsCheck />
      </div>

      {byDomain.size === 0 ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">
          No checks yet. Click <span className="font-medium text-foreground">Run check</span> to verify the three domains
          (also runs automatically every morning).
        </div>
      ) : (
        <div className="grid gap-3">
          {[...byDomain.values()].map((d) => (
            <div key={d.domain} className="rounded-xl border">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <span className={cn("size-2 rounded-full", SITE_META[d.site as SiteKey]?.dot)} />
                <span className="font-medium">{SITE_META[d.site as SiteKey]?.name ?? d.site}</span>
                <span className="text-xs text-muted-foreground">{d.domain}</span>
              </div>
              <div className="divide-y">
                {DNS_KINDS.map((kind) => {
                  const rec = d.kinds.get(kind);
                  const status = rec?.status ?? "missing";
                  const meta = DNS_STATUS_META[status];
                  return (
                    <div key={kind} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="w-14 shrink-0 text-xs font-medium">{DNS_KIND_LABEL[kind]}</span>
                      <Badge variant="outline" className={cn("shrink-0 border-0", meta.chip)}>{meta.label}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">{rec?.detail ?? "Not checked yet."}</p>
                        {rec?.record && <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">{rec.record}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
