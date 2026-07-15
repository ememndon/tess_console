import "server-only";
import { getYouTubeProvider } from "./youtube";

// Pluggable viral-video research provider. YouTube (free) is the first impl;
// the interface is deliberately platform-neutral so a paid multi-platform
// provider (TikTok/Instagram) can be slotted in later without touching callers.

export type RawVideo = {
  platform: string;
  externalId: string;
  channelId: string | null;
  channelTitle: string | null;
  title: string;
  url: string;
  thumbnail: string | null;
  views: number;
  likes: number | null;
  comments: number | null;
  publishedAt: string | null; // ISO
  durationSec: number | null;
  isShort: boolean;
};

export type SearchOpts = { days?: number; shortsOnly?: boolean; max?: number };

export interface VideoResearchProvider {
  readonly platform: string;
  /** Find recent, high-performing videos for a niche/keyword query. */
  searchNiche(keywords: string, opts?: SearchOpts): Promise<RawVideo[]>;
  /** Typical views per channel (a baseline for outlier scoring), batched. */
  channelBaselines(channelIds: string[]): Promise<Map<string, number>>;
}

export class ResearchConfigError extends Error {}

// Single active provider for now. Returns null when the data source isn't
// configured (e.g. no YouTube key yet) so callers can surface a clean message.
export async function getResearchProvider(): Promise<VideoResearchProvider | null> {
  return getYouTubeProvider();
}
