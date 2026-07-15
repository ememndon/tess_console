import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { brandProfiles } from "@/lib/db/schema";
import { generateRouted } from "@/lib/agent/complete";
import { numericGuard } from "@/lib/generate";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { insertMediaJob, type EnqueueResult } from "./enqueue";
import { SITE_SCRIPT_HINTS, SITE_SAY_AS, resolveBRoll } from "./scenario";
import { COPY_STANDARD, PERSUASION_STANDARD, enforceNoDashPunctuation } from "@/lib/design";
import type { DemoScenario, DemoScene, DemoLocator } from "./types";

// Ad-hoc "tour" demos for ANY URL. Tess fetches the page, reads its real
// title / description / section headings, scripts an engaging guided walkthrough, and
// the worker scroll-tours the live page while Tess narrates. Reliable on any site
// (uses smooth scroll, not page-specific selectors). Output is a Social Studio draft.

const SECTIONS = 4; // scroll sections after the opening top view → 5 narrated beats

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cleanTags(raw: unknown, fallback: string[]): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const tags = arr
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/^#*/, "")}`))
    .map((t) => t.replace(/\s+/g, ""));
  return [...new Set([...tags, ...fallback.map((t) => (t.startsWith("#") ? t : `#${t}`))])].slice(0, 6);
}

// Normalize + verify a URL is actually reachable BEFORE we spend any script/voice
// tokens on it. Used by the Demo Studio "check" button and as a hard guard in the
// enqueue path. A 2xx/3xx final response = good; anything else (DNS fail, refused,
// timeout, 4xx/5xx) = stop, so a typo never costs a generation + a failed render.
export async function checkUrlReachable(
  rawUrl: string,
): Promise<{ ok: boolean; status?: number; finalUrl?: string; title?: string; message: string }> {
  let url = rawUrl.trim();
  if (!url) return { ok: false, message: "Enter a URL first." };
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, message: "Only http(s) URLs are supported." };
  if (!u.hostname.includes(".")) return { ok: false, message: "That hostname looks incomplete." };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; TessDemoBot/1.0)", accept: "text/html,*/*" },
    });
    if (res.status >= 400) return { ok: false, status: res.status, message: `The page returned ${res.status} ${res.statusText}. Double-check the URL.` };
    let title: string | undefined;
    if ((res.headers.get("content-type") ?? "").includes("text/html")) {
      const html = (await res.text()).slice(0, 20_000);
      title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
    }
    return { ok: true, status: res.status, finalUrl: res.url, title, message: title ? `Reachable — "${title}"` : "Reachable — the page responded OK." };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { ok: false, message: aborted ? "Timed out reaching the page (9s). Is the site up?" : "Couldn't reach that URL. Check the address and that the site is online." };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageInfo(url: string): Promise<{ title: string; description: string; headings: string[]; hasTool: boolean }> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; TessDemoBot/1.0)" }, redirect: "follow" });
  const html = await res.text();
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 90);
  const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 300);
  const heads: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && heads.length < 20) {
    const t = strip(m[1]);
    if (t.length >= 3 && t.length <= 80) heads.push(t);
  }
  // Does the page have an interactive tool (calculator/form/builder)? If so the tour
  // features it FIRST so the actual product is always shown (not just scrolled past).
  const selectCount = (html.match(/<select[\s>]/gi) ?? []).length;
  const inputCount = (html.match(/<input(?![^>]*type=["'](?:hidden|submit|button|search|checkbox)["'])[\s>]/gi) ?? []).length;
  const hasTool = /<form[\s>]/i.test(html) || selectCount >= 1 || inputCount >= 2;
  return { title, description, headings: [...new Set(heads)].slice(0, 8), hasTool };
}

function detectSite(url: string): SiteKey | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const k of SITE_KEYS) {
      const d = SITE_META[k].domain.replace(/^www\./, "");
      if (host === d || host.endsWith(`.${d}`) || host.includes(d)) return k;
    }
  } catch {
    /* not a parseable host */
  }
  return null;
}

export async function enqueueUrlDemo(opts: {
  url: string;
  site?: string;
  requestedBy: string;
  createdBy?: string;
  actor?: string;
  voice?: string;
  music?: string;
  notes?: string;
}): Promise<EnqueueResult> {
  let url = opts.url.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }

  const site = (opts.site && (SITE_KEYS as string[]).includes(opts.site) ? opts.site : detectSite(url) ?? "calculatry") as SiteKey;
  const meta = SITE_META[site];
  const [brand] = await db.select().from(brandProfiles).where(eq(brandProfiles.site, site));

  const info = await fetchPageInfo(url).catch(() => ({ title: u.hostname, description: "", headings: [] as string[], hasTool: false }));
  const pageTitle = info.title || u.hostname;
  const allowedSource = `${pageTitle} ${info.description} ${info.headings.join(" ")}`;

  // Content-aware tour plan: feature the page's interactive tool FIRST (so the actual
  // product always appears — not just scrolled past), then its real sections in order.
  // The worker reveals each target; the carried fraction is a fallback if the element
  // can't be found, so the tour still moves to roughly the right region.
  const FRACS = [0.18, 0.42, 0.64, 0.86];
  type TourSection = { label: string; target?: DemoLocator; frac: number; focus: boolean; action?: "select" | "click"; value?: string };
  let sections: TourSection[];
  if (site === "calculatry") {
    // Every calculatry page shares ONE structure: title (h1) → input form → result
    // (hero number .text-4xl.font-bold.font-mono) → "Ask AI Instead" → "Show the
    // Math" → article → "Frequently Asked Questions" → related. The form has no
    // heading, so a generic heading-tour misses it. Target the real sections in
    // narrative order. focus:false on title+form so the WHOLE top (title AND inputs)
    // stays in frame while the calculator is introduced (per owner instruction).
    sections = [
      // Interactive fill: actually CHANGE a scoring dropdown (nth=1, the first real
      // question) so the calculator is shown being USED and the result updates live.
      // The opening scene already shows the title+form together (owner request), so this
      // scene demonstrates usage. focus:false keeps the form (and title above) in frame.
      { label: "answering a question in the calculator — pick an option and the score updates instantly", target: { css: "select", nth: 1 }, action: "select", value: "[change]", frac: 0.02, focus: false },
      { label: "the instant result — your score and what it means", target: { css: ".text-4xl.font-bold.font-mono" }, frac: 0.34, focus: true },
      // Frame the whole Ask-AI box (heading + input + button) so viewers see the
      // feature is real. Keep the emphasis zoom ON (focus:true); only revisit if the
      // render shows the zoom cropping the "Ask AI" button.
      { label: "the 'Ask AI Instead' feature — just describe your situation in plain English and AI answers", target: { role: "heading", name: "Ask AI Instead" }, frac: 0.55, focus: true },
      { label: "the Frequently Asked Questions", target: { text: "Frequently Asked Questions" }, frac: 0.82, focus: true },
    ];
  } else if (site === "resumehub") {
    // Every GlobalResumeHub country page shares one structure: title (h1) → guide
    // sections (CV Format, Work Experience, Mistakes, "<Country> at a Glance"…) → a
    // "Template preview" section with the Download/Builder CTA (the product) → FAQ →
    // Related Guides. Only the country name varies, so target by stable substrings.
    // No form here (it's a guide), so this is reveal-only — the product is the
    // downloadable template + builder CTA, featured in the Template-preview section.
    // Ordered TOP-TO-BOTTOM (by real page position) for a smooth one-way scroll, ending
    // on the product (the downloadable template/Builder) as the climax before the outro.
    sections = [
      { label: "the country-specific CV format — exactly how local employers expect it", target: { text: "CV Format" }, frac: 0.16, focus: true },
      { label: "the common CV mistakes to avoid in this country", target: { text: "Common CV Mistakes" }, frac: 0.5, focus: true },
      { label: "the country at a glance — the local hiring snapshot", target: { text: "at a Glance" }, frac: 0.6, focus: true },
      // The product, last: the downloadable CV template + Builder CTA. focus:false to keep
      // the whole template + buttons in frame.
      { label: "the ready-to-use CV template you can generate and download free for this country", target: { css: '[aria-label="Template preview"]' }, frac: 0.85, focus: false },
    ];
  } else if (site === "checkinvest") {
    // CheckInvest calculators vary but are close: title + a LIVE (CBN/SEC/etc.) rate
    // badge → an interactive calculator (tenor radios / sliders / inputs) bound to live
    // verified rates → result cards (e.g. true yield) → a comparison chart → "Compare
    // with other instruments" → article → FAQ. The signature is LIVE VERIFIED RATES, so
    // the demo CLICKS a tenor (.radio-option) to show the live rate + results updating.
    // Targets resolve precisely via reveal/click; fractions are only fallbacks. Result
    // cards have no stable class, so the live-rate chart stands in as the visual payoff.
    sections = [
      { label: "switching the tenor/option — the LIVE verified rate and the result update instantly", target: { css: ".radio-option", nth: 0 }, action: "click", frac: 0.06, focus: false },
      { label: "the rate-comparison chart — how the real returns stack up", target: { css: ".recharts-responsive-container" }, frac: 0.3, focus: false },
      { label: "how this instrument compares with the others on the site", target: { text: "Compare with other" }, frac: 0.58, focus: true },
      { label: "the frequently asked questions about this investment", target: { text: "Frequently Asked Questions" }, frac: 0.85, focus: true },
    ];
  } else {
    // Generic tour for any other URL: feature the interactive tool first (first
    // input), then the page's real headings in order; fraction fallbacks if not found.
    sections = [];
    if (info.hasTool) sections.push({ label: "The interactive tool/calculator itself", target: { css: "select, input[type=number]" }, frac: 0.05, focus: false });
    for (const h of info.headings) {
      if (sections.length >= SECTIONS) break;
      sections.push({ label: h, target: { text: h.slice(0, 60) }, frac: FRACS[Math.min(sections.length, FRACS.length - 1)], focus: true });
    }
    while (sections.length < SECTIONS) {
      const i = sections.length;
      sections.push({ label: "the next part of the page", frac: FRACS[Math.min(i, FRACS.length - 1)], focus: true });
    }
  }

  // Rotate the creative style per video so the channel doesn't sound same-y. Each is a
  // distinct, fully-committed voice — not just reworded hype.
  const STYLE_PROFILES = [
    { label: "High-energy hype", guide: "fast, exciting, a little exclamatory; build momentum and urgency; punchy short lines." },
    { label: "Calm confident expert", guide: "measured, authoritative, reassuring; let the value speak; no hype — just sharp clarity." },
    { label: "Playful & cheeky", guide: "witty and teasing, a wink in every line; talk to the viewer like a clever friend; light jokes." },
    { label: "Relatable storytelling", guide: "open on a tiny relatable problem/moment, then reveal the fix; warm, human, conversational." },
    { label: "Myth-busting / bold contrarian", guide: "challenge a common assumption, flip it, prove the better way; confident, a little spicy." },
    { label: "Warm & encouraging", guide: "supportive and optimistic ('you've got this'); gentle momentum; friendly and kind." },
    { label: "Luxury / premium minimalist", guide: "refined and sparse; few, weighty words; let confidence and space do the work; never busy." },
    { label: "Fast-cut trendy", guide: "snappy, current, high-tempo; very short punchy lines; momentum and rhythm over explanation." },
    { label: "Documentary / authoritative", guide: "calm narrator gravitas; 'here's how it actually works'; factual, credible, quietly compelling." },
    { label: "Direct-response", guide: "name the problem, agitate it a touch, present the fix, drive the action; persuasive and clear." },
    { label: "Curiosity / open-loop", guide: "tease a payoff up front and keep them watching for the reveal; intriguing, a little mysterious." },
    { label: "Friendly explainer", guide: "clear and helpful — 'let me show you'; simple language; a teacher who makes it click." },
  ];
  const style = STYLE_PROFILES[Math.floor(Math.random() * STYLE_PROFILES.length)];

  const system = [
    `You are an award-winning short-form video ad writer for "${meta.name}" (${meta.domain}). You turn a web page into a scroll-stopping guided-tour ad people watch twice and tag a friend in.`,
    `THIS VIDEO'S STYLE — commit to it fully, don't default to generic hype: ${style.label}. ${style.guide}`,
    brand?.voice ? `Brand voice (stay on-brand within the style above): ${brand.voice}` : "",
    brand?.audience ? `Audience: ${brand.audience}` : "",
    `The video scrolls slowly down the page while a voice narrates. Write a HUMAN, scroll-stopping voiceover in the style above.`,
    `- Intro: a killer HOOK (relatable question, cheeky exaggeration, or bold promise). Never "In this video" / "Welcome".`,
    `- Be funny and interactive: talk to "you", a wink here, a rhetorical question there, little anticipation ("ready?").`,
    `- Each body line introduces what's on screen as we scroll, selling the BENEFIT with personality, building momentum.`,
    `- Vary rhythm hard: mostly 4–13 word lines, the odd one-word jolt ("Boom."). End on a charming, confident CTA.`,
    `- HARD LIMIT: aim for ~12 words a line and NEVER exceed 18. If a thought runs long, split it into two punchy lines. Keep it snappy so the video never drags.`,
    `- No emojis, markdown, quotes, or hashtags-in-lines. NEVER invent numbers, prices, stats or claims not present in the page info below.`,
    COPY_STANDARD,
    PERSUASION_STANDARD,
    brand?.notFinancialAdvice ? `Finance brand: stay informational, never give financial advice.` : "",
    SITE_SCRIPT_HINTS[site] ? `KEY BRAND FEATURE TO WORK IN: ${SITE_SCRIPT_HINTS[site]}` : "",
    SITE_SAY_AS[site] ? SITE_SAY_AS[site] : "",
    `Return STRICT JSON only, this exact shape:`,
    `{"intro":{"title":"<=5-word punchy title","say":"hook line"},"scenes":["line for the top of the page","line as we scroll 1","line 2","line 3","line 4"],"outro":{"say":"call to action"},"caption":"1-2 sentence social caption (no hashtags)","hashtags":["#tag","#tag","#tag"],"delivery":"a short voice-director note: the tone, energy, pacing and feeling to read the whole script with (e.g. 'bright, playful, high-energy; conversational; lean into the questions; land the punchlines with a smile')","broll":[{"place":"afterIntro","query":"2-4 word search naming the LITERAL subject of THIS page","say":"one spoken line over the footage, <=16 words"}]}`,
    `The "delivery" note must describe reading the whole script in THIS VIDEO'S STYLE (${style.label}) — match its tone, energy and pacing.`,
    `The video reveals these parts of the page IN THIS ORDER — write ONE "scenes" line for each, in order, describing what's on screen at that moment (the first line is the opening hook over the top of the page):`,
    `Opening hook (top of page)\n${sections.map((s, i) => `${i + 1}. ${s.label}`).join("\n")}`,
    `B-ROLL: add 1 "broll" (place "afterIntro"); optionally a second with place "beforeOutro". The "query" MUST name the LITERAL real-world subject of THIS page — pull the concrete nouns straight from the page title/topic, not a metaphor. E.g. a nicotine/smoking page → "person smoking cigarette"; a mortgage page → "house keys handover"; a resume page → "job interview handshake"; a BMI/fitness page → "people exercising gym". Real footage of that subject only — never UI, screenshots, text, or an abstract concept ("bad habit", "success"). Keep it PROFESSIONAL and on-topic — never random crowds, dancing, parties, or street celebrations. If no concrete subject fits, return an empty broll array.`,
    site === "checkinvest"
      ? `B-ROLL TONE (critical): this is a serious finance/investment brand. Use ONLY professional African CORPORATE imagery — business people in modern offices, a professional at a desk with a laptop, counting Nigerian naira banknotes, a business handshake/meeting, a city financial district, money/charts. NEVER street scenes, dancing, parties, celebrations, markets, or casual crowds.`
      : "",
    `Provide exactly ${SECTIONS + 1} strings in "scenes" (the first is the top of the page, the rest as it scrolls down).`,
  ]
    .filter((l) => l !== undefined && l !== null)
    .join("\n");

  const notes = opts.notes?.trim();
  const user =
    `Page title: ${pageTitle}\nURL: ${url}\n${info.description ? `Description: ${info.description}\n` : ""}${info.headings.length ? `Sections on the page:\n- ${info.headings.join("\n- ")}\n` : ""}` +
    (notes ? `\nADMIN'S EXTRA GUIDANCE (weave this in, it matters): ${notes}\n` : "") +
    `\nWrite the tour as instructed.`;

  async function gen(extra = ""): Promise<Record<string, unknown> | null> {
    const r = await generateRouted({ taskId: "demo_script", system: extra ? `${system}\n${extra}` : system, user, maxTokens: 900, temperature: 0.9, preferModel: "sonnet" });
    return extractJson(r.text);
  }

  let data = await gen();

  const lineAt = (d: Record<string, unknown> | null, i: number, fb: string): string => {
    const arr = Array.isArray(d?.scenes) ? (d!.scenes as unknown[]) : [];
    const v = arr[i];
    return enforceNoDashPunctuation((v ? String(v) : "").trim() || fb);
  };

  const assemble = (d: Record<string, unknown> | null): DemoScenario => {
    const intro = (d?.intro ?? {}) as Record<string, unknown>;
    const outro = (d?.outro ?? {}) as Record<string, unknown>;
    const scenes: DemoScene[] = [
      { id: "open", action: "goto", focus: false, settleMs: 1400, say: lineAt(d, 0, `Take a look at ${pageTitle}.`) },
    ];
    sections.forEach((sec, i) => {
      scenes.push({
        id: `sec${i + 1}`,
        // Explicit action (e.g. "select" to fill the form) wins; otherwise reveal the
        // element, or scroll to the fraction if there's no target. The carried fraction
        // doubles as the worker's reveal fallback when an element can't be found.
        action: sec.action ?? (sec.target ? "reveal" : "scroll"),
        target: sec.target,
        value: sec.value ?? String(sec.frac),
        // The tool is shown statically (no zoom drift, inputs stay in frame); other
        // sections get a gentle emphasis zoom for motion.
        focus: sec.focus,
        settleMs: 1700,
        say: lineAt(d, i + 1, ""),
      });
    });
    return {
      recipeId: "url-tour",
      site,
      feature: pageTitle,
      url,
      baseViewport: { width: 1280, height: 900 },
      intro: { title: enforceNoDashPunctuation(String(intro.title ?? meta.name)).slice(0, 60), say: enforceNoDashPunctuation(String(intro.say ?? `Here's a quick look at ${pageTitle}.`).trim()) },
      scenes,
      outro: { say: enforceNoDashPunctuation(String(outro.say ?? `See more at ${meta.domain}.`).trim()) },
      caption: enforceNoDashPunctuation(String(d?.caption ?? `A quick look at ${pageTitle}.`).trim()),
      hashtags: cleanTags(d?.hashtags, (brand?.hashtags as string[]) ?? []),
      delivery: enforceNoDashPunctuation(String(d?.delivery ?? "").trim()) || undefined,
    };
  };

  let scenario = assemble(data);
  const guardOf = (sc: DemoScenario) =>
    numericGuard([sc.intro.say, ...sc.scenes.map((s) => s.say), sc.outro.say, sc.caption].join(" "), allowedSource);
  let guard = guardOf(scenario);
  if (!guard.ok) {
    const retry = await gen(`Your previous draft used numbers/claims not present in the page info (${guard.offending.join(", ")}). Rewrite using only what the page actually says.`);
    if (retry) {
      data = retry;
      scenario = assemble(data);
      guard = guardOf(scenario);
    }
  }

  // Composite: resolve stock B-roll from the chosen script (style-aware). Failures
  // are swallowed → the tour still renders without B-roll.
  const bRoll = await resolveBRoll(data, site).catch(() => []);
  if (bRoll.length) scenario.bRoll = bRoll;

  const jobId = await insertMediaJob({
    site,
    recipeId: "url-tour",
    feature: pageTitle,
    url,
    scenario,
    requestedBy: opts.requestedBy,
    createdBy: opts.createdBy,
    actor: opts.actor,
    voice: opts.voice,
    music: opts.music,
  });
  return { jobId, feature: pageTitle, site, guard };
}
