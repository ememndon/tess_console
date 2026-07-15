// Tess's social-media STRATEGY brain. One source of truth for how each brand wins
// on social: who the market is, which platforms matter, the content pillars, the
// hooks that stop the scroll, hashtag themes, and the engagement mechanics. Pure
// data + string helpers (no server deps) so it can be injected into the caption
// generator AND Tess's system prompt. Pairs with design.ts (look) and the editable
// brand briefs in Settings → Sites (voice/audience); this adds the STRATEGY.

// The standing mandate that turns Tess from a caption writer into a social-media
// manager. Injected into her system prompt.
export const SOCIAL_MANAGER_MANDATE =
  "YOU ARE A WORLD-CLASS SOCIAL MEDIA MANAGER for these brands, not a caption typist. Every post must " +
  "earn its place: stop the scroll, give real value, and pull a click to the site. Think like a strategist: " +
  "1) PICK topics from evidence, not vibes. Before creating content, look at what is already working " +
  "(get_analytics top pages + diagnose_traffic, get_seo + diagnose_seo for the queries people actually " +
  "search, recent feedback, and the season/calendar). Turn a high-intent page or a rising query into a post. " +
  "2) MATCH the platform. Each network rewards different craft (see the platform playbook). Write for ONE " +
  "platform at a time; never post the same generic blurb everywhere. " +
  "3) ROTATE the content pillars so the feed has range (teach, relate, prove, spotlight, time-peg) instead " +
  "of the same 'here is our tool' note. " +
  "4) LEAD WITH A HOOK. The first line decides everything: a sharp question, a bold or counter-intuitive " +
  "claim, a relatable pain, or a surprising (verified) fact. No throat-clearing. " +
  "5) DRIVE ENGAGEMENT: invite a comment, a save, a share, or a click. Give the reader a reason to act now. " +
  "6) Tailor to each brand's audience and market (use the per-site strategy below). Honest always: never " +
  "invent numbers, never give financial advice where a brand forbids it. " +
  "CONTENT DIRECTOR LOOP — when planning what to make, do not guess. Run: research_niche (pull what's " +
  "already winning in the brand's niche and score the outliers) → get_content_strategy (ranked subtopics, " +
  "the formats actually winning with their templates, and mined hook formulas) → build_content_calendar " +
  "(a rotating topic x format grid of scheduled DRAFTS). Anchor every post to a proven outlier from the " +
  "swipe file (find_viral_outliers) and add a fresh, contrarian angle so it stands out rather than copies. " +
  "When you see a way to raise the bar (a new pillar, a format, a campaign, a posting cadence), recommend() it.";

// Per-platform craft. Richer than a one-line tone hint: structure, length, hashtag
// count, and the CTA style each network actually rewards.
export const PLATFORM_PLAYBOOK: Record<string, string> = {
  x: "Platform X (Twitter): one sharp idea, hook in the FIRST words, under ~240 characters. Punchy and conversational. 1–2 hashtags max. End with a crisp CTA or an open question that invites replies.",
  linkedin: "Platform LinkedIn: professional and value-led, credible, zero hype. Hook line, then one genuine insight a working professional can use, then a soft CTA. 3–5 focused hashtags. Speak peer-to-peer.",
  instagram: "Platform Instagram: a scroll-stopping first line that works as the caption opener; aspirational and visual. Lead with the hook, deliver value in 2–4 short lines, CTA to save or to visit (link in bio). 8–12 hashtags mixing broad and niche. Light, purposeful emoji only.",
  facebook: "Platform Facebook: warm, human, community tone, 2–3 sentences. Invite a reaction or a comment. 0–2 hashtags. Relatable beats clever.",
  tiktok: "Platform TikTok: casual, fast, trend-aware. A bold spoken-style hook, one payoff, a quick CTA. 3–5 hashtags including one or two trend/discovery tags.",
  pinterest: "Platform Pinterest: keyword-rich, helpful, evergreen and search-friendly (people search Pinterest like Google). Describe the benefit plainly so it ranks. 2–5 descriptive hashtags.",
  youtube: "Platform YouTube: write a video DESCRIPTION, not a tweet. Front-load a compelling hook plus the core value in the first ~150 characters — that's what shows above the fold and what YouTube search indexes. Then go fuller: 2–4 short paragraphs on what the video covers and why it matters, a clear call to action, and the site link (links are clickable and not penalized here). Keyword-rich and search-friendly (YouTube is the world's second-largest search engine). Close with 3–8 relevant hashtags. Length is an asset here — be thorough, never padded.",
};

export function platformPlaybook(platform?: string): string {
  return (platform && PLATFORM_PLAYBOOK[platform]) || "";
}

// How many hashtags suit each platform (used to size hashtag generation).
export function hashtagCountFor(platform?: string): number {
  switch (platform) {
    case "x": return 2;
    case "facebook": return 2;
    case "linkedin": return 4;
    case "instagram": return 11;
    case "tiktok": return 5;
    case "pinterest": return 5;
    case "youtube": return 5;
    default: return 6;
  }
}

export type SocialStrategy = {
  market: string;
  audience: string;
  platforms: string;
  pillars: string[];
  hooks: string;
  hashtagThemes: string;
  engagement: string;
  guardrails?: string;
};

export const SOCIAL_STRATEGY: Record<string, SocialStrategy> = {
  calculatry: {
    market: "Global, English-speaking people who need a fast, trustworthy number with no signup and no clutter (money, health, math, everyday conversions).",
    audience: "Students and learners; DIY personal-finance people (mortgage, loan, savings, interest); health and pregnancy planners (BMI, due date); busy professionals double-checking quick math. Pains: fear of getting the number wrong, wanting a quick free answer, wanting to UNDERSTAND not just compute.",
    platforms: "Pinterest and Instagram first (evergreen, visual 'how to calculate X' content that keeps getting found), then X for quick tips, Facebook for relatable money/health moments, Reels/TikTok for satisfying quick-calc clips. LinkedIn is minor.",
    pillars: [
      "Quick How-To: the fastest way to work out a common number ('know your monthly payment in 10 seconds')",
      "Myth-buster / common mistake: where people get the math wrong (compound interest, loan APR, BMI meaning)",
      "Relatable money or health moment: the everyday situation behind the calculator",
      "Tool spotlight: one calculator and the real-life payoff of using it",
      "Time-peg: tax season, New Year savings, road-trip fuel cost, due-date season",
    ],
    hooks: "Question hooks ('Know exactly what that loan really costs?'), 'stop guessing', 'the fastest way to…', or a surprising but VERIFIED fact.",
    hashtagThemes: "Broad: #personalfinance #moneytips #budgeting #healthtips. Niche per topic: #mortgagecalculator #compoundinterest #loanrepayment #bmicalculator. Branded: #Calculatry.",
    engagement: "Ask the reader to drop their number or guess, 'save this for the next time you need it', or try the tool and report back.",
  },
  resumehub: {
    market: "Global job seekers, especially people applying ACROSS countries (≈195 country CV guides) and anyone fighting applicant-tracking-system (ATS) rejection.",
    audience: "Active job seekers, new graduates, career changers, and immigrants/expats applying abroad. Pains: 'my resume gets ignored', ATS auto-rejection, not knowing a country's CV norms, imposter syndrome, wanting interviews not just applications.",
    platforms: "LinkedIn first (career audience), Instagram and TikTok for grads and quick career hacks (carousels, Reels), X for fast tips, Facebook for job-seeker and expat groups.",
    pillars: [
      "ATS / insider tip: what recruiters and the bots actually do ('words that get you auto-rejected')",
      "Country-specific norm: how a CV differs by country (photo or not, length, format)",
      "Before/after or mistake-fix: a concrete resume improvement",
      "Confidence / mindset: job-search motivation and momentum",
      "Tool spotlight: the builder or ATS-check feature and the outcome it unlocks",
    ],
    hooks: "'Recruiters spend seconds on your resume…', 'Why your resume gets ignored', 'Applying to [country]? Read this first', a fixable mistake.",
    hashtagThemes: "Broad: #jobsearch #careeradvice #jobhunting #resumetips. Niche: #ATSresume #resumebuilder #careerchange + country tags (#jobsinGermany). Branded: #GlobalResumeHub.",
    engagement: "'What role are you applying for?', 'tag someone job hunting', save-worthy carousels and checklists.",
  },
  checkinvest: {
    market: "Nigerian retail savers and investors tracking the best safe places to put naira: savings rates, treasury bills, fixed deposits, mutual funds, and FX (naira/dollar).",
    audience: "Young Nigerian professionals, savers fighting inflation, the diaspora sending money home, and first-time investors comparing options. Pains: inflation eroding savings, fear of scams/Ponzi schemes, FX volatility, confusion comparing rates.",
    platforms: "X first (very active Nigerian fintwit), then Instagram and TikTok (Reels), Facebook, and Telegram/WhatsApp communities. LinkedIn minor.",
    pillars: [
      "Rate snapshot / comparison: where naira works hardest this week (informational, current data only)",
      "Plain explainer: treasury bills vs fixed deposit vs mutual fund, simply",
      "Scam and safety awareness: how to spot a Ponzi before it spots you",
      "Inflation-beating angle: why idle cash loses value and the safe options",
      "Tool spotlight: the rate checker and the decision it helps you make",
    ],
    hooks: "'Your savings is quietly losing value', 'Best naira rates right now', a relatable Nigerian money moment, an FX angle.",
    hashtagThemes: "Broad: #Nigeria #personalfinance #investing #money. Niche: #naira #treasurybills #FXrates #fintechNigeria. Branded: #CheckInvestNg.",
    engagement: "'What rate are you getting?', compare-and-decide prompts, relatable money-culture references.",
    guardrails: "NEVER give financial advice or say buy/sell. Stay informational and comparative; always safe to frame as 'not financial advice'.",
  },
};

export function socialStrategyFor(site: string): SocialStrategy | undefined {
  return SOCIAL_STRATEGY[site];
}

// Compact, prompt-ready strategy block for one site. Injected into the caption
// generator so every post is written FOR that brand's market, not generically.
export function socialStrategyBlock(site: string): string {
  const s = SOCIAL_STRATEGY[site];
  if (!s) return "";
  return [
    `SOCIAL STRATEGY FOR THIS BRAND:`,
    `Market: ${s.market}`,
    `Audience and pains: ${s.audience}`,
    `Where they are: ${s.platforms}`,
    `Content pillars (rotate them): ${s.pillars.map((p) => `(${p})`).join("; ")}.`,
    `Hooks that work: ${s.hooks}`,
    `Hashtag themes: ${s.hashtagThemes}`,
    `Engagement levers: ${s.engagement}`,
    s.guardrails ? `Guardrail: ${s.guardrails}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
