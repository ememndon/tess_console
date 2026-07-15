// Client-safe Social Studio constants + row types (no server imports), so client
// components can use them without pulling `server-only` into the browser bundle.

export const PLATFORMS = ["x", "telegram", "facebook", "instagram", "linkedin"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_META: Record<Platform, { label: string; needsAccount: boolean }> = {
  x: { label: "X", needsAccount: true },
  telegram: { label: "Telegram", needsAccount: true },
  facebook: { label: "Facebook", needsAccount: false },
  instagram: { label: "Instagram", needsAccount: false },
  linkedin: { label: "LinkedIn", needsAccount: false },
};

export type BrandProfile = {
  site: string;
  voice: string | null;
  audience: string | null;
  hashtags: string[];
  ctaUrl: string | null;
  notFinancialAdvice: boolean;
  contentMix: { text: number; banner: number; video: number };
};

export type PlatformConfig = {
  site: string;
  platform: Platform;
  enabled: boolean;
  mode: "autonomous" | "handoff";
  perDay: number;
  times: string[];
  connected: boolean;
  handle: string | null;
  paused: boolean;
  pausedReason: string | null;
};

export type QueuePost = {
  id: string;
  ref: string | null; // 6-digit Post ID
  site: string;
  kind: "text" | "banner" | "video";
  caption: string | null;
  headline: string | null; // banner headline baked into the image (editable)
  subhead: string | null; // banner subhead baked into the image (editable)
  bannerStyle?: import("./design").BannerTextStyle | null; // manual font/size/colour overrides
  status: string;
  scheduledAt: string | null;
  createdBy: string;
  createdAt: string;
  targets: { platform: Platform; mode: string; status: string; externalUrl: string | null; error: string | null }[];
  media: { type: string; path: string; url: string }[];
  review: { ok: boolean; flags: string[] } | null; // pre-publish quality guard
  hashtags: string[]; // for the copy-and-use field (per-post override, else brand default)
  // Editable slide defs for an Instagram carousel (present only on carousel posts,
  // i.e. data.format === "carousel" with persisted slide defs). Drives the editor.
  carousel?: {
    aspect: "portrait" | "square";
    style: "bold" | "minimal" | "editorial";
    slides: { kind: "cover" | "point" | "cta"; title: string; body?: string }[];
  } | null;
};
