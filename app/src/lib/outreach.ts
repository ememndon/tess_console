import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { outreachContacts, outreachMessages, subscribers, dnsChecks, settings, outreachProspects } from "./db/schema";
import type { ContactLite, OutreachMessageLite, SubscriberLite, DnsRow, OutreachStage, ProspectLite } from "./inbox-types";
import type { SiteScope } from "./site-scope";

type Row = Record<string, unknown>;
const execRows = async (q: SQL): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const siteEq = (scope: SiteScope, col = "site"): SQL => (scope === "all" ? sql`true` : sql`${sql.raw(col)} = ${scope}`);

// Admin-reviewed prospect queue (status='suggested'). Highest-relevance first.
export async function getProspects(site?: string): Promise<ProspectLite[]> {
  const rows = await db
    .select()
    .from(outreachProspects)
    .where(and(eq(outreachProspects.status, "suggested"), site && site !== "all" ? eq(outreachProspects.site, site) : undefined))
    .orderBy(desc(outreachProspects.score), desc(outreachProspects.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    site: r.site,
    name: r.name,
    domain: r.domain,
    url: r.url,
    email: r.email,
    category: r.category,
    fitReason: r.fitReason,
    score: r.score,
    query: r.query,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getContacts(site?: string, stage?: string): Promise<ContactLite[]> {
  const conds = [];
  if (site && site !== "all") conds.push(eq(outreachContacts.site, site));
  if (stage) conds.push(eq(outreachContacts.stage, stage as OutreachStage));
  const rows = await db
    .select({
      c: outreachContacts,
      messageCount: sql<number>`(SELECT count(*) FROM ${outreachMessages} om WHERE om.contact_id = ${outreachContacts.id})`.mapWith(Number),
    })
    .from(outreachContacts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(outreachContacts.createdAt))
    .limit(500);
  return rows.map(({ c, messageCount }) => ({
    id: c.id,
    site: c.site,
    name: c.name,
    email: c.email,
    org: c.org,
    role: c.role,
    category: c.category,
    stage: c.stage as OutreachStage,
    source: c.source,
    notes: c.notes,
    optedOut: c.optedOut,
    lastContactedAt: c.lastContactedAt ? c.lastContactedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    messageCount,
  }));
}

export async function getContact(
  id: string,
): Promise<{ contact: ContactLite; messages: OutreachMessageLite[] } | null> {
  const [c] = await db.select().from(outreachContacts).where(eq(outreachContacts.id, id)).limit(1);
  if (!c) return null;
  const msgs = await db
    .select()
    .from(outreachMessages)
    .where(eq(outreachMessages.contactId, id))
    .orderBy(desc(outreachMessages.createdAt));
  return {
    contact: {
      id: c.id,
      site: c.site,
      name: c.name,
      email: c.email,
      org: c.org,
      role: c.role,
      category: c.category,
      stage: c.stage as OutreachStage,
      source: c.source,
      notes: c.notes,
      optedOut: c.optedOut,
      lastContactedAt: c.lastContactedAt ? c.lastContactedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      messageCount: msgs.length,
    },
    messages: msgs.map((m) => ({
      id: m.id,
      subject: m.subject,
      bodyText: m.bodyText,
      status: m.status,
      generatedBy: m.generatedBy,
      approvedBy: m.approvedBy,
      sentAt: m.sentAt ? m.sentAt.toISOString() : null,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export type OutreachStats = { byStage: Record<string, number>; sentToday: number; dailyCap: number };

export async function getOutreachStats(): Promise<OutreachStats> {
  const stages = await db
    .select({ stage: outreachContacts.stage, n: sql<number>`count(*)`.mapWith(Number) })
    .from(outreachContacts)
    .groupBy(outreachContacts.stage);
  const byStage: Record<string, number> = {};
  for (const s of stages) byStage[s.stage] = s.n;

  const [sent] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(outreachMessages)
    .where(and(eq(outreachMessages.status, "sent"), sql`${outreachMessages.sentAt} >= now() - interval '1 day'`));

  const [capRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "outreach_caps"));
  const dailyCap = ((capRow?.value as { dailyCap?: number })?.dailyCap) ?? 10;
  return { byStage, sentToday: sent?.n ?? 0, dailyCap };
}

export async function getSubscribers(site?: string): Promise<SubscriberLite[]> {
  const rows = await db
    .select()
    .from(subscribers)
    .where(site && site !== "all" ? eq(subscribers.site, site) : undefined)
    .orderBy(desc(subscribers.createdAt))
    .limit(1000);
  return rows.map((s) => ({
    id: s.id,
    site: s.site,
    email: s.email,
    name: s.name,
    status: s.status,
    source: s.source,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function getSubscriberCounts(): Promise<Record<string, { active: number; total: number }>> {
  const rows = await db
    .select({
      site: subscribers.site,
      total: sql<number>`count(*)`.mapWith(Number),
      active: sql<number>`count(*) FILTER (WHERE ${subscribers.status} = 'active')`.mapWith(Number),
    })
    .from(subscribers)
    .groupBy(subscribers.site);
  const out: Record<string, { active: number; total: number }> = {};
  for (const r of rows) out[r.site] = { active: r.active, total: r.total };
  return out;
}

export async function getDnsReport(): Promise<DnsRow[]> {
  const rows = await db.select().from(dnsChecks);
  return rows.map((r) => ({
    site: r.site,
    domain: r.domain,
    kind: r.kind,
    status: r.status,
    record: r.record,
    detail: r.detail ?? "",
    checkedAt: r.checkedAt ? r.checkedAt.toISOString() : null,
  }));
}

// ── Diagnosis ────────────────────────────────────────────────────────────────
// The dashboard shows raw DNS rows + stage counts. This turns them into a verdict
// and a funnel: can each domain actually SEND (SPF/DKIM/DMARC), where the pipeline
// leaks (reply/win rates, stalled contacts), whether sends are failing, and
// subscriber churn — so Tess names the cause and the fix, not just the counts.

export type DomainDeliverability = {
  site: string;
  domain: string;
  verdict: "ready" | "at_risk" | "blocked";
  records: { kind: string; status: string; detail: string }[];
  issues: string[];
};

// Roll the per-record SPF/DKIM/DMARC/MX checks into one sending verdict per
// domain. SPF or DKIM failing/missing = mail gets rejected or spam-foldered
// (blocked); DMARC missing or any warn = deliverable but exposed (at risk).
export async function getDeliverabilityVerdict(scope: SiteScope): Promise<DomainDeliverability[]> {
  const all = await getDnsReport();
  const inScope = scope === "all" ? all : all.filter((r) => r.site === scope);
  const byDomain = new Map<string, DnsRow[]>();
  for (const r of inScope) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }
  const bad = (s?: string) => s === "fail" || s === "missing";
  const out: DomainDeliverability[] = [];
  for (const [domain, recs] of byDomain) {
    const get = (k: string) => recs.find((r) => r.kind === k);
    const spf = get("spf"), dkim = get("dkim"), dmarc = get("dmarc"), mx = get("mx");
    const issues: string[] = [];
    if (bad(spf?.status)) issues.push(`SPF ${spf?.status ?? "missing"} — ${spf?.detail || "add a TXT record authorizing your sending host, or mail is treated as spoofed"}`);
    if (bad(dkim?.status)) issues.push(`DKIM ${dkim?.status ?? "missing"} — ${dkim?.detail || "publish the DKIM public key so messages are signed"}`);
    if (bad(dmarc?.status)) issues.push(`DMARC ${dmarc?.status ?? "missing"} — ${dmarc?.detail || "add a DMARC policy TXT record (start with p=none)"}`);
    if (bad(mx?.status)) issues.push(`MX ${mx?.status ?? "missing"} — ${mx?.detail || "no mail exchanger, so replies can't be received"}`);
    for (const r of recs) if (r.status === "warn") issues.push(`${r.kind.toUpperCase()} warning — ${r.detail || "review this record"}`);
    let verdict: DomainDeliverability["verdict"] = "ready";
    if (bad(spf?.status) || bad(dkim?.status)) verdict = "blocked";
    else if (bad(dmarc?.status) || recs.some((r) => r.status === "warn")) verdict = "at_risk";
    out.push({ site: recs[0]?.site ?? "", domain, verdict, records: recs.map((r) => ({ kind: r.kind, status: r.status, detail: r.detail })), issues });
  }
  return out.sort((a, b) => ({ blocked: 0, at_risk: 1, ready: 2 }[a.verdict] - { blocked: 0, at_risk: 1, ready: 2 }[b.verdict]));
}

export type OutreachDiagnosis = {
  scope: SiteScope;
  days: number;
  deliverability: { domains: DomainDeliverability[]; summary: string };
  pipeline: { byStage: Record<string, number>; totalContacts: number; replyRate: number | null; winRate: number | null; bottleneck: string | null };
  sends: { windowDays: number; sent: number; failed: number; skipped: number; draft: number; approved: number; recentErrors: { contact: string; site: string; error: string; at: string }[] };
  stalled: { id: string; name: string | null; org: string | null; site: string; daysSinceContact: number }[];
  subscribers: { active: number; bounced: number; recentUnsubscribes: number };
  notes: string[];
};

export async function getOutreachDiagnosis(scope: SiteScope, days = 30): Promise<OutreachDiagnosis> {
  const where = siteEq(scope);
  const cWhere = scope === "all" ? sql`true` : sql`c.site = ${scope}`;

  const [domains, stageRows, sendRows, errRows, stalledRows, subRow] = await Promise.all([
    getDeliverabilityVerdict(scope),
    execRows(sql`SELECT stage, count(*)::int AS n FROM outreach_contacts WHERE ${where} GROUP BY stage`),
    execRows(sql`
      SELECT m.status, count(*)::int AS n
      FROM outreach_messages m JOIN outreach_contacts c ON c.id = m.contact_id
      WHERE ${cWhere} AND m.created_at >= now() - make_interval(days => ${days})
      GROUP BY m.status`),
    execRows(sql`
      SELECT coalesce(c.name, c.org, c.email) AS contact, c.site, m.error, m.created_at AS at
      FROM outreach_messages m JOIN outreach_contacts c ON c.id = m.contact_id
      WHERE ${cWhere} AND m.status = 'failed' AND m.error IS NOT NULL
      ORDER BY m.created_at DESC LIMIT 8`),
    execRows(sql`
      SELECT id, name, org, site, extract(day FROM now() - last_contacted_at)::int AS days_since
      FROM outreach_contacts
      WHERE ${where} AND stage = 'contacted' AND opted_out = false
        AND last_contacted_at IS NOT NULL AND last_contacted_at < now() - interval '7 days'
      ORDER BY last_contacted_at ASC LIMIT 15`),
    execRows(sql`
      SELECT
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'bounced')::int AS bounced,
        count(*) FILTER (WHERE status = 'unsubscribed' AND unsubscribed_at >= now() - make_interval(days => ${days}))::int AS recent_unsub
      FROM subscribers WHERE ${where}`),
  ]);

  const byStage: Record<string, number> = {};
  for (const r of stageRows) byStage[String(r.stage)] = num(r.n);
  const st = (k: string) => byStage[k] ?? 0;
  const totalContacts = Object.values(byStage).reduce((a, b) => a + b, 0);
  const contactedPlus = st("contacted") + st("replied") + st("negotiating") + st("won") + st("lost");
  const repliedPlus = st("replied") + st("negotiating") + st("won");
  const replyRate = contactedPlus > 0 ? Math.round((repliedPlus / contactedPlus) * 1000) / 10 : null;
  const decided = st("won") + st("lost");
  const winRate = decided > 0 ? Math.round((st("won") / decided) * 1000) / 10 : null;
  let bottleneck: string | null = null;
  if (st("prospect") > 0 && st("contacted") + repliedPlus === 0) bottleneck = "prospects not yet contacted";
  else if (st("contacted") > 0 && replyRate != null && replyRate < 15) bottleneck = "low reply rate — pitch or targeting";
  else if (st("negotiating") > st("won") + st("lost") && st("negotiating") > 0) bottleneck = "deals stuck in negotiation";

  const sends = { sent: 0, failed: 0, skipped: 0, draft: 0, approved: 0 } as Record<string, number>;
  for (const r of sendRows) sends[String(r.status)] = num(r.n);
  const recentErrors = errRows.map((r) => ({ contact: String(r.contact ?? "?"), site: String(r.site), error: String(r.error).slice(0, 160), at: new Date(r.at as string).toISOString() }));
  const stalled = stalledRows.map((r) => ({ id: String(r.id), name: r.name == null ? null : String(r.name), org: r.org == null ? null : String(r.org), site: String(r.site), daysSinceContact: num(r.days_since) }));
  const sub = subRow[0] ?? {};
  const subscribers = { active: num(sub.active), bounced: num(sub.bounced), recentUnsubscribes: num(sub.recent_unsub) };

  const blocked = domains.filter((d) => d.verdict === "blocked");
  const atRisk = domains.filter((d) => d.verdict === "at_risk");
  const summary = domains.length === 0
    ? "No domains checked yet."
    : blocked.length
    ? `${blocked.length} domain(s) BLOCKED from reliable sending: ${blocked.map((d) => d.domain).join(", ")}.`
    : atRisk.length
    ? `${atRisk.length} domain(s) deliverable but at risk: ${atRisk.map((d) => d.domain).join(", ")}.`
    : `All ${domains.length} domain(s) pass SPF/DKIM/DMARC — sending is healthy.`;

  const notes: string[] = [];
  for (const d of blocked) notes.push(`${d.domain} can't reliably send mail: ${d.issues[0] ?? "authentication failing"}. Outreach and support replies will bounce or spam-folder until this is fixed in DNS (Hostinger).`);
  for (const d of atRisk) notes.push(`${d.domain} is deliverable but exposed: ${d.issues[0] ?? "DMARC missing"}. Tighten it to protect the domain and inbox placement.`);
  if (totalContacts === 0) notes.push("No outreach contacts yet — the pipeline is empty. Add or approve prospects to start partnership outreach.");
  else {
    if (replyRate != null) notes.push(`Reply rate ${replyRate}% across ${contactedPlus} contacted${replyRate < 15 ? " — low; revise the pitch, subject line, or targeting" : ""}.`);
    if (stalled.length) notes.push(`${stalled.length} contact(s) were contacted >7d ago with no reply — queue follow-ups (oldest ${stalled[0].daysSinceContact}d).`);
  }
  if (sends.failed > 0) notes.push(`${sends.failed} send(s) failed in the last ${days}d${recentErrors[0] ? ` (e.g. "${recentErrors[0].error}")` : ""} — check the mailbox/SMTP and deliverability above.`);
  if (subscribers.bounced > 0) notes.push(`${subscribers.bounced} subscriber(s) are bounced — prune them to protect your sender reputation.`);
  if (subscribers.recentUnsubscribes > 0) notes.push(`${subscribers.recentUnsubscribes} unsubscribe(s) in the last ${days}d.`);

  return {
    scope, days,
    deliverability: { domains, summary },
    pipeline: { byStage, totalContacts, replyRate, winRate, bottleneck },
    sends: { windowDays: days, sent: sends.sent, failed: sends.failed, skipped: sends.skipped, draft: sends.draft, approved: sends.approved, recentErrors },
    stalled,
    subscribers,
    notes,
  };
}
