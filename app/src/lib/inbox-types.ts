// Client-safe types + labels for the Inbox / Outreach UI.
// NO server-only imports here — client components import from this module.

export const MAILBOX_PURPOSES = ["support", "outreach", "other"] as const;
export type MailboxPurpose = (typeof MAILBOX_PURPOSES)[number];

export const PURPOSE_LABEL: Record<string, string> = {
  support: "Support",
  outreach: "Outreach",
  other: "Other",
};

// Outreach pipeline stages.
export const OUTREACH_STAGES = [
  "prospect",
  "contacted",
  "replied",
  "negotiating",
  "won",
  "lost",
  "opted_out",
] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number];

export const STAGE_META: Record<OutreachStage, { label: string; chip: string; dot: string }> = {
  prospect: { label: "Prospect", chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" },
  contacted: { label: "Contacted", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", dot: "bg-sky-500" },
  replied: { label: "Replied", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", dot: "bg-violet-500" },
  negotiating: { label: "Negotiating", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  won: { label: "Won", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  lost: { label: "Lost", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400", dot: "bg-rose-500" },
  opted_out: { label: "Opted out", chip: "bg-zinc-500/15 text-zinc-500", dot: "bg-zinc-500" },
};

export const OUTREACH_CATEGORIES = [
  "embed_prospect",
  "career_blogger",
  "finance_journalist",
  "directory",
  "partner",
] as const;
export const CATEGORY_LABEL: Record<string, string> = {
  embed_prospect: "Embed prospect",
  career_blogger: "Career blogger",
  finance_journalist: "Finance journalist",
  directory: "Directory",
  partner: "Partner",
};

export const DNS_KINDS = ["spf", "dkim", "dmarc", "mx"] as const;
export const DNS_KIND_LABEL: Record<string, string> = {
  spf: "SPF",
  dkim: "DKIM",
  dmarc: "DMARC",
  mx: "MX",
};
export const DNS_STATUS_META: Record<string, { label: string; chip: string }> = {
  pass: { label: "Pass", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  warn: { label: "Warn", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  fail: { label: "Fail", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  missing: { label: "Missing", chip: "bg-zinc-500/15 text-zinc-500" },
};

// Serializable shapes passed from server components to client components.
export type MailboxLite = {
  id: string;
  site: string;
  address: string;
  displayName: string;
  purpose: string;
  enabled: boolean;
  status: string;
  unread: number;
  actionable: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastError: string | null;
};

export const FOLDER_META: Record<string, { label: string; icon: string }> = {
  inbox: { label: "Inbox", icon: "inbox" },
  drafts: { label: "Drafts", icon: "file" },
  sent: { label: "Sent", icon: "send" },
  archive: { label: "Archive", icon: "archive" },
  junk: { label: "Spam", icon: "shield-alert" },
  trash: { label: "Trash", icon: "trash" },
  other: { label: "Folder", icon: "folder" },
};
// Display order for the folder rail.
export const FOLDER_ORDER = ["inbox", "drafts", "sent", "archive", "junk", "trash", "other"];

export type FolderLite = {
  path: string;
  name: string;
  role: string;
  total: number;
  unread: number;
};

export type MessageLite = {
  id: string;
  direction: "inbound" | "outbound";
  fromAddr: string | null;
  fromName: string | null;
  toAddrs: string[];
  subject: string | null;
  snippet: string | null;
  internalDate: string | null;
  seen: boolean;
  answered: boolean;
  flagged: boolean;
  actionable: boolean;
  hasAttachments: boolean;
  threadKey: string;
};

export type AttachmentMeta = { filename?: string; contentType?: string; size?: number };

export type MessageFull = MessageLite & {
  mailboxId: string;
  bodyText: string | null;
  bodyHtml: string | null;
  ccAddrs: string[];
  attachments: AttachmentMeta[];
};

export type DraftLite = {
  id: string;
  status: string;
  subject: string;
  bodyText: string;
  toAddrs: string[];
  generatedBy: string;
  provider: string | null;
  createdAt: string;
};

// ── Outreach CRM / subscribers / DNS (client-safe shapes) ──

export type ProspectLite = {
  id: string;
  site: string;
  name: string | null;
  domain: string;
  url: string | null;
  email: string | null;
  category: string;
  fitReason: string | null;
  score: number | null;
  query: string | null;
  status: string;
  createdAt: string;
};

export type ContactLite = {
  id: string;
  site: string;
  name: string | null;
  email: string;
  org: string | null;
  role: string | null;
  category: string;
  stage: OutreachStage;
  source: string | null;
  notes: string | null;
  optedOut: boolean;
  lastContactedAt: string | null;
  createdAt: string;
  messageCount: number;
};

export type OutreachMessageLite = {
  id: string;
  subject: string;
  bodyText: string;
  status: string;
  generatedBy: string;
  approvedBy: string | null;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
};

export type SubscriberLite = {
  id: string;
  site: string;
  email: string;
  name: string | null;
  status: string;
  source: string | null;
  createdAt: string;
};

export type DnsRow = {
  site: string;
  domain: string;
  kind: string;
  status: string;
  record: string | null;
  detail: string;
  checkedAt: string | null;
};

// Settings → Mailboxes (NEVER carries the encrypted password to the client).
export type MailboxConfigLite = {
  id: string;
  site: string;
  address: string;
  displayName: string;
  purpose: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  signature: string | null;
  enabled: boolean;
  autoReply: boolean;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
};

export type EmailSettings = {
  supportDays: number;
  outreachDays: number;
  autoPurge: boolean;
  dailyCap: number;
  perContactCooldownDays: number;
  supportDraft: string; // auto | gemini | groq | deepseek
  allowDeepSeekSupport: boolean;
};
