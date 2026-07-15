// Client-safe constants for Caption Studio. No "server-only" here on purpose:
// both the server engine and the React tab import these so the platform rules,
// character limits and the "above-the-fold" cut points stay in ONE place.
//
// Telegram is intentionally excluded — Caption Studio is for the networks where
// per-platform craft actually changes the wording (X / FB / IG / LinkedIn / YouTube).

export const CAPTION_PLATFORMS = ["x", "facebook", "instagram", "linkedin", "youtube"] as const;
export type CaptionPlatform = (typeof CAPTION_PLATFORMS)[number];

export type PlatformLimit = {
  name: string;
  // The hard character ceiling we flag against (the practical organic limit, not
  // the paid-tier maximum).
  hardLimit: number;
  // How many characters are visible before the platform truncates with a
  // "…more" / "…see more". Front-loading the hook before this point is the whole
  // game — the above-the-fold preview shows exactly this slice.
  fold: number;
  foldNote: string;
  // Sensible hashtag count range for the platform [min, max].
  hashtags: [number, number];
  // How links behave, surfaced as a hint on the card.
  link: string;
};

export const PLATFORM_LIMITS: Record<CaptionPlatform, PlatformLimit> = {
  x: {
    name: "X",
    hardLimit: 280,
    fold: 280,
    foldNote: "The whole post is the hook — nothing is hidden.",
    hashtags: [1, 2],
    link: "A link counts as ~23 characters.",
  },
  facebook: {
    name: "Facebook",
    hardLimit: 63206,
    fold: 80,
    foldNote: "~80 characters show before “See more”.",
    hashtags: [0, 2],
    link: "Links get a preview card; hashtags underperform here.",
  },
  instagram: {
    name: "Instagram",
    hardLimit: 2200,
    fold: 125,
    foldNote: "~125 characters show before “…more”.",
    hashtags: [8, 12],
    link: "No clickable links in the caption — point to the link in bio.",
  },
  linkedin: {
    name: "LinkedIn",
    hardLimit: 3000,
    fold: 140,
    foldNote: "~140 characters show before “…see more”.",
    hashtags: [3, 5],
    link: "Body links can suppress reach — drop the link in a comment.",
  },
  youtube: {
    name: "YouTube",
    hardLimit: 5000,
    fold: 150,
    foldNote: "~150 characters (about 3 lines) show before “…more”.",
    hashtags: [3, 8],
    link: "Links are clickable and encouraged — include the site link.",
  },
};

export const CAPTION_TONES = [
  { id: "auto", label: "Brand voice (auto)" },
  { id: "professional", label: "Professional" },
  { id: "playful", label: "Playful" },
  { id: "bold", label: "Bold" },
  { id: "storytelling", label: "Storytelling" },
] as const;
export type CaptionTone = (typeof CAPTION_TONES)[number]["id"];

// One generated caption for one platform, shared between the engine and the UI.
export type CaptionResult = {
  platform: CaptionPlatform;
  caption: string;
  hashtags: string[];
  hookScore: number | null; // 0–100 scroll-stop rating
  hookReason: string;
  error?: string;
};

// Live character count for a caption + its hashtag line, matching how the
// platform counts it (caption body + a blank line + the joined hashtags).
export function countChars(caption: string, hashtags: string[]): number {
  const tagLine = hashtags.length ? `\n\n${hashtags.join(" ")}` : "";
  return (caption + tagLine).length;
}
