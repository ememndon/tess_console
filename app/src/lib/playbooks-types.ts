// Client-safe types + metadata for the Playbook/SOP library.

export type Step = { text: string; needsApproval: boolean };

export type PlaybookLite = {
  id: string;
  title: string;
  category: string;
  trigger: string | null;
  steps: Step[];
  body: string | null;
  tags: string[];
  status: string;
  createdBy: string;
  updatedBy: string | null;
  updatedAt: string;
};

export const PB_CATEGORIES = ["traffic", "content", "seo", "social", "email", "infra", "incident", "general"] as const;
export type PbCategory = (typeof PB_CATEGORIES)[number];

export const PB_CATEGORY_META: Record<string, { label: string; chip: string; icon: string }> = {
  traffic: { label: "Traffic", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400", icon: "chart-line" },
  content: { label: "Content", chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400", icon: "pen-line" },
  seo: { label: "SEO", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", icon: "search" },
  social: { label: "Social", chip: "bg-pink-500/15 text-pink-600 dark:text-pink-400", icon: "megaphone" },
  email: { label: "Email", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", icon: "mail" },
  infra: { label: "Infra", chip: "bg-zinc-500/15 text-zinc-500", icon: "server" },
  incident: { label: "Incident", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400", icon: "siren" },
  general: { label: "General", chip: "bg-muted text-muted-foreground", icon: "book-open" },
};

export const PB_STATUSES = ["active", "draft", "archived"] as const;
