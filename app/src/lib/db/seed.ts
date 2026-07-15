import { sql } from "drizzle-orm";
import { db } from ".";
import {
  sites,
  jobs,
  notifications,
  monitors,
  settings,
  directoryListings,
  brandProfiles,
  socialConfig,
} from "./schema";

type Platform = "x" | "facebook" | "instagram" | "linkedin" | "telegram";

// Idempotent — safe to call on every boot. Inserts only what's missing.
export async function ensureSeed() {
  await db
    .insert(sites)
    .values([
      {
        key: "calculatry",
        name: "Calculatry",
        domain: "calculatry.com",
        accent: "blue",
        timezone: "UTC",
        sitemaps: ["https://calculatry.com/sitemap.xml"],
      },
      {
        key: "resumehub",
        name: "GlobalResumeHub",
        domain: "globalresumehub.com",
        accent: "purple",
        timezone: "UTC",
        sitemaps: ["https://globalresumehub.com/sitemap.xml"],
      },
      {
        key: "checkinvest",
        name: "CheckInvestNg",
        domain: "checkinvestng.com",
        accent: "teal",
        timezone: "Africa/Lagos",
        sitemaps: ["https://checkinvestng.com/sitemap.xml"],
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(jobs)
    .values([
      {
        name: "heartbeat",
        description:
          "Pings healthchecks.io every 5 min while the stack is healthy — external alert fires if pings stop.",
        schedule: "*/5 * * * *",
      },
      {
        name: "nightly-db-backup",
        description:
          "PostgreSQL dump to backups/ at 02:00, rotated (newest 14 kept). Restore: docs/playbooks/restore-from-backup.md",
        schedule: "0 2 * * *",
      },
      {
        name: "analytics-rollup",
        description:
          "Aggregates raw events into daily rollups and prunes raw events past the retention window (default 90 days). Runs 02:30.",
        schedule: "30 2 * * *",
      },
      {
        name: "uptime-check",
        description:
          "HTTP uptime probe for the three sites + console every 3 min; raises a notification on down/recovery and checks for JS-error spikes.",
        schedule: "*/3 * * * *",
      },
      {
        name: "rate-watchdog",
        description:
          "CheckInvest rate-pipeline freshness check every 20 min; alerts if published rates are stale beyond the threshold.",
        schedule: "*/20 * * * *",
      },
      {
        name: "vps-health",
        description:
          "Collects CPU/RAM/disk/service/backup/security status into the VPS health page every 5 min.",
        schedule: "*/5 * * * *",
      },
      {
        name: "content-inventory",
        description:
          "Crawls each site's sitemap into the content inventory. Runs 03:00.",
        schedule: "0 3 * * *",
      },
      {
        name: "competitor-poll",
        description:
          "Polls competitors' sitemaps/RSS and surfaces newly published pages. Runs 03:30.",
        schedule: "30 3 * * *",
      },
      {
        name: "gsc-sync",
        description:
          "Pulls Search Console data (daily backfill + 28-day query/page snapshots) for connected sites. Runs 04:00.",
        schedule: "0 4 * * *",
      },
      {
        name: "social-publish",
        description:
          "Publishes due posts to autonomous channels (X, Telegram) and writes Meta/LinkedIn handoff files; self-throttles on repeated failures. Every 2 min.",
        schedule: "*/2 * * * *",
      },
      {
        name: "inbox-sync",
        description:
          "Polls each connected Hostinger mailbox over IMAP for new mail, caches headers/body, flags actionable messages and notifies admins. Every 5 min.",
        schedule: "*/5 * * * *",
      },
      {
        name: "dns-check",
        description:
          "Verifies SPF/DKIM/DMARC/MX on the three domains and reports pass/warn/fail in the Outreach pre-flight panel. Runs 05:00.",
        schedule: "0 5 * * *",
      },
      {
        name: "email-retention",
        description:
          "Purges cached email past the configured retention window — support mail holds personal data. Runs 02:45.",
        schedule: "45 2 * * *",
      },
      {
        name: "notify-dispatch",
        description:
          "Fans out bell alerts raised by the deterministic monitors (health/social/inbox) to Telegram/email per routing + quiet hours. Every minute.",
        schedule: "* * * * *",
      },
      {
        name: "daily-report",
        description:
          "Tess's morning report — per-site traffic, posts published, emails handled, alerts, budget/usage — emailed to the owner + Telegram. Runs 06:00 UTC.",
        schedule: "0 6 * * *",
      },
      {
        name: "agent-tick",
        description:
          "Tess's autonomous heartbeat: every 30 min she scans for work (unanswered mail, alerts, failing jobs, server issues) and steps in within her authority. No-ops while paused or idle.",
        schedule: "*/30 * * * *",
      },
      {
        name: "vps-runner",
        description:
          "Executes the whitelisted server actions Tess queued — disk report, prune logs, run backup, approved service restarts. Deterministic host-side runner, every 2 min.",
        schedule: "*/2 * * * *",
      },
      {
        name: "offsite-backup",
        description:
          "Encrypted nightly push of the latest DB dump to Google Drive via rclone (resilience). gpg-AES256 before upload; runs 02:10, after the local dump.",
        schedule: "10 2 * * *",
      },
    ])
    .onConflictDoNothing();

  // Site Health monitors: three sites + the console's public pulse,
  // plus the CheckInvest rate-pipeline watchdog (starts unconfigured until the
  // owner sets the freshness signal in Settings).
  await db
    .insert(monitors)
    .values([
      { key: "calculatry", label: "Calculatry", url: "https://calculatry.com/", kind: "http" },
      { key: "resumehub", label: "GlobalResumeHub", url: "https://globalresumehub.com/", kind: "http" },
      { key: "checkinvest", label: "CheckInvest", url: "https://checkinvestng.com/", kind: "http" },
      { key: "console", label: "Tess Console", url: "https://staging.tessconsole.cloud/health", kind: "http" },
      {
        key: "checkinvest-rates",
        label: "CheckInvest rate pipeline",
        url: "https://checkinvestng.com/",
        kind: "rate",
        lastStatus: "unconfigured",
      },
    ])
    .onConflictDoNothing();

  // Default monitoring config (everything configurable, nothing hardcoded).
  await db
    .insert(settings)
    .values([
      {
        key: "rate_watchdog",
        value: {
          enabled: true,
          url: "https://checkinvestng.com/",
          mode: "auto", // auto | regex | json — how to read the "last updated" signal
          pattern: "", // regex (one capture group) or JSON path, when mode != auto
          maxAgeHours: 4,
          configured: false,
        },
      },
      { key: "error_alerts", value: { enabled: true, windowMinutes: 30, threshold: 25 } },
      {
        // Email retention (support mail contains personal data).
        key: "email_retention",
        value: { supportDays: 365, outreachDays: 730, autoPurge: true },
      },
      {
        // Outreach is compliant partnership outreach, NOT cold email.
        // Low daily caps + a per-contact cooldown; opt-out is permanent.
        key: "outreach_caps",
        value: { dailyCap: 10, perContactCooldownDays: 7 },
      },
      {
        // Per-site GSC connection. CheckInvest starts disabled — its
        // Search Console is under a different Google account; add the service
        // account there later to switch it on. Properties default to sc-domain.
        key: "gsc_sites",
        value: {
          calculatry: { enabled: true, property: "sc-domain:calculatry.com" },
          resumehub: { enabled: true, property: "sc-domain:globalresumehub.com" },
          checkinvest: {
            enabled: false,
            property: "sc-domain:checkinvestng.com",
            note: "Separate GSC account — connect later.",
          },
        },
      },
    ])
    .onConflictDoNothing();

  // Default competitor lists per site (starting suggestions) — only when the
  // owner hasn't set their own (never overwrite edits).
  const competitorDefaults: Record<string, string[]> = {
    calculatry: ["calculator.net", "omnicalculator.com"],
    resumehub: ["zety.com", "resume.io"],
    checkinvest: ["nairametrics.com"],
  };
  for (const [key, list] of Object.entries(competitorDefaults)) {
    await db.execute(
      sql`UPDATE sites SET competitors = ${JSON.stringify(list)}::jsonb
          WHERE key = ${key} AND (competitors IS NULL OR competitors = '[]'::jsonb)`,
    );
  }

  // Directory & listing pipeline catalog — applied per site, owner tracks status.
  const directoryCatalog = [
    { name: "Product Hunt", url: "https://www.producthunt.com/", category: "Launch" },
    { name: "AlternativeTo", url: "https://alternativeto.net/", category: "Alternatives" },
    { name: "SaaSHub", url: "https://www.saashub.com/", category: "Alternatives" },
    { name: "Crunchbase", url: "https://www.crunchbase.com/", category: "Business" },
    { name: "G2", url: "https://www.g2.com/", category: "Reviews" },
    { name: "Capterra", url: "https://www.capterra.com/", category: "Reviews" },
  ];
  await db
    .insert(directoryListings)
    .values(
      ["calculatry", "resumehub", "checkinvest"].flatMap((site) =>
        directoryCatalog.map((d) => ({ ...d, site })),
      ),
    )
    .onConflictDoNothing();

  // Social Studio brand profiles — starting voice/profile per brand.
  // Per-site knowledge briefs fed to Tess's system prompt (editable in Settings →
  // Sites). Seeded for fresh installs; existing rows are left untouched
  // (onConflictDoNothing) so admin edits are never clobbered.
  const BRIEFS: Record<string, string> = {
    calculatry: `**What it is:** A free library of online calculators and number explainers — everyday math, finance, health, conversions and more. Each calculator is its own page.

**Audience:** Everyday people who need a quick, trustworthy answer to one specific calculation — students, shoppers, DIYers, small-business owners. Most arrive from a search for that exact calculator.

**Brand voice:** Friendly, practical, numerate. Plain English, no jargon. Lead with the result, then a short, clear explanation of how it was worked out.

**Monetization:** Primarily display ads / affiliate _(confirm exact networks & top earners with admin)_.

**Key pages & SEO:** Individual calculator pages are the high-value, search-driven entry points. Wins come from ranking for long-tail "<thing> calculator" queries. _(Confirm current top pages / target keywords with admin.)_

**Main competitors:** calculator.net, omnicalculator.com _(confirm the ones to watch)_.

**Growth priorities:** Keep calculators fast, correct and mobile-friendly; add calculators for rising search queries; improve the explainer copy around each tool.

**Do / Don't:** DO keep every result accurate and instantly usable. DON'T give regulated medical/financial/legal advice — present the numbers plus a neutral explainer.`,
    resumehub: `**What it is:** Resume/CV tools plus country-specific guidance, with ~195 country pages tailoring resume norms to each market.

**Audience:** Job seekers worldwide preparing a CV/resume for a specific country — including migrants and international applicants who need to match local conventions (length, photo, sections, formatting).

**Brand voice:** Encouraging expert career coach with global awareness. Practical, country-specific and supportive — never generic.

**Monetization:** _(Confirm with admin — ads / affiliate / premium templates or downloads.)_

**Key pages & SEO:** Country pages ("resume/CV in <country>") and the tool pages drive growth. Target "<country> CV format / resume format" long-tail intent. _(Confirm top countries & keywords with admin.)_

**Main competitors:** _(Confirm — e.g. zety, novoresume, resume.io.)_

**Growth priorities:** Refresh and expand high-demand country pages; keep advice accurate to local norms; capture country-specific resume queries.

**Do / Don't:** DO tailor everything to the target country's conventions. DON'T give one-size-fits-all advice or guarantee job/interview outcomes.`,
    checkinvest: `**What it is:** Nigerian investment & FX rate information — published rates and plain explainers that help Nigerians track the market and understand their options.

**Audience:** Nigerian savers and investors checking current rates (FX and related products) and making everyday money decisions.

**Brand voice:** Trustworthy, plain-spoken Nigerian finance explainer. Calm and factual, never hype.

**COMPLIANCE (critical):** Always frame content as information, NOT financial advice. Keep the "not financial advice" framing visible. Never recommend specific buys/sells, predict the market, or promise returns.

**Data freshness:** Rate freshness is the product. The rate-pipeline watchdog flags rates that go stale (> 4h). Accuracy and timeliness matter most. _(Watchdog signal still to be configured — see admin.)_

**Monetization:** _(Confirm with admin — ads / affiliate / subscriber rate alerts.)_

**Key pages & SEO:** Rate pages and "<X> rate in Nigeria today" intent. _(Confirm top keywords with admin.)_

**Main competitors:** _(Confirm — e.g. abokiFX, Nairametrics.)_

**Growth priorities:** Keep rates fresh and clearly sourced; grow the rate-alert subscriber list; own "today's rate" search intent.

**Do / Don't:** DO cite freshness and stay neutral. DON'T give buy/sell advice, forecast markets, or ever drop the "not financial advice" framing.`,
  };

  await db
    .insert(brandProfiles)
    .values([
      {
        site: "calculatry",
        voice: "Friendly, practical and numerate — helps everyday people make sense of numbers. Clear and concrete, no jargon.",
        audience: "People who need quick, trustworthy calculators and number explainers.",
        brief: BRIEFS.calculatry,
        hashtags: ["#calculator", "#math", "#finance", "#tools"],
        ctaUrl: "https://calculatry.com",
        contentMix: { text: 50, banner: 35, video: 15 },
      },
      {
        site: "resumehub",
        voice: "Encouraging expert career coach with global awareness — practical, country-specific resume advice.",
        audience: "Job seekers worldwide preparing CVs/resumes for specific countries.",
        brief: BRIEFS.resumehub,
        hashtags: ["#resume", "#cv", "#jobsearch", "#careers"],
        ctaUrl: "https://globalresumehub.com",
        contentMix: { text: 50, banner: 35, video: 15 },
      },
      {
        site: "checkinvest",
        voice: "Trustworthy, plain-spoken Nigerian finance explainer. Calm and factual, never hype.",
        audience: "Nigerian savers and investors checking rates and making decisions.",
        brief: BRIEFS.checkinvest,
        hashtags: ["#Nigeria", "#investing", "#finance", "#CheckInvest"],
        ctaUrl: "https://checkinvestng.com",
        notFinancialAdvice: true,
        contentMix: { text: 45, banner: 35, video: 20 },
      },
    ])
    .onConflictDoNothing();

  // Per-platform posting config. X + Telegram autonomous (once an
  // account is connected); Meta + LinkedIn handoff — Tess generates and drops to
  // the manual posting queue (owner's chosen workflow, 2026-06-13).
  const platformModes: Record<Platform, { mode: string; enabled: boolean }> = {
    // X defaults to handoff: its pay-per-usage credits model makes autonomous
    // posting cost money (owner set X manual until further notice, 2026-06-13).
    x: { mode: "handoff", enabled: false },
    telegram: { mode: "autonomous", enabled: false },
    facebook: { mode: "handoff", enabled: true },
    instagram: { mode: "handoff", enabled: true },
    linkedin: { mode: "handoff", enabled: true },
  };
  await db
    .insert(socialConfig)
    .values(
      (["calculatry", "resumehub", "checkinvest"] as const).flatMap((site) =>
        (Object.entries(platformModes) as [Platform, { mode: string; enabled: boolean }][]).map(([platform, m]) => ({
          site,
          platform,
          mode: m.mode,
          enabled: m.enabled,
          perDay: 2,
          times: ["09:00", "17:00"],
        })),
      ),
    )
    .onConflictDoNothing();

  const existing = await db.select({ id: notifications.id }).from(notifications).limit(1);
  if (existing.length === 0) {
    await db.insert(notifications).values({
      severity: "info",
      title: "Welcome to Tess Console",
      body: "Phase 1 shell is live. Modules will fill with data as each build phase lands.",
      module: "system",
    });
  }
}
