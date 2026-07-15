// Per-site brand tokens for the Remotion intros/outros. Mirrors media-worker/src/
// config.ts (kept local so the Remotion bundle has no worker-runtime imports).
export type Site = "calculatry" | "resumehub" | "checkinvest";

export type Theme = {
  wordmark: [string, string]; // [main, accentedSuffix]
  domain: string;
  tagline: string;
  base: string; // darkest edge
  mid: string; // gradient midpoint
  bright: string; // vivid brand color
  accent: string; // pop / highlight
  glow: string; // soft light pool
  ink: string; // text color
  urlColor?: string; // site-URL color override (defaults to accent)
};

export const THEME: Record<Site, Theme> = {
  calculatry: {
    wordmark: ["Calcula", "try"],
    domain: "calculatry.com",
    tagline: "200+ Calculators. Built-in AI Assistant",
    base: "#0A0A20", mid: "#221A4C", bright: "#3C2E76", accent: "#F5C842", glow: "#5A3FA6", ink: "#FFFFFF",
  },
  resumehub: {
    wordmark: ["GlobalResume", "Hub"],
    domain: "globalresumehub.com",
    tagline: "Build the Right Resume for Any Country",
    base: "#041027", mid: "#0A2A6E", bright: "#1D4ED8", accent: "#FF6A1A", glow: "#3B82F6", ink: "#FFFFFF",
    urlColor: "#FFFFFF", // orange is hard to read on the blue globe — keep the URL white
  },
  checkinvest: {
    wordmark: ["CheckInvest", "Ng"],
    domain: "checkinvestng.com",
    tagline: "Nigeria's Smartest Investment Calculator",
    base: "#04140D", mid: "#0A4D33", bright: "#0E7A4E", accent: "#E6B33A", glow: "#14B886", ink: "#FFFFFF",
  },
};
