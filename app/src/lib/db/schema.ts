import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  bigserial,
  date,
  index,
  uniqueIndex,
  primaryKey,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "manager", "tess", "user"]);
export const severity = pgEnum("severity", ["info", "warning", "critical"]);
export const secretStatus = pgEnum("secret_status", ["untested", "ok", "failed"]);
export const jobStatus = pgEnum("job_status", ["ok", "failed", "running"]);
export const eventType = pgEnum("event_type", ["pageview", "event", "error", "not_found"]);
export const feedbackStatus = pgEnum("feedback_status", ["new", "seen", "actioned"]);
export const monitorKind = pgEnum("monitor_kind", ["http", "rate"]);
export const monitorStatus = pgEnum("monitor_status", ["up", "down", "unknown", "unconfigured"]);
export const directoryStatus = pgEnum("directory_status", ["todo", "submitted", "listed", "rejected", "na"]);
export const socialPlatform = pgEnum("social_platform", ["x", "facebook", "instagram", "linkedin", "telegram"]);
export const postKind = pgEnum("post_kind", ["text", "banner", "video"]);
export const postStatus = pgEnum("post_status", ["draft", "scheduled", "ready", "publishing", "done", "failed"]);
export const targetStatus = pgEnum("target_status", ["queued", "published", "handoff", "posted", "failed", "skipped"]);
// ── Phase 6: Unified Inbox + Outreach CRM ──
export const mailDirection = pgEnum("mail_direction", ["inbound", "outbound"]);
export const draftStatus = pgEnum("draft_status", ["pending", "approved", "sent", "discarded", "failed"]);
export const outreachStage = pgEnum("outreach_stage", ["prospect", "contacted", "replied", "negotiating", "won", "lost", "opted_out"]);
export const outreachMsgStatus = pgEnum("outreach_msg_status", ["draft", "approved", "sent", "skipped", "failed"]);
export const subscriberStatus = pgEnum("subscriber_status", ["active", "unsubscribed", "bounced"]);
export const dnsKind = pgEnum("dns_kind", ["spf", "dkim", "dmarc", "mx"]);
export const dnsStatus = pgEnum("dns_status", ["pass", "warn", "fail", "missing"]);
export const playbookStatus = pgEnum("playbook_status", ["active", "draft", "archived"]);
// ── Phase 7: Tess the agent ──
export const tessRole = pgEnum("tess_role", ["user", "assistant", "tool", "system"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "expired", "done", "failed"]);

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text().notNull(),
  role: userRole().notNull().default("admin"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp({ withTimezone: true }),
});

// Team invitations. Owner invites 1–2 managers; the invitee
// follows a one-time link to set their own (long) password — no email server
// needed in Phase 1. Only the token hash is stored; the link is shown once.
export const invitations = pgTable("invitations", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  role: userRole().notNull().default("manager"),
  tokenHash: text().notNull(),
  invitedBy: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  acceptedAt: timestamp({ withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  tokenHash: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  ip: text(),
  userAgent: text(),
});

// Audit log: every action by every user (human or Tess) recorded.
export const auditLog = pgTable("audit_log", {
  id: bigserial({ mode: "number" }).primaryKey(),
  actorId: uuid(),
  actorName: text().notNull(),
  action: text().notNull(),
  target: text(),
  detail: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Encrypted vault. value is AES-256-GCM ciphertext (iv.cipher.tag, base64).
export const secrets = pgTable("secrets", {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  label: text().notNull(),
  category: text().notNull(),
  valueEnc: text().notNull(),
  status: secretStatus().notNull().default("untested"),
  lastTestedAt: timestamp({ withTimezone: true }),
  updatedBy: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid().primaryKey().defaultRandom(),
  severity: severity().notNull().default("info"),
  title: text().notNull(),
  body: text(),
  module: text().notNull().default("system"),
  readAt: timestamp({ withTimezone: true }),
  // External delivery (Telegram/email) timestamp. NULL = not yet fanned out; the
  // notify-dispatch cron picks these up so deterministic shell-script alerts get
  // delivered too. notify() delivers inline and stamps this immediately.
  deliveredAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Every scheduled task visible. Cron scripts report here via psql.
export const jobs = pgTable("jobs", {
  name: text().primaryKey(),
  description: text().notNull(),
  schedule: text().notNull(),
  enabled: boolean().notNull().default(true),
  lastRunAt: timestamp({ withTimezone: true }),
  lastStatus: jobStatus(),
  lastDurationMs: integer(),
  lastOutput: text(),
});

export const jobRuns = pgTable("job_runs", {
  id: bigserial({ mode: "number" }).primaryKey(),
  jobName: text()
    .notNull()
    .references(() => jobs.name, { onDelete: "cascade" }),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  status: jobStatus().notNull().default("running"),
  output: text(),
});

// Sites registry — accent colors, domains, sitemaps, competitors, timezones.
export const sites = pgTable("sites", {
  key: text().primaryKey(),
  name: text().notNull(),
  domain: text().notNull(),
  accent: text().notNull(),
  timezone: text().notNull().default("UTC"),
  sitemaps: jsonb().notNull().default([]),
  competitors: jsonb().notNull().default([]),
});

// General configuration KV (everything configurable, nothing hardcoded).
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────── Analytics engine ────────────────────────

// Raw first-party event stream. Cookieless: visitorId is a daily-rotating hash
// (date + ip + ua + per-site salt). The IP is NEVER stored — it only feeds the
// hash and the (proxy-header-derived) country. Pruned to the configured
// retention window (default 90 days) by the nightly aggregation job.
export const events = pgTable(
  "events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    site: text().notNull(),
    type: eventType().notNull().default("pageview"),
    name: text(), // custom event name (e.g. "calc_used"); null for pageview/error/404
    path: text(),
    referrerHost: text(),
    utmSource: text(),
    utmMedium: text(),
    utmCampaign: text(),
    country: text(), // 2-letter ISO, proxy-header-derived; null = unknown
    region: text(), // state/region name (from city GeoIP db, when present)
    city: text(), // city name (from city GeoIP db, when present)
    device: text(), // desktop | mobile | tablet
    browser: text(),
    os: text(),
    loadMs: integer(), // page load time (ms), pageviews only
    visitorId: text(), // daily-rotating hashed id
    props: jsonb(), // custom event props / error {message,source,line,col} / 404 referrer
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_site_created_idx").on(t.site, t.createdAt),
    index("events_site_type_created_idx").on(t.site, t.type, t.createdAt),
  ],
);

// Calculatry widget-embed registry — one row per (site, host) embedding a
// widget. Upserted on each embed ping; kept forever (tiny). Feeds the backlink
// program.
export const embedRegistry = pgTable(
  "embed_registry",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    host: text().notNull(),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    hits: integer().notNull().default(1),
  },
  (t) => [uniqueIndex("embed_site_host_idx").on(t.site, t.host)],
);

// User-feedback widget submissions with triage states for the Feedback module.
export const feedback = pgTable(
  "feedback",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    path: text(),
    rating: text(), // helpful | not_helpful | null
    message: text(),
    status: feedbackStatus().notNull().default("new"),
    country: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_site_created_idx").on(t.site, t.createdAt)],
);

// Nightly rollup: one row per (site, day). Aggregates kept forever (small & fast).
export const dailyStats = pgTable(
  "daily_stats",
  {
    site: text().notNull(),
    day: date().notNull(),
    pageviews: integer().notNull().default(0),
    visitors: integer().notNull().default(0),
    events: integer().notNull().default(0),
    errors: integer().notNull().default(0),
    notFound: integer().notNull().default(0),
    avgLoadMs: integer(),
  },
  (t) => [primaryKey({ columns: [t.site, t.day] })],
);

// Tall breakdown table: per (site, day, dimension, key) → counts. One table
// powers top-pages, sources, geo, devices, browsers and the events explorer.
export const dailyBreakdowns = pgTable(
  "daily_breakdowns",
  {
    site: text().notNull(),
    day: date().notNull(),
    dimension: text().notNull(), // path | referrer | country | device | browser | utm_source | event
    key: text().notNull(),
    count: integer().notNull().default(0),
    visitors: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.site, t.day, t.dimension, t.key] })],
);

// ──────────────────────── Site Health ────────────────────────

// One row per monitored target (3 sites + console + the CheckInvest rate
// watchdog). State is maintained by the host cron checks (deterministic, run
// even when Tess is paused); transitions raise notifications.
export const monitors = pgTable("monitors", {
  key: text().primaryKey(), // calculatry | resumehub | checkinvest | console | checkinvest-rates
  label: text().notNull(),
  url: text().notNull(),
  kind: monitorKind().notNull().default("http"),
  enabled: boolean().notNull().default(true),
  lastStatus: monitorStatus().notNull().default("unknown"),
  lastCheckedAt: timestamp({ withTimezone: true }),
  lastLatencyMs: integer(),
  lastCode: integer(),
  downSince: timestamp({ withTimezone: true }),
  lastError: text(),
  detail: jsonb(), // rate watchdog: { updatedAt, ageHours, maxAgeHours }
});

// Rolling check history — powers uptime % and the status timeline. Pruned to a
// short window by the uptime cron.
export const monitorChecks = pgTable(
  "monitor_checks",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    monitorKey: text().notNull(),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ok: boolean().notNull(),
    latencyMs: integer(),
    code: integer(),
  },
  (t) => [index("monitor_checks_key_time_idx").on(t.monitorKey, t.checkedAt)],
);

// ──────────────── SEO Center + Competitor tracker ────────────────

// Competitor publications discovered by the daily sitemap/RSS poller.
// `site` is which of our properties' competitor set this belongs to.
export const competitorPages = pgTable(
  "competitor_pages",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    site: text().notNull(),
    competitor: text().notNull(), // competitor host
    url: text().notNull(),
    title: text(),
    publishedAt: timestamp({ withTimezone: true }), // sitemap lastmod / RSS pubDate, if known
    discoveredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("competitor_pages_uniq").on(t.site, t.competitor, t.url),
    index("competitor_pages_site_disc_idx").on(t.site, t.discoveredAt),
  ],
);

// Directory & listing pipeline: a managed checklist with per-site status.
export const directoryListings = pgTable(
  "directory_listings",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    url: text().notNull(),
    category: text().notNull().default("General"),
    site: text().notNull(),
    status: directoryStatus().notNull().default("todo"),
    link: text(), // the live listing URL once submitted/listed
    notes: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: text(),
  },
  (t) => [uniqueIndex("directory_listings_uniq").on(t.site, t.name)],
);

// ── Google Search Console data, pulled by the GSC sync ──
// Daily totals per site — backfilled ~16 months, drives the performance trend.
export const gscDaily = pgTable(
  "gsc_daily",
  {
    site: text().notNull(),
    day: date().notNull(),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    ctr: doublePrecision(),
    position: doublePrecision(),
  },
  (t) => [primaryKey({ columns: [t.site, t.day] })],
);

// Rolling 28-day snapshot by query — top queries + the opportunity finder.
export const gscQueries = pgTable(
  "gsc_queries",
  {
    site: text().notNull(),
    query: text().notNull(),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    ctr: doublePrecision(),
    position: doublePrecision(),
  },
  (t) => [primaryKey({ columns: [t.site, t.query] })],
);

// Rolling 28-day snapshot by page — per-page performance + index-coverage signal.
export const gscPages = pgTable(
  "gsc_pages",
  {
    site: text().notNull(),
    page: text().notNull(),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    ctr: doublePrecision(),
    position: doublePrecision(),
  },
  (t) => [primaryKey({ columns: [t.site, t.page] })],
);

// Per-day breakdown by query (~90 days) — powers the range-selectable Top
// Queries (24h/7d/30d/90d). The flat gsc_queries snapshot above is derived from
// this same data for the opportunity finder.
export const gscQueryDaily = pgTable(
  "gsc_query_daily",
  {
    site: text().notNull(),
    day: date().notNull(),
    query: text().notNull(),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    ctr: doublePrecision(),
    position: doublePrecision(),
  },
  (t) => [primaryKey({ columns: [t.site, t.day, t.query] })],
);

// Per-day breakdown by page (~90 days) — powers range-selectable Top Pages.
export const gscPageDaily = pgTable(
  "gsc_page_daily",
  {
    site: text().notNull(),
    day: date().notNull(),
    page: text().notNull(),
    clicks: integer().notNull().default(0),
    impressions: integer().notNull().default(0),
    ctr: doublePrecision(),
    position: doublePrecision(),
  },
  (t) => [primaryKey({ columns: [t.site, t.day, t.page] })],
);

// Content inventory: every page from each site's sitemap, with indexing
// status (from GSC, once connected) and traffic joined live from analytics.
export const contentPages = pgTable(
  "content_pages",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    site: text().notNull(),
    url: text().notNull(),
    path: text().notNull(),
    lastmod: timestamp({ withTimezone: true }),
    title: text(),
    indexed: boolean(), // null until GSC connected
    gscClicks: integer(), // null until GSC connected
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("content_pages_uniq").on(t.site, t.url),
    index("content_pages_site_idx").on(t.site),
  ],
);

// ──────────────────────── Social Studio ────────────────────────

// Per-brand voice & content profile that drives generation.
export const brandProfiles = pgTable("brand_profiles", {
  site: text().primaryKey(),
  voice: text(), // brand voice / tone description (fed to the LLM)
  audience: text(),
  brief: text(), // freeform per-site knowledge brief — fed to Tess's system prompt, editable in Settings → Sites
  hashtags: jsonb().notNull().default([]),
  ctaUrl: text(),
  notFinancialAdvice: boolean().notNull().default(false), // CheckInvest auto-framing
  contentMix: jsonb().notNull().default({ text: 50, banner: 35, video: 15 }),
  niche: text(), // PRIMARY niche (= niches[0]); kept for the engine's default lookup
  niches: jsonb().notNull().default([]), // all research niches for this site (string[])
  competitorChannels: jsonb().notNull().default([]), // seed channel handles/ids to track
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────── Content Director (viral research) ────────────────────
// Tess's Sandcastles-class engine: tracked channels' baselines, fetched videos
// with outlier scores, and saved content plans. Drives subtopic/format strategy
// and the 30-day grid (the grid's posts live in social_posts, batch = plan ref).

// Per-channel baseline (median recent views) so a video can be scored as an
// "outlier" relative to its OWN channel, not raw view count.
export const researchChannels = pgTable(
  "research_channels",
  {
    id: uuid().primaryKey().defaultRandom(),
    platform: text().notNull().default("youtube"),
    channelId: text().notNull(),
    title: text(),
    subs: integer(),
    medianViews: integer(), // baseline used for outlier scoring
    niche: text(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("research_channels_uniq").on(t.platform, t.channelId)],
);

// Fetched videos with computed outlier score + velocity. Re-fetch upserts on
// (platform, externalId, niche). format is tagged later by the analysis pass.
export const researchVideos = pgTable(
  "research_videos",
  {
    id: uuid().primaryKey().defaultRandom(),
    platform: text().notNull().default("youtube"),
    externalId: text().notNull(),
    niche: text().notNull(),
    site: text(),
    channelId: text(),
    channelTitle: text(),
    title: text().notNull(),
    url: text(),
    thumbnail: text(),
    views: integer().notNull().default(0),
    likes: integer(),
    comments: integer(),
    engagementRate: doublePrecision(), // (likes + comments) / views
    publishedAt: timestamp({ withTimezone: true }),
    durationSec: integer(),
    isShort: boolean().notNull().default(false),
    outlierScore: doublePrecision(), // views / channel baseline (capped)
    velocity: doublePrecision(), // views per day since publish
    opportunityScore: doublePrecision(), // composite: outlier x velocity x engagement x recency
    format: text(), // tagged viral format (nullable until analyzed)
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("research_videos_uniq").on(t.platform, t.externalId, t.niche),
    index("research_videos_niche_score_idx").on(t.niche, t.outlierScore),
  ],
);

// A saved content strategy: the ranked subtopics + chosen formats for a site/niche.
// The 30-day grid it produces is materialized as social_posts (batch = this ref).
export const contentPlans = pgTable(
  "content_plans",
  {
    id: uuid().primaryKey().defaultRandom(),
    ref: text(), // human-friendly id for chat references
    site: text().notNull(),
    niche: text(),
    status: text().notNull().default("draft"), // draft | active | archived
    summary: jsonb(), // { subtopics: [...], formats: [...], gridDays, postRefs: [...] }
    createdBy: text().notNull().default("tess"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("content_plans_ref_idx").on(t.ref)],
);

// One planned post per day in a plan — a BRIEF (subtopic x format x platform x
// image|video), never text. Tess generates the real image/video draft from it on
// the day, or when the admin clicks Generate Post. postRef/jobId link to the
// produced social_posts draft / media render once generated.
export const contentPlanItems = pgTable(
  "content_plan_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    planRef: text().notNull(),
    site: text().notNull(),
    niche: text(),
    dayIndex: integer().notNull(),
    dayDate: date(),
    subtopic: text().notNull(),
    formatId: text(),
    formatName: text(),
    platform: text(),
    kind: text().notNull().default("image"), // image | video (never text)
    priority: integer().notNull().default(0), // 0..100, = subtopic strength — Tess generates the highest first across all niches
    angle: text(),
    sourceVideo: jsonb(),
    status: text().notNull().default("planned"), // planned | generating | generated | queued | failed
    postRef: text(),
    postId: uuid(),
    jobId: text(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_plan_items_plan_idx").on(t.planRef), index("content_plan_items_site_day_idx").on(t.site, t.dayDate)],
);

// Per (site, platform) posting config: whether enabled, autonomous vs handoff,
// and the schedule (frequency + times in the brand's audience timezone).
export const socialConfig = pgTable(
  "social_config",
  {
    site: text().notNull(),
    platform: socialPlatform().notNull(),
    enabled: boolean().notNull().default(false),
    mode: text().notNull().default("handoff"), // autonomous | handoff
    perDay: integer().notNull().default(1),
    times: jsonb().notNull().default([]), // ["09:00","17:00"] local to audience tz
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.site, t.platform] })],
);

// Per (site, platform) account connection. Credentials are AES-GCM encrypted
// (same vault as secrets) — per-brand X apps, Telegram channel id, etc.
export const socialAccounts = pgTable(
  "social_accounts",
  {
    site: text().notNull(),
    platform: socialPlatform().notNull(),
    connected: boolean().notNull().default(false),
    handle: text(),
    credentialsEnc: text(), // iv.cipher.tag base64 of a JSON creds blob
    meta: jsonb(),
    status: secretStatus().notNull().default("untested"),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.site, t.platform] })],
);

// A content item (one logical post, fanned out to one or more platforms).
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid().primaryKey().defaultRandom(),
    ref: text(), // human-friendly 6-digit Post ID for referencing a post in chat
    site: text().notNull(),
    kind: postKind().notNull().default("text"),
    caption: text(),
    data: jsonb(), // numeric bindings + generation source/meta (no invented numbers)
    status: postStatus().notNull().default("draft"),
    scheduledAt: timestamp({ withTimezone: true }),
    createdBy: text().notNull().default("human"), // 'tess' | user name
    batch: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("social_posts_site_sched_idx").on(t.site, t.scheduledAt), uniqueIndex("social_posts_ref_idx").on(t.ref)],
);

// Per-platform delivery of a post — its own status, mode and external id.
export const socialTargets = pgTable(
  "social_targets",
  {
    id: uuid().primaryKey().defaultRandom(),
    postId: uuid()
      .notNull()
      .references(() => socialPosts.id, { onDelete: "cascade" }),
    platform: socialPlatform().notNull(),
    mode: text().notNull().default("autonomous"), // autonomous | handoff
    status: targetStatus().notNull().default("queued"),
    externalId: text(),
    externalUrl: text(),
    error: text(),
    postedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("social_targets_post_idx").on(t.postId)],
);

// Rendered media (banner image / video) attached to a post, shared across targets.
export const socialMedia = pgTable("social_media", {
  id: uuid().primaryKey().defaultRandom(),
  postId: uuid()
    .notNull()
    .references(() => socialPosts.id, { onDelete: "cascade" }),
  type: text().notNull(), // image | video
  path: text().notNull(),
  width: integer(),
  height: integer(),
  idx: integer().notNull().default(0), // slide order within a post (carousels); 0 for single-media posts
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Self-throttle state per (site, platform): two consecutive fails → pause + alert.
export const platformThrottle = pgTable(
  "platform_throttle",
  {
    site: text().notNull(),
    platform: socialPlatform().notNull(),
    consecutiveFails: integer().notNull().default(0),
    paused: boolean().notNull().default(false),
    pausedReason: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.site, t.platform] })],
);

// ──────────────────── Unified Inbox + Outreach ────────────────────

// One connected Hostinger mailbox per site address. The password is AES-GCM
// encrypted (same vault as secrets); Hostinger stays the mail server — we just
// read over IMAP and send over SMTP. Self-throttle on repeated sync failures.
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    address: text().notNull().unique(), // support@calculatry.com
    displayName: text().notNull(), // "Calculatry Support"
    purpose: text().notNull().default("support"), // support | outreach | other
    imapHost: text().notNull(),
    imapPort: integer().notNull().default(993),
    imapSecure: boolean().notNull().default(true),
    smtpHost: text().notNull(),
    smtpPort: integer().notNull().default(465),
    smtpSecure: boolean().notNull().default(true),
    username: text().notNull(),
    passwordEnc: text().notNull(),
    signature: text(),
    enabled: boolean().notNull().default(true),
    autoReply: boolean().notNull().default(true), // Tess auto-drafts replies for this mailbox; admin can mute it
    status: secretStatus().notNull().default("untested"),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastSyncStatus: text(), // ok | failed
    lastError: text(),
    syncFails: integer().notNull().default(0), // consecutive — self-throttle
    lastUid: integer().notNull().default(0), // highest INBOX UID synced
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mailboxes_site_idx").on(t.site)],
);

// IMAP folder map per mailbox (full webmail). Discovered each sync;
// `role` normalizes the special-use folder (inbox/sent/drafts/junk/trash/archive)
// so the UI can show a standard folder list regardless of server naming. Each
// folder keeps its own UID watermark so syncs are incremental per folder.
export const mailboxFolders = pgTable(
  "mailbox_folders",
  {
    id: uuid().primaryKey().defaultRandom(),
    mailboxId: uuid()
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    path: text().notNull(), // IMAP path, e.g. "INBOX" or "INBOX.Sent"
    name: text().notNull(),
    role: text().notNull().default("other"), // inbox|sent|drafts|junk|trash|archive|other
    subscribed: boolean().notNull().default(true),
    lastUid: integer().notNull().default(0),
    syncEnabled: boolean().notNull().default(true),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mailbox_folders_box_path_idx").on(t.mailboxId, t.path)],
);

// Cached message headers + body (read over IMAP; the server stays canonical).
// Threading key = normalized References/In-Reply-To root, falling back to a
// normalized subject. Pruned by the retention job.
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    mailboxId: uuid()
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    uid: integer().notNull(), // IMAP UID within the folder
    folder: text().notNull().default("INBOX"),
    direction: mailDirection().notNull().default("inbound"),
    messageId: text(), // RFC Message-ID
    threadKey: text().notNull(),
    fromAddr: text(),
    fromName: text(),
    toAddrs: jsonb().notNull().default([]),
    ccAddrs: jsonb().notNull().default([]),
    subject: text(),
    snippet: text(),
    bodyText: text(),
    bodyHtml: text(),
    hasAttachments: boolean().notNull().default(false),
    attachments: jsonb().notNull().default([]), // [{filename,contentType,size}]
    internalDate: timestamp({ withTimezone: true }),
    seen: boolean().notNull().default(false),
    answered: boolean().notNull().default(false),
    flagged: boolean().notNull().default(false),
    actionable: boolean().notNull().default(false), // Tess triage: needs a reply
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_msg_box_folder_uid_idx").on(t.mailboxId, t.folder, t.uid),
    index("email_msg_box_thread_idx").on(t.mailboxId, t.threadKey),
    index("email_msg_box_date_idx").on(t.mailboxId, t.internalDate),
  ],
);

// Draft-and-approve: EVERY outgoing support email is a draft that
// an admin must approve before it sends. No auto-send, no exceptions.
export const emailDrafts = pgTable(
  "email_drafts",
  {
    id: uuid().primaryKey().defaultRandom(),
    mailboxId: uuid()
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    inReplyTo: uuid().references(() => emailMessages.id, { onDelete: "set null" }),
    threadKey: text(),
    // reply = an answer to an inbound message (default); compose = a standalone
    // "New message" draft the admin saved to finish later (surfaced in Drafts).
    kind: text().notNull().default("reply"),
    toAddrs: jsonb().notNull().default([]),
    ccAddrs: jsonb().notNull().default([]),
    subject: text().notNull(),
    bodyText: text().notNull(),
    bodyHtml: text(), // rich-text body when composed with formatting
    // Saved attachments for compose drafts: [{ filename, contentType, size, data(base64) }].
    attachments: jsonb().notNull().default([]),
    status: draftStatus().notNull().default("pending"),
    generatedBy: text().notNull().default("tess"), // tess | human
    provider: text(), // which LLM drafted it (data-handling note)
    approvedBy: text(),
    sentAt: timestamp({ withTimezone: true }),
    smtpMessageId: text(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_drafts_box_status_idx").on(t.mailboxId, t.status)],
);

// Outreach CRM: deliberately-added contacts only — no scraping.
// Opt-out is honored permanently; low daily volume caps in settings.outreach_caps.
export const outreachContacts = pgTable(
  "outreach_contacts",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    name: text(),
    email: text().notNull(),
    org: text(),
    role: text(),
    category: text().notNull().default("partner"), // embed_prospect | career_blogger | finance_journalist | directory | partner
    stage: outreachStage().notNull().default("prospect"),
    source: text(), // how/why this contact was added (provenance — compliance)
    notes: text(),
    optedOut: boolean().notNull().default(false),
    lastContactedAt: timestamp({ withTimezone: true }),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("outreach_site_email_idx").on(t.site, t.email)],
);

// Per-contact outreach history. Every send is approval-gated.
export const outreachMessages = pgTable(
  "outreach_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    contactId: uuid()
      .notNull()
      .references(() => outreachContacts.id, { onDelete: "cascade" }),
    mailboxId: uuid().references(() => mailboxes.id, { onDelete: "set null" }),
    subject: text().notNull(),
    bodyText: text().notNull(),
    status: outreachMsgStatus().notNull().default("draft"),
    generatedBy: text().notNull().default("tess"),
    approvedBy: text(),
    sentAt: timestamp({ withTimezone: true }),
    smtpMessageId: text(),
    error: text(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outreach_msgs_contact_idx").on(t.contactId)],
);

// Outreach prospect queue — ADMIN-INITIATED web-search suggestions (Tavily).
// Tess never auto-searches; an admin clicks "Find prospects". Candidates land
// here for review; approving one creates a real outreach_contacts row (provenance
// source='tess-prospecting'). Nothing here can be emailed directly.
export const outreachProspects = pgTable(
  "outreach_prospects",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    name: text(), // org / site name
    domain: text().notNull(),
    url: text(), // page where it was found
    email: text(), // extracted public contact email (nullable)
    contactUrl: text(), // contact / about page
    category: text().notNull().default("partner"),
    fitReason: text(), // why it's a fit
    score: integer(), // 0-100 relevance (optional)
    query: text(), // the search query that surfaced it (provenance)
    status: text().notNull().default("suggested"), // suggested | added | dismissed
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prospects_site_domain_idx").on(t.site, t.domain)],
);

// Subscriber / rate-alert list management (CheckInvest mainly).
export const subscribers = pgTable(
  "subscribers",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    email: text().notNull(),
    name: text(),
    status: subscriberStatus().notNull().default("active"),
    source: text(),
    tags: jsonb().notNull().default([]),
    confirmedAt: timestamp({ withTimezone: true }),
    unsubscribedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("subscribers_site_email_idx").on(t.site, t.email)],
);

// SPF/DKIM/DMARC/MX pre-flight verification report. Latest snapshot
// per (domain, kind); the DNS-check job refreshes these. Owner edits DNS in
// Hostinger; the console only verifies and reports.
export const dnsChecks = pgTable(
  "dns_checks",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    domain: text().notNull(),
    kind: dnsKind().notNull(),
    status: dnsStatus().notNull().default("missing"),
    record: text(), // the TXT/record value found
    detail: text(), // plain-English explanation
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dns_checks_domain_kind_idx").on(t.domain, t.kind)],
);

// Playbook / SOP library ("Tess's brain"). Humans author runbooks;
// Tess executes them. Each playbook has a trigger, ordered steps (each flagged
// whether it needs admin approval), and free-form notes.
export const playbooks = pgTable(
  "playbooks",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    category: text().notNull().default("general"), // traffic|content|seo|social|email|infra|incident|general
    trigger: text(), // when this playbook applies, plain English
    steps: jsonb().notNull().default([]), // [{ text: string, needsApproval: boolean }]
    body: text(), // extra notes / context (markdown-ish)
    tags: jsonb().notNull().default([]),
    status: playbookStatus().notNull().default("active"),
    createdBy: text().notNull(),
    updatedBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playbooks_category_idx").on(t.category)],
);

// ──────────────────────── Tess the agent ────────────────────────

// One brain, two mouths: a single conversation shared by the console chat
// panel and the Telegram bot. Each row is one turn (human, Tess, tool, or system).
// A chat thread. Console chats are PRIVATE per admin (userId set); telegram and
// autonomous runs use a shared per-channel conversation (userId null).
export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text(), // owning admin for console chats; null for telegram/autonomous
    channel: text().notNull().default("console"), // console | telegram | autonomous
    title: text().notNull().default("New chat"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)],
);

// Files an admin attaches to a chat for Tess to view/preview. Stored as base64
// in-DB (no shared volume); text-like files also keep an extracted excerpt so
// non-vision models can still read them. Served (owner-only) via /api/tess-files.
export const tessFiles = pgTable(
  "tess_files",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text(), // uploader (owner) — files are private to their chats
    name: text().notNull(),
    mime: text().notNull().default("application/octet-stream"),
    size: integer().notNull().default(0),
    data: text().notNull(), // base64, no data: prefix
    textExcerpt: text(), // first ~8k chars for text-like files
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tess_files_user_idx").on(t.userId)],
);

export const tessMessages = pgTable(
  "tess_messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid(), // which thread this belongs to
    userId: text(), // human who sent it (console privacy + attribution); null for Tess/system
    role: tessRole().notNull(),
    channel: text().notNull().default("console"), // console | telegram | system
    author: text(), // human name, or "Tess"
    content: text(),
    attachments: jsonb().notNull().default([]), // [{ id, name, mime, size }] for display
    toolName: text(),
    toolInput: jsonb(),
    toolResult: text(),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    costUsd: doublePrecision().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tess_messages_created_idx").on(t.createdAt),
    index("tess_messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

// Approval queue (autonomy matrix): any action Tess proposes that needs a
// human OK lands here. One-tap approve/reject from the console or Telegram.
export const approvals = pgTable(
  "approvals",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(), // email.send | social.publish | vps.op | outreach.send | …
    module: text().notNull().default("agent"),
    title: text().notNull(),
    summary: text(),
    payload: jsonb(), // what to execute on approval
    status: approvalStatus().notNull().default("pending"),
    requestedVia: text().notNull().default("system"), // console | telegram | system
    decidedBy: text(),
    decidedAt: timestamp({ withTimezone: true }),
    result: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_status_idx").on(t.status)],
);

// Cost metering: tokens + $ per task type, for monthly budget tracking.
export const costLedger = pgTable(
  "cost_ledger",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    day: date().notNull(),
    taskType: text().notNull().default("chat"),
    provider: text().notNull().default("anthropic"),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    costUsd: doublePrecision().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cost_ledger_day_idx").on(t.day)],
);

// Tess's durable memory: facts/decisions she records to remember beyond
// the rolling chat window. Injected back into her system prompt by relevance.
export const tessNotes = pgTable(
  "tess_notes",
  {
    id: uuid().primaryKey().defaultRandom(),
    scope: text().notNull().default("global"), // global | site key | topic
    note: text().notNull(),
    tags: jsonb().notNull().default([]),
    createdBy: text().notNull().default("tess"),
    pinned: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tess_notes_created_idx").on(t.createdAt)],
);

// VPS action queue. Tess (in the container) enqueues a whitelisted
// server action here; a host-side runner cron executes it as emison and writes
// the result back. The container itself has no host/docker access, so this is the
// only path — and the host runner only knows how to do a fixed safe set.
export const vpsActions = pgTable(
  "vps_actions",
  {
    id: uuid().primaryKey().defaultRandom(),
    action: text().notNull(), // disk_report | prune_logs | run_backup | restart_service
    args: jsonb().notNull().default({}),
    status: text().notNull().default("pending"), // pending | running | done | failed | skipped
    requestedBy: text().notNull().default("tess"),
    reason: text(),
    result: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("vps_actions_status_idx").on(t.status)],
);

// Demo Studio render queue (demo videos). Tess (or the owner) enqueues a
// demo job; the dedicated tess-media worker claims it, drives the live site with a
// browser, records + narrates it, and pushes the rendered media back via the
// internal API. The worker never touches the DB directly — it goes through
// /api/internal/media/* so notify()/audit()/social helpers stay the single writer.
export const mediaJobs = pgTable(
  "media_jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    site: text().notNull(),
    recipeId: text().notNull(),
    feature: text().notNull(),
    url: text().notNull(),
    // Full scene list the worker plays: { steps:[{action,target,value,say,...}],
    // intro, outro, caption, hashtags } — narration written by Tess's brain.
    scenario: jsonb().notNull().default({}),
    formats: jsonb().notNull().default(["9:16", "1:1", "16:9"]),
    voice: text().notNull().default("kokoro"), // kokoro (default) | piper
    music: text().notNull().default("auto"), // none | auto | <filename in media/assets/music>
    status: text().notNull().default("pending"), // pending | running | done | failed
    postId: uuid(), // social_posts row created on success
    result: text(), // log line / error
    requestedBy: text().notNull().default("tess"),
    createdBy: text().notNull().default("tess"), // 'tess' | owner name (manual trigger)
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("media_jobs_status_idx").on(t.status), index("media_jobs_created_idx").on(t.createdAt)],
);
