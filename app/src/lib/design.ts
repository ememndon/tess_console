// Tess's house style (design language + copy rules). ONE source of truth, imported
// by the prompt layer (so Tess always "remembers" how the owner wants things to look
// and read) and by the banner renderer (so generated art actually follows it). Pure
// data/strings — no server deps.

// The owner's standing art-direction rule, injected into Tess's system prompt and
// into every AI-image prompt. Keep it concrete: it has to change real output.
export const DESIGN_DIRECTIVE =
  "DESIGN STANDARD (the owner's standing rule — always apply to EVERY visual you create or " +
  "influence: banners, image posts, AI images, AND video intros/outros and their motion/animation): " +
  "make BOLD, confident, art-directed, premium choices. This is 2026 — basic is unacceptable. NEVER " +
  "ship generic, templated, default-looking 'AI slop' or safe/forgettable aesthetics; the goal is to " +
  "STAND OUT and look best-in-class. Every piece should read like a top studio made deliberate " +
  "decisions: one dominant idea, strong typographic hierarchy (big heavy headline + restrained " +
  "supporting text), intentional use of each brand's own palette, generous negative space, real " +
  "composition with a clear focal point (not everything-centered-on-a-gradient), and — for video — " +
  "purposeful, fluid motion with a distinct concept per site, not a recolored template. The site URL " +
  "is the point of every ad: keep it clearly legible. Avoid clichés: no stock 'robot/AI brain/glowing " +
  "circuit' imagery, no emoji soup, no clutter, no lorem-ipsum filler, no gratuitous arrow glyphs in " +
  "buttons. Clean, bold and striking beats busy, safe and generic — always. When you see a way to push " +
  "the design or tooling to a higher level, say so in your recommendations to the owner.";

// The owner's standing COPY rule, injected into Tess's system prompt and into every
// caption/script generator. Keep it concrete so it actually changes wording. Written
// without any dash-as-punctuation itself so the model isn't given mixed signals.
export const COPY_STANDARD =
  "PUNCTUATION RULE (the owner's standing rule for everything you write for the public: " +
  "social posts, captions, and video scripts). Do NOT use hyphens or dashes (the -, –, or — " +
  "characters) as sentence punctuation. That means never using a dash to join two clauses, to tack on " +
  "an afterthought, or to set off an aside. Instead use a comma, a period, a colon, a semicolon, or " +
  "parentheses, or simply split the thought into two sentences. Hyphens inside ordinary compound words " +
  "(real-time, best-in-class, ATS-ready) and inside brand names are fine; this rule is only about " +
  "dashes used as punctuation between words or clauses.";

// Deterministic backstop for COPY_STANDARD. The prompt rule above asks the model
// to avoid dash punctuation, but weaker models still slip — so we enforce it in
// code on the FINAL user-facing copy (captions, banner headline/subhead, caption
// studio, YouTube titles/description, video scripts, email/outreach drafts).
// It replaces em/en dashes and spaced or doubled hyphens used between words or
// clauses with a comma, while PRESERVING intra-word hyphens (real-time,
// best-in-class, country-specific), URLs (no spaces around the hyphen), markdown
// list markers ("- " at the start of a line), and numeric thousands separators.
// Pure string transform — safe to call from client or server. Apply it AFTER any
// parsing that treats a dash as a delimiter (e.g. the banner "HEADLINE:" parser).
export function enforceNoDashPunctuation(input: string | null | undefined): string {
  if (!input || typeof input !== "string") return input ?? "";
  const replaced = input
    // normalize the non-breaking hyphen (U+2011) to a plain hyphen first, so a
    // compound word that used it (best‑in‑class) stays a hyphenated word.
    .replace(/‑/g, "-")
    // em / en / figure / horizontal-bar dashes (optional surrounding HORIZONTAL
    // space, never newlines) → ", "
    .replace(/[^\S\n]*[‒–—―][^\S\n]*/g, ", ")
    // doubled / tripled ASCII hyphen (optional surrounding horizontal space) → ", "
    .replace(/[^\S\n]*-{2,3}[^\S\n]*/g, ", ")
    // single ASCII hyphen used as a dash: a non-space, horizontal space(s), hyphen,
    // horizontal space(s), then a non-space. Leaves "best-in-class" (no spaces) and a
    // line-leading "- bullet" (preceded by a newline, not by \S) untouched.
    .replace(/(\S)[^\S\n]+-[^\S\n]+(?=\S)/g, "$1, ")
    // tidy the artifacts the substitutions can create
    .replace(/([.!?])[^\S\n]*,[^\S\n]*/g, "$1 ") // ". , Next" → ". Next"
    .replace(/[^\S\n]{2,}/g, " ") // collapse runs of horizontal space
    .replace(/[^\S\n]+([.,;:!?])/g, "$1") // " ," → ","
    .replace(/(?:,[^\S\n]*){2,}/g, ", ") // ", , " → ", "
    .replace(/,[^\S\n]*\./g, "."); // ", ." → "."
  return replaced
    .replace(/^([ \t]*),[^\S\n]*/gm, "$1") // a line that now starts with ", " → drop it
    .replace(/,[^\S\n]*$/gm, ""); // a line that now ends in a stray comma → drop it
}

// Code/markdown-AWARE variant for Tess's free-form chat replies, which routinely
// contain fenced/inline code, CLI flags (--watch, -rf), markdown tables (|---|),
// thematic breaks (---) and bullet lists. We mask those regions, run the prose
// rule on everything else, then restore them verbatim — so the no-dash rule still
// applies to her prose without ever mangling code or markdown structure.
export function enforceNoDashPunctuationSafe(input: string | null | undefined): string {
  if (!input || typeof input !== "string") return input ?? "";
  const masks: string[] = [];
  const mask = (s: string): string => `\u0000${masks.push(s) - 1}\u0000`;
  let work = input
    // fenced code blocks (``` or ~~~), whole block including the info line
    .replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, (m) => mask(m))
    // inline code spans (N backticks … N backticks)
    .replace(/(`+)(?:[^`]|(?!\1)`)*?\1/g, (m) => mask(m))
    // indented code blocks (>=4 leading spaces or a tab)
    .replace(/^(?: {4,}|\t)[^\n]*$/gm, (m) => mask(m))
    // markdown table delimiter rows (|---|---|) and thematic breaks (--- *** ___)
    .replace(/^[ \t]*\|?[ \t:|]*-{2,}[ \t:|-]*\|?[ \t]*$/gm, (m) => mask(m))
    .replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, (m) => mask(m))
    // CLI flag tokens (-rf, --watch) — must be preceded by start/space and a letter/digit after the dash
    .replace(/(^|\s)(-{1,2}[A-Za-z0-9][\w-]*)/g, (_m, pre, flag) => `${pre}${mask(flag)}`)
    // URLs (defensive; they have no spaced dashes anyway)
    .replace(/\bhttps?:\/\/\S+/g, (m) => mask(m));
  const out = enforceNoDashPunctuation(work);
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => masks[Number(i)] ?? "");
}

// The owner's standing PERSUASION rule, injected wherever public copy is written
// (captions, banner headline + subline, video scripts, and Tess's own writing).
// The job of every post is to make the reader WANT to visit the site, not to label
// the topic. Written without dash punctuation so it doesn't fight COPY_STANDARD.
export const PERSUASION_STANDARD =
  "PERSUASION RULE (the owner's standing rule for ALL public copy: social posts, captions, banner " +
  "headlines and sublines, and video scripts). Copy must MOTIVATE the reader to act and visit the site, " +
  "never just passively label the topic. Concretely: " +
  "1) Lead with the reader's benefit or outcome, not a flat noun label. Write 'Stop Guessing Your Pension' " +
  "or 'Know What You Will Retire On', never 'Pension Stress'. Write 'Get Your Answer In Seconds', never " +
  "'Daily Numbers'. Write 'Crunch It In One Tap', never 'Quick Wins'. " +
  "2) Speak to the reader as 'you' and use active, confident verbs (calculate, plan, check, find out, " +
  "see, take control). " +
  "3) Make a specific promise or spark curiosity that only visiting resolves: a headline should imply a " +
  "payoff, and a subline should make a concrete benefit promise, never a passive feature statement like " +
  "'X helps you understand them'. " +
  "4) End every social post and every banner subline with a natural call to action that invites the visit " +
  "(for example 'Try it free', 'Run your numbers', 'See where you stand', 'Find out in seconds'). Do not " +
  "write the URL yourself when told it is appended automatically. " +
  "5) Stay honest and specific. No hype cliches, no fake urgency or countdowns, no exclamation spam, no " +
  "vague filler. Confident and benefit led beats loud. Never invent numbers to manufacture appeal.";

// Per-site GOOD vs BAD banner-copy examples so EACH brand gets action-driven,
// on-voice headlines (and one brand's finance phrasing doesn't bleed into another).
// Injected into generateBannerCopy; falls back to calculatry for unknown sites.
type BannerCopyExamples = { hGood: string; hBad: string; sGood: string; sBad: string };
const BANNER_COPY_EXAMPLES: Record<string, BannerCopyExamples> = {
  calculatry: {
    hGood: `"Know Your Real Rate", "Crunch It In Seconds", "Stop Second Guessing"`,
    hBad: `"Daily Numbers", "Quick Wins", "Pension Stress"`,
    sGood: `"Get a clear answer in seconds. Try it free."`,
    sBad: `"Calculatry helps you understand them." or "Calculate ratios easily."`,
  },
  resumehub: {
    hGood: `"Germany Wants A Photo", "One Page Or Two?", "Right Format, Any Country", "Your CV, Localized"`,
    hBad: `"Resume Tips", "CV Basics", "Beat The Resume Bots", "Get Hired", "ATS Ready Resume" (generic/off-brand — never use these)`,
    sGood: `"See exactly what your target country expects, then build it free — no sign-up."`,
    sBad: `"Build an ATS ready resume that gets you noticed." or "GlobalResumeHub helps with your resume."`,
  },
  checkinvest: {
    hGood: `"See Today's Best Rates", "Compare Before You Commit", "Never Miss A Rate Move"`,
    hBad: `"Investment News", "Rate Update", "Finance Tips"`,
    sGood: `"Compare the latest rates in one place. Check them now."`,
    sBad: `"CheckInvest gives you investment info." or "Rates explained simply."`,
  },
};
export function bannerCopyExamplesFor(site: string): BannerCopyExamples {
  return BANNER_COPY_EXAMPLES[site] ?? BANNER_COPY_EXAMPLES.calculatry;
}

// Extra art direction appended specifically to AI-image (Nano Banana) prompts.
export const IMAGE_ART_DIRECTION =
  "Art direction: bold, modern, editorial, high-contrast, with an intentional composition and one " +
  "clear focal point; cohesive brand-aligned color palette; crisp and clean. Avoid generic stock-photo " +
  "looks and clichéd 'AI' aesthetics (no robots, brains, glowing circuits or holograms), avoid clutter " +
  "and random gibberish text. Make it look deliberately designed, not auto-generated.";

// Appended to AI BACKGROUND prompts. Diffusion models cannot render real words, so
// we never ask them to: the headline is composited on top afterwards as real type
// by the banner renderer. This forbids text of any kind in the generated picture
// (this is the fix for the garbled-gibberish images the model used to bake in).
export const IMAGE_NO_TEXT =
  "ABSOLUTELY NO TEXT: do not render any letters, words, numbers, captions, labels, signs, " +
  "logos, watermarks, UI, or typography of any kind anywhere in the image. It is a pure visual " +
  "backdrop only; leave calm negative space on one side. All wording is added separately afterwards.";

// Per-brand design tokens for the banner renderer. Mirrors the video intro themes
// (media-worker/src/brand-intro.ts) so banners and demo videos read as one brand.
export type BrandDesign = {
  name: string;
  domain: string;
  // Wordmark split so the suffix can take the accent color, e.g. "Calcula" + "try".
  wordmark: [string, string];
  base: string; // darkest — page background edge
  mid: string; // gradient midpoint
  bright: string; // vivid brand color
  accent: string; // pop / highlight color
  ink: string; // headline text color
};

// Manual banner text-style overrides (post-detail image editor). Client-safe so
// the editor UI and the renderer share one type. Unset fields fall back to defaults.
export type BannerTextStyle = {
  headlineFont?: "Archivo Black" | "Poppins";
  headlineSizePx?: number; // overrides the auto-fit size
  headlineColor?: string; // hex
  subheadFont?: "Archivo Black" | "Poppins";
  subheadSizePx?: number;
  subheadColor?: string; // hex
};

export const BRAND_DESIGN: Record<string, BrandDesign> = {
  // Navy → indigo-purple with a gold accent (per the Calculatry brand).
  calculatry: { name: "Calculatry", domain: "calculatry.com", wordmark: ["Calcula", "try"], base: "#0A0A20", mid: "#221A4C", bright: "#3C2E76", accent: "#F5C842", ink: "#FFFFFF" },
  // Deep navy → royal blue with an orange accent.
  resumehub: { name: "GlobalResumeHub", domain: "globalresumehub.com", wordmark: ["GlobalResume", "Hub"], base: "#041027", mid: "#0A2A6E", bright: "#1D4ED8", accent: "#FF6A1A", ink: "#FFFFFF" },
  // Deep green with a gold accent (matches the logo).
  checkinvest: { name: "CheckInvest", domain: "checkinvestng.com", wordmark: ["CheckInvest", "Ng"], base: "#04140D", mid: "#0A4D33", bright: "#0E7A4E", accent: "#E6B33A", ink: "#FFFFFF" },
};

export function brandDesignFor(site: string): BrandDesign {
  return BRAND_DESIGN[site] ?? BRAND_DESIGN.calculatry;
}

// Per-brand banner layout so the three sites don't read as one brand:
//   rail   — left accent rail, headline flowing right (CheckInvest + default)
//   calc   — centered spotlight, gold underline + concentric rings (Calculatry)
//   resume — editorial letterhead, top rule + CV-document motif (ResumeHub)
// Lives here (pure data) so both the server renderer and the client preview use
// the same single source of truth.
export type BannerLayout = "rail" | "calc" | "resume";

export function layoutForSite(site: string): BannerLayout {
  if (site === "calculatry") return "calc";
  if (site === "resumehub") return "resume";
  return "rail"; // checkinvest + any fallback
}
